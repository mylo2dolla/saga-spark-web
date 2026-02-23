#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_DIR="${ROOT_DIR}/services/mythic-api"
API_ENV_FILE="${API_DIR}/.env"

if [[ -f "${API_ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${API_ENV_FILE}"
  set +a
fi

KEYCHAIN_SERVICE="${KEYCHAIN_SERVICE:-com.letsdev.studiolite}"
KEYCHAIN_ACCOUNT="${KEYCHAIN_ACCOUNT:-api_key_tailscale-remote}"
TAILSCALE_SERVER_URL="${TAILSCALE_SERVER_URL:-${TAILSCALE_AI_BASE_URL:-${TAILSCALE_OPENAI_BASE_URL:-http://mac16.tail265d30.ts.net:8090}}}"
export OPENAI_BASE_URL="${TAILSCALE_SERVER_URL}"
export TAILSCALE_AI_BASE_URL="${TAILSCALE_SERVER_URL}"
export TAILSCALE_OPENAI_BASE_URL="${TAILSCALE_SERVER_URL}"

if [[ -z "${OPENAI_API_KEY:-}" && -z "${TAILSCALE_OPENAI_API_KEY:-}" && -z "${LLM_API_KEY:-}" ]]; then
  if security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}" >/dev/null 2>&1; then
    export TAILSCALE_OPENAI_API_KEY
    TAILSCALE_OPENAI_API_KEY="$(security find-generic-password -w -s "${KEYCHAIN_SERVICE}" -a "${KEYCHAIN_ACCOUNT}")"
  else
    echo "Missing keychain secret: service='${KEYCHAIN_SERVICE}' account='${KEYCHAIN_ACCOUNT}'" >&2
    exit 1
  fi
fi

echo "Mythic API keychain runtime"
echo "  keychain service: ${KEYCHAIN_SERVICE}"
echo "  keychain account: ${KEYCHAIN_ACCOUNT}"
echo "  ai base url: ${OPENAI_BASE_URL}"

if [[ $# -gt 0 ]]; then
  exec "$@"
fi

exec npm --prefix "${API_DIR}" run start
