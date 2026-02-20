#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/smoke-mythic-board-auth.sh [--keep-resources] [--output=/absolute/or/relative/path]

Runs an authenticated Mythic board/runtime smoke flow against VM-hosted functions:
1) creates disposable auth user
2) signs in and gets bearer token
3) creates disposable campaign + character
4) validates dm-context, dungeon-master SSE JSON, runtime transitions, combat-start
5) best-effort cleanup (campaign + user) unless --keep-resources

Options:
  --keep-resources   keep temporary campaign/user for manual UI QA
  --output=PATH      write key values (campaign_id, user_id, email, password, request ids) to PATH
  --help             show this help
USAGE
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

read_env_var() {
  local file="$1"
  local key="$2"
  awk -F= -v k="$key" '
    $1 == k {
      v = $2
      sub(/^"/, "", v)
      sub(/"$/, "", v)
      print v
      exit
    }
  ' "$file"
}

extract_request_id() {
  local header_file="$1"
  local body_file="$2"
  local rid
  rid="$(awk 'tolower($1) == "x-request-id:" { print $2 }' "$header_file" | tr -d '\r' | head -n1)"
  if [[ -z "${rid}" ]]; then
    rid="$(jq -r '.requestId // empty' "$body_file" 2>/dev/null || true)"
  fi
  printf "%s" "${rid:-missing}"
}

KEEP_RESOURCES=0
OUTPUT_PATH=""
for arg in "$@"; do
  case "$arg" in
    --keep-resources)
      KEEP_RESOURCES=1
      ;;
    --output=*)
      OUTPUT_PATH="${arg#*=}"
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage
      exit 2
      ;;
  esac
done

require_cmd curl
require_cmd jq
require_cmd awk
require_cmd sed
require_cmd tr
require_cmd mktemp

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

API_ENV="${REPO_ROOT}/services/mythic-api/.env"
LOCAL_ENV="${REPO_ROOT}/.env.local"

if [[ ! -f "${API_ENV}" ]]; then
  echo "Missing required file: ${API_ENV}" >&2
  exit 1
fi

if [[ ! -f "${LOCAL_ENV}" ]]; then
  echo "Missing required file: ${LOCAL_ENV}" >&2
  exit 1
fi

SUPABASE_URL="$(read_env_var "${API_ENV}" "SUPABASE_URL")"
SUPABASE_SERVICE_ROLE_KEY="$(read_env_var "${API_ENV}" "SUPABASE_SERVICE_ROLE_KEY")"
SUPABASE_ANON_KEY="$(read_env_var "${LOCAL_ENV}" "VITE_SUPABASE_ANON_KEY")"
FUNCTIONS_BASE_RAW="$(read_env_var "${LOCAL_ENV}" "VITE_MYTHIC_FUNCTIONS_BASE_URL")"

if [[ -z "${SUPABASE_URL}" || -z "${SUPABASE_SERVICE_ROLE_KEY}" || -z "${SUPABASE_ANON_KEY}" || -z "${FUNCTIONS_BASE_RAW}" ]]; then
  echo "Missing required env values in ${API_ENV} or ${LOCAL_ENV}" >&2
  exit 1
fi

FUNCTIONS_BASE_RAW="${FUNCTIONS_BASE_RAW%/}"
if [[ "${FUNCTIONS_BASE_RAW}" == */functions/v1 ]]; then
  FUNCTIONS_BASE="${FUNCTIONS_BASE_RAW}"
else
  FUNCTIONS_BASE="${FUNCTIONS_BASE_RAW}/functions/v1"
fi

declare -a SUMMARY_LINES
declare -a REQUEST_ID_KEYS
declare -a REQUEST_ID_VALUES

LAST_JSON=""
LAST_REQ_ID=""

ACCESS_TOKEN=""
TEMP_USER_ID=""
TEMP_CAMPAIGN_ID=""
TEMP_CHARACTER_ID=""
TEMP_EMAIL=""
TEMP_PASSWORD=""

