#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env.local. Create it with VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, and VITE_MYTHIC_FUNCTIONS_BASE_URL."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${VITE_MYTHIC_FUNCTIONS_BASE_URL:-}" || -z "${VITE_SUPABASE_ANON_KEY:-}" ]]; then
  echo "VITE_MYTHIC_FUNCTIONS_BASE_URL or VITE_SUPABASE_ANON_KEY missing in .env.local."
  exit 1
fi

payload='{"type":"initial_world","campaignSeed":{"title":"Smoke Test","description":"Edge function smoke test","themes":["mystic","frontier"]},"context":{"playerLevel":1}}'
BASE="${VITE_MYTHIC_FUNCTIONS_BASE_URL%/}"
if [[ "${BASE}" == */functions/v1 ]]; then
  URL="${BASE}/world-generator"
else
  URL="${BASE}/functions/v1/world-generator"
fi

echo "POST ${URL}"
response="$(curl -s -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST "${URL}" \
  -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "${payload}")"

status="$(printf "%s" "$response" | awk -F: '/HTTP_STATUS/ {print $2}')"
body="$(printf "%s" "$response" | sed '/HTTP_STATUS/d')"

echo "Status: ${status}"
echo "Body:"
echo "${body}"
