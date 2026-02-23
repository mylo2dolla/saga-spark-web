#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_CONFIG_DIR="${ROOT_DIR}/apps/SagaSparkPad/Config"
OUTPUT_FILE="${APP_CONFIG_DIR}/SagaSparkPad.local.xcconfig"

LOCAL_ENV="${ROOT_DIR}/.env.local"
FALLBACK_ENV="${ROOT_DIR}/.env"

if [[ -f "${LOCAL_ENV}" ]]; then
  ENV_FILE="${LOCAL_ENV}"
elif [[ -f "${FALLBACK_ENV}" ]]; then
  ENV_FILE="${FALLBACK_ENV}"
else
  echo "Missing .env.local and .env in ${ROOT_DIR}" >&2
  exit 1
fi

read_env_var() {
  local key="$1"
  awk -F= -v k="$key" '
    $1 == k {
      v = $2
      sub(/^"/, "", v)
      sub(/"$/, "", v)
      print v
      exit
    }
  ' "${ENV_FILE}"
}

encode_xcconfig_url() {
  local url="$1"
  printf '%s' "${url}" | sed 's#://#:$(SLASH)$(SLASH)#'
}

SUPABASE_URL="$(read_env_var "VITE_SUPABASE_URL")"
SUPABASE_ANON_KEY="$(read_env_var "VITE_SUPABASE_ANON_KEY")"
MYTHIC_FUNCTIONS_BASE_URL="$(read_env_var "VITE_MYTHIC_FUNCTIONS_BASE_URL")"
if [[ -z "${MYTHIC_FUNCTIONS_BASE_URL}" ]]; then
  MYTHIC_FUNCTIONS_BASE_URL="$(read_env_var "VITE_TAILSCALE_FUNCTIONS_BASE_URL")"
fi
APP_ENV="$(read_env_var "VITE_SAGASPARK_APP_ENV")"

if [[ -z "${SUPABASE_URL}" || -z "${SUPABASE_ANON_KEY}" || -z "${MYTHIC_FUNCTIONS_BASE_URL}" ]]; then
  echo "Missing required env values in ${ENV_FILE}" >&2
  echo "Required: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_MYTHIC_FUNCTIONS_BASE_URL (or VITE_TAILSCALE_FUNCTIONS_BASE_URL)" >&2
  exit 1
fi

SUPABASE_URL_XC="$(encode_xcconfig_url "${SUPABASE_URL}")"
MYTHIC_FUNCTIONS_BASE_URL_XC="$(encode_xcconfig_url "${MYTHIC_FUNCTIONS_BASE_URL}")"
SUPABASE_REDIRECT_URL_XC='sagasparkpad:$(SLASH)$(SLASH)auth/callback'
APP_ENV_XC="${APP_ENV:-dev}"

mkdir -p "${APP_CONFIG_DIR}"

cat > "${OUTPUT_FILE}" <<XC
// Generated from ${ENV_FILE}
SUPABASE_URL = ${SUPABASE_URL_XC}
SUPABASE_ANON_KEY = ${SUPABASE_ANON_KEY}
MYTHIC_FUNCTIONS_BASE_URL = ${MYTHIC_FUNCTIONS_BASE_URL_XC}
SUPABASE_REDIRECT_URL = ${SUPABASE_REDIRECT_URL_XC}
DEFAULT_CAMPAIGN_ID = saga-spark-ipad
LEVELUPKIT_ENABLE_ANONYMOUS_AUTH = YES
APP_ENV = ${APP_ENV_XC}
XC

echo "Wrote ${OUTPUT_FILE}"