cleanup_resources() {
  if [[ "${KEEP_RESOURCES}" == "1" ]]; then
    return 0
  fi

  if [[ -n "${TEMP_CAMPAIGN_ID}" ]]; then
    curl -sS -m 20 -X DELETE \
      "${SUPABASE_URL}/rest/v1/campaigns?id=eq.${TEMP_CAMPAIGN_ID}" \
      -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      >/dev/null || true
  fi

  if [[ -n "${TEMP_USER_ID}" ]]; then
    curl -sS -m 20 -X DELETE \
      "${SUPABASE_URL}/auth/v1/admin/users/${TEMP_USER_ID}" \
      -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
      -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
      >/dev/null || true
  fi
}

on_exit() {
  local code=$?
  cleanup_resources
  if [[ ${code} -ne 0 ]]; then
    echo "Board smoke failed." >&2
  fi
}
trap on_exit EXIT

call_function_json_200() {
  local endpoint="$1"
  local payload="$2"
  local timeout_s="$3"
  local label="${4:-$1}"
  local body_file header_file status rid code_field error_field
  body_file="$(mktemp)"
  header_file="$(mktemp)"

  status="$(curl -sS -m "${timeout_s}" -o "${body_file}" -D "${header_file}" -w "%{http_code}" \
    -X POST "${FUNCTIONS_BASE}/${endpoint}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${payload}")"
  rid="$(extract_request_id "${header_file}" "${body_file}")"
  code_field="$(jq -r '.code // empty' "${body_file}" 2>/dev/null || true)"
  error_field="$(jq -r '.error // empty' "${body_file}" 2>/dev/null || true)"

  if [[ "${status}" != "200" ]]; then
    echo "FAIL endpoint=${label} status=${status} code=${code_field:-n/a} request_id=${rid} error=${error_field:-none}" >&2
    echo "Response body:" >&2
    cat "${body_file}" >&2
    rm -f "${body_file}" "${header_file}"
    return 1
  fi

  LAST_JSON="$(cat "${body_file}")"
  LAST_REQ_ID="${rid}"
  REQUEST_ID_KEYS+=("${label}")
  REQUEST_ID_VALUES+=("${rid}")
  SUMMARY_LINES+=("PASS endpoint=${label} status=200 request_id=${rid}")
  echo "PASS endpoint=${label} status=200 request_id=${rid}"

  rm -f "${body_file}" "${header_file}"
}

call_function_sse_200() {
  local endpoint="$1"
  local payload="$2"
  local timeout_s="$3"
  local label="${4:-$1}"
  local body_file header_file status rid code_field error_field sse_text parsed_json narration_len
  body_file="$(mktemp)"
  header_file="$(mktemp)"

  status="$(curl -sS -m "${timeout_s}" -o "${body_file}" -D "${header_file}" -w "%{http_code}" \
    -X POST "${FUNCTIONS_BASE}/${endpoint}" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Authorization: Bearer ${ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "${payload}")"
  rid="$(extract_request_id "${header_file}" "${body_file}")"

  if [[ "${status}" != "200" ]]; then
    code_field="$(jq -r '.code // empty' "${body_file}" 2>/dev/null || true)"
    error_field="$(jq -r '.error // empty' "${body_file}" 2>/dev/null || true)"
    echo "FAIL endpoint=${label} status=${status} code=${code_field:-n/a} request_id=${rid} error=${error_field:-none}" >&2
    echo "Response body:" >&2
    cat "${body_file}" >&2
    rm -f "${body_file}" "${header_file}"
    return 1
  fi

  sse_text="$(sed -n 's/^data: //p' "${body_file}" | sed '/^\[DONE\]$/d')"
  if [[ -z "${sse_text}" ]]; then
    echo "FAIL endpoint=${label} status=200 request_id=${rid} error=empty_sse_stream" >&2
    rm -f "${body_file}" "${header_file}"
    return 1
  fi

  parsed_json="$(printf '%s\n' "${sse_text}" | jq -r '.choices[0].delta.content // empty' | tr -d '\n')"
  if [[ -z "${parsed_json}" ]] || ! printf '%s' "${parsed_json}" | jq -e . >/dev/null 2>&1; then
    echo "FAIL endpoint=${label} status=200 request_id=${rid} error=non_parseable_sse_payload" >&2
    rm -f "${body_file}" "${header_file}"
    return 1
  fi

  narration_len="$(printf '%s' "${parsed_json}" | jq -r '.narration // "" | length')"
  if [[ "${narration_len}" -le 0 ]]; then
    echo "FAIL endpoint=${label} status=200 request_id=${rid} error=missing_narration" >&2
    rm -f "${body_file}" "${header_file}"
    return 1
  fi

  LAST_JSON="${parsed_json}"
  LAST_REQ_ID="${rid}"
  REQUEST_ID_KEYS+=("${label}")
  REQUEST_ID_VALUES+=("${rid}")
  SUMMARY_LINES+=("PASS endpoint=${label} status=200 request_id=${rid} narration_len=${narration_len}")
  echo "PASS endpoint=${label} status=200 request_id=${rid} narration_len=${narration_len}"

  rm -f "${body_file}" "${header_file}"
}

