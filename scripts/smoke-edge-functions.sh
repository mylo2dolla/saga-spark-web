#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing .env.local. Create it with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [[ -z "${VITE_SUPABASE_URL:-}" || -z "${VITE_SUPABASE_ANON_KEY:-}" ]]; then
  echo "VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing in .env.local."
  exit 1
fi

payload='{"type":"initial_world","campaignSeed":{"title":"Smoke Test","description":"Edge function smoke test","themes":["mystic","frontier"]},"context":{"playerLevel":1}}'

FUNCTIONS_BASE_URL="${VITE_MYTHIC_FUNCTIONS_BASE_URL:-}"
if [[ -n "$FUNCTIONS_BASE_URL" && "$FUNCTIONS_BASE_URL" != *"/functions/v1"* ]]; then
  echo "VITE_MYTHIC_FUNCTIONS_BASE_URL must include /functions/v1 (example: https://api.example.com/functions/v1)."
  exit 1
fi
if [[ -z "$FUNCTIONS_BASE_URL" ]]; then
  FUNCTIONS_BASE_URL="${VITE_SUPABASE_URL%/}/functions/v1"
fi
FUNCTIONS_BASE_URL="${FUNCTIONS_BASE_URL%/}"

EDGE_URL="${FUNCTIONS_BASE_URL}/world-generator"

echo "POST ${EDGE_URL}"
response="$(curl -s -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST "${EDGE_URL}" \
  -H "apikey: ${VITE_SUPABASE_ANON_KEY}" \
  -H "Content-Type: application/json" \
  -d "${payload}")"

status="$(printf "%s" "$response" | awk -F: '/HTTP_STATUS/ {print $2}')"
body="$(printf "%s" "$response" | sed '/HTTP_STATUS/d')"

echo "Status: ${status}"
echo "Body:"
echo "${body}"
