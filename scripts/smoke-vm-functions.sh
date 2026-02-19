#!/usr/bin/env bash
set -euo pipefail

BASE="${VITE_MYTHIC_FUNCTIONS_BASE_URL:-${MYTHIC_FUNCTIONS_BASE_URL:-}}"

if [[ -z "${BASE}" ]]; then
  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  if [[ -f "${ROOT_DIR}/.env.local" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${ROOT_DIR}/.env.local"
    set +a
  elif [[ -f "${ROOT_DIR}/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "${ROOT_DIR}/.env"
    set +a
  fi
  BASE="${VITE_MYTHIC_FUNCTIONS_BASE_URL:-${MYTHIC_FUNCTIONS_BASE_URL:-}}"
fi

if [[ -z "${BASE}" ]]; then
  echo "Missing VITE_MYTHIC_FUNCTIONS_BASE_URL (or MYTHIC_FUNCTIONS_BASE_URL)."
  exit 1
fi

BASE="${BASE%/}"
if [[ "${BASE}" == */functions/v1 ]]; then
  FUNCTIONS_BASE="${BASE}"
else
  FUNCTIONS_BASE="${BASE}/functions/v1"
fi

echo "VM functions base: ${FUNCTIONS_BASE}"
echo

endpoints=(
  generate-class
  mythic-apply-xp
  mythic-bootstrap
  mythic-board-transition
  mythic-combat-start
  mythic-combat-tick
  mythic-combat-use-skill
  mythic-create-campaign
  mythic-create-character
  mythic-dm-context
  mythic-dungeon-master
  mythic-field-generate
  mythic-generate-loot
  mythic-game-save
  mythic-join-campaign
  mythic-list-campaigns
  mythic-inventory-equip
  mythic-inventory-unequip
  mythic-recompute-character
  mythic-set-loadout
  mythic-shop-buy
  mythic-shop-stock
  mythic-tts
  world-content-writer
  world-generator
)

fail=0
for ep in "${endpoints[@]}"; do
  out="$(curl -sS -m 10 -i -X POST "${FUNCTIONS_BASE}/${ep}" -H 'Content-Type: application/json' -d '{}')" || {
    echo "FAIL ${ep}: request failed"
    fail=1
    continue
  }

  status="$(printf "%s" "${out}" | awk 'NR==1 {print $2}')"
  code="$(printf "%s" "${out}" | sed -n '/^\r$/,$p' | tail -n +2 | rg -o '"code"\s*:\s*"[^"]+"' -N | head -n1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
  rid="$(printf "%s" "${out}" | rg -i '^x-request-id:' -N | head -n1 | awk '{print $2}' | tr -d '\r' || true)"
  if [[ -z "${rid}" ]]; then
    rid="$(printf "%s" "${out}" | sed -n '/^\r$/,$p' | tail -n +2 | rg -o '"requestId"\s*:\s*"[^"]+"' -N | head -n1 | sed -E 's/.*"([^"]+)".*/\1/' || true)"
  fi

  # Most endpoints are auth-required, so unauthenticated probe should return 401/auth_required.
  # world-generator may return 400 invalid_type on empty payload because auth is optional.
  ok=0
  if [[ "${status}" == "401" && "${code}" == "auth_required" ]]; then
    ok=1
  elif [[ "${ep}" == "generate-class" && "${status}" == "400" && "${code}" == "invalid_request" ]]; then
    ok=1
  elif [[ "${ep}" == "world-generator" && "${status}" == "400" ]]; then
    ok=1
  fi

  if [[ "${ok}" == "1" ]]; then
    echo "OK   ${ep} status=${status} code=${code:-n/a} request_id=${rid:-missing}"
  else
    echo "FAIL ${ep} status=${status} code=${code:-n/a} request_id=${rid:-missing}"
    fail=1
  fi
done

echo
if [[ "${fail}" == "1" ]]; then
  echo "Smoke check failed."
  exit 1
fi
echo "Smoke check passed."