echo "VM functions base: ${FUNCTIONS_BASE}"

stamp="$(date +%s)"
TEMP_EMAIL="smoke.board.${stamp}@example.com"
TEMP_PASSWORD="Smoke!${stamp}Aa"

create_user_body="$(mktemp)"
create_user_status="$(
  curl -sS -m 30 \
    -o "${create_user_body}" \
    -w "%{http_code}" \
    -X POST "${SUPABASE_URL}/auth/v1/admin/users" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(jq -cn --arg email "${TEMP_EMAIL}" --arg password "${TEMP_PASSWORD}" '{email:$email,password:$password,email_confirm:true}')"
)"

if [[ "${create_user_status}" != "200" && "${create_user_status}" != "201" ]]; then
  echo "Failed to create temporary user (status=${create_user_status})." >&2
  cat "${create_user_body}" >&2
  rm -f "${create_user_body}"
  exit 1
fi

TEMP_USER_ID="$(jq -r '.id // empty' "${create_user_body}")"
rm -f "${create_user_body}"
if [[ -z "${TEMP_USER_ID}" ]]; then
  echo "Temporary user creation did not return user id." >&2
  exit 1
fi

signin_body="$(mktemp)"
signin_status="$(
  curl -sS -m 30 \
    -o "${signin_body}" \
    -w "%{http_code}" \
    -X POST "${SUPABASE_URL}/auth/v1/token?grant_type=password" \
    -H "apikey: ${SUPABASE_ANON_KEY}" \
    -H "Content-Type: application/json" \
    -d "$(jq -cn --arg email "${TEMP_EMAIL}" --arg password "${TEMP_PASSWORD}" '{email:$email,password:$password}')"
)"

if [[ "${signin_status}" != "200" ]]; then
  echo "Failed to sign in temporary user (status=${signin_status})." >&2
  cat "${signin_body}" >&2
  rm -f "${signin_body}"
  exit 1
fi

ACCESS_TOKEN="$(jq -r '.access_token // empty' "${signin_body}")"
rm -f "${signin_body}"
if [[ -z "${ACCESS_TOKEN}" ]]; then
  echo "Sign in succeeded but access token is missing." >&2
  exit 1
fi

create_campaign_payload="$(jq -cn --arg name "Board Smoke ${stamp}" --arg description "Disposable campaign for board stabilization smoke." '{name:$name,description:$description,templateKey:"custom"}')"
call_function_json_200 "mythic-create-campaign" "${create_campaign_payload}" 90
TEMP_CAMPAIGN_ID="$(printf '%s' "${LAST_JSON}" | jq -r '.campaign.id // empty')"
if [[ -z "${TEMP_CAMPAIGN_ID}" ]]; then
  echo "Campaign creation did not return campaign id." >&2
  exit 1
fi

create_character_payload="$(jq -cn --arg campaignId "${TEMP_CAMPAIGN_ID}" --arg characterName "Smoke Vanguard ${stamp}" --arg classDescription "Aggressive vanguard with disciplined control, shield pressure, and frontline tempo management." '{campaignId:$campaignId,characterName:$characterName,classDescription:$classDescription}')"
call_function_json_200 "mythic-create-character" "${create_character_payload}" 180
TEMP_CHARACTER_ID="$(printf '%s' "${LAST_JSON}" | jq -r '.character_id // empty')"
if [[ -z "${TEMP_CHARACTER_ID}" ]]; then
  echo "Character creation did not return character id." >&2
  exit 1
fi

dm_context_payload="$(jq -cn --arg campaignId "${TEMP_CAMPAIGN_ID}" '{campaignId:$campaignId}')"
call_function_json_200 "mythic-dm-context" "${dm_context_payload}" 60

dungeon_master_payload="$(jq -cn --arg campaignId "${TEMP_CAMPAIGN_ID}" '{campaignId:$campaignId,messages:[{role:"user",content:"Give one concise scene update and two immediate actionable options."}],actionContext:null}')"
call_function_sse_200 "mythic-dungeon-master" "${dungeon_master_payload}" 180

for mode in travel dungeon town; do
  transition_payload="$(jq -cn --arg campaignId "${TEMP_CAMPAIGN_ID}" --arg toMode "${mode}" --arg reason "board_smoke_transition_${mode}" '{campaignId:$campaignId,toMode:$toMode,reason:$reason,payload:{smoke:true,target_mode:$toMode}}')"
  call_function_json_200 "mythic-runtime-transition" "${transition_payload}" 60 "mythic-runtime-transition:${mode}"
  transition_ok="$(printf '%s' "${LAST_JSON}" | jq -r 'if has("ok") then (.ok|tostring) else "true" end' 2>/dev/null || echo "true")"
  if [[ "${transition_ok}" != "true" ]]; then
    echo "Runtime transition to ${mode} returned ok=false." >&2
    exit 1
  fi
done

combat_start_payload="$(jq -cn --arg campaignId "${TEMP_CAMPAIGN_ID}" --arg reason "board_smoke_combat_start" '{campaignId:$campaignId,reason:$reason}')"
call_function_json_200 "mythic-combat-start" "${combat_start_payload}" 60
combat_ok="$(printf '%s' "${LAST_JSON}" | jq -r '.ok // false | tostring' 2>/dev/null || echo "false")"
if [[ "${combat_ok}" != "true" ]]; then
  echo "Combat start returned ok=false." >&2
  exit 1
fi

if [[ -n "${OUTPUT_PATH}" ]]; then
  {
    echo "campaign_id=${TEMP_CAMPAIGN_ID}"
    echo "character_id=${TEMP_CHARACTER_ID}"
    echo "user_id=${TEMP_USER_ID}"
    echo "email=${TEMP_EMAIL}"
    echo "password=${TEMP_PASSWORD}"
    idx=0
    while [[ ${idx} -lt ${#REQUEST_ID_KEYS[@]} ]]; do
      key="${REQUEST_ID_KEYS[$idx]}"
      value="${REQUEST_ID_VALUES[$idx]}"
      safe_key="$(printf '%s' "${key}" | tr -c 'A-Za-z0-9_' '_')"
      echo "request_id_${safe_key}=${value}"
      idx=$((idx + 1))
    done
  } > "${OUTPUT_PATH}"
fi

echo
echo "Board smoke passed."
for line in "${SUMMARY_LINES[@]}"; do
  echo "${line}"
done

if [[ "${KEEP_RESOURCES}" == "1" ]]; then
  echo
  echo "Resources kept for manual QA:"
  echo "campaign_id=${TEMP_CAMPAIGN_ID}"
  echo "character_id=${TEMP_CHARACTER_ID}"
  echo "user_id=${TEMP_USER_ID}"
  echo "email=${TEMP_EMAIL}"
  echo "password=${TEMP_PASSWORD}"
else
  echo
  echo "Temporary resources cleaned up."
fi
