#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MYTHIC_API_BASE_URL:-http://localhost:3001/functions/v1}"
TOKEN="${SUPABASE_ACCESS_TOKEN:-}"

if [[ -z "${TOKEN}" ]]; then
  echo "Missing SUPABASE_ACCESS_TOKEN. See services/mythic-api/scripts/README.md" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

CAMPAIGN_NAME="${MYTHIC_SMOKE_CAMPAIGN_NAME:-VPS Smoke $(date +%Y-%m-%d)}"
CAMPAIGN_DESCRIPTION="${MYTHIC_SMOKE_CAMPAIGN_DESCRIPTION:-Quick smoke run for VPS API compatibility.}"
CHARACTER_NAME="${MYTHIC_SMOKE_CHARACTER_NAME:-Smoke Test}"
CLASS_DESC="${MYTHIC_SMOKE_CLASS:-werewolf ninja pyromancer}"

hdr() {
  echo
  echo "== $1"
}

curl_json() {
  local name="$1"
  local payload="$2"
  local out="${TMP_DIR}/${name}.json"
  local hdrs="${TMP_DIR}/${name}.headers"

  curl -sS -D "${hdrs}" -o "${out}" \
    -X POST "${BASE_URL}/${name}" \
    -H "authorization: Bearer ${TOKEN}" \
    -H "content-type: application/json" \
    --data "${payload}"

  echo "${out}"
}

node_get() {
  local file="$1"
  local expr="$2"
  node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const v=(${expr}); if (v==null) process.exit(0); if (Array.isArray(v)) { console.log(v.join(',')); } else { console.log(String(v)); }" "${file}"
}

hdr "mythic-create-campaign"
create_out="$(curl_json mythic-create-campaign "$(printf '{"name":%s,"description":%s,"template_key":"custom"}' "$(node -p "JSON.stringify(process.argv[1])" "${CAMPAIGN_NAME}")" "$(node -p "JSON.stringify(process.argv[1])" "${CAMPAIGN_DESCRIPTION}")")")"
cat "${create_out}"
campaign_id="$(node_get "${create_out}" "(j.campaignId||j.campaign_id||j.id||j.campaign?.id)")"
invite_code="$(node_get "${create_out}" "(j.inviteCode||j.invite_code||j.campaign?.invite_code)")"

if [[ -z "${campaign_id}" ]]; then
  echo "Could not parse campaign id from mythic-create-campaign response" >&2
  exit 1
fi

hdr "mythic-bootstrap"
bootstrap_out="$(curl_json mythic-bootstrap "{\"campaignId\":\"${campaign_id}\"}")"
cat "${bootstrap_out}"

hdr "mythic-list-campaigns"
list_out="$(curl_json mythic-list-campaigns "{}")"
cat "${list_out}"

if [[ -n "${invite_code}" ]]; then
  hdr "mythic-join-campaign (self-join via invite code)"
  join_out="$(curl_json mythic-join-campaign "{\"inviteCode\":\"${invite_code}\"}")"
  cat "${join_out}"
fi

hdr "mythic-create-character (requires OpenAI server env)"
create_char_out="$(curl_json mythic-create-character "$(printf '{"campaignId":"%s","characterName":%s,"classDescription":%s}' "${campaign_id}" "$(node -p "JSON.stringify(process.argv[1])" "${CHARACTER_NAME}")" "$(node -p "JSON.stringify(process.argv[1])" "${CLASS_DESC}")")")"
cat "${create_char_out}"
character_id="$(node_get "${create_char_out}" "(j.character_id||j.characterId)")"
skill_ids_csv="$(node_get "${create_char_out}" "(j.skill_ids||[])")"

hdr "mythic-dm-context"
dm_ctx_out="$(curl_json mythic-dm-context "{\"campaignId\":\"${campaign_id}\"}")"
cat "${dm_ctx_out}"

vendor_id="$(node_get "${dm_ctx_out}" "(j.context?.board_state?.vendors?.[0]?.id||j.board_state?.vendors?.[0]?.id||'')")"

hdr "mythic-dungeon-master (turn resolver SSE)"
dm_sse_out="${TMP_DIR}/mythic-dungeon-master.sse"
dm_sse_hdrs="${TMP_DIR}/mythic-dungeon-master.headers"
curl -sS -D "${dm_sse_hdrs}" -o "${dm_sse_out}" \
  -X POST "${BASE_URL}/mythic-dungeon-master" \
  -H "authorization: Bearer ${TOKEN}" \
  -H "content-type: application/json" \
  --data "$(printf '{"campaignId":"%s","messages":[{"role":"user","content":"%s"}]}' "${campaign_id}" "smoke: narrate the scene and offer 1-2 choices")"

head -n 8 "${dm_sse_out}"
if ! grep -q "^data: " "${dm_sse_out}"; then
  echo "Expected SSE data lines from mythic-dungeon-master; got:" >&2
  tail -n 20 "${dm_sse_out}" >&2 || true
  exit 1
fi

hdr "dungeon-master (legacy SSE compatibility)"
legacy_dm_out="${TMP_DIR}/dungeon-master.sse"
legacy_dm_hdrs="${TMP_DIR}/dungeon-master.headers"
curl -sS -D "${legacy_dm_hdrs}" -o "${legacy_dm_out}" \
  -X POST "${BASE_URL}/dungeon-master" \
  -H "authorization: Bearer ${TOKEN}" \
  -H "content-type: application/json" \
  --data '{"messages":[{"role":"user","content":"legacy smoke: narrate this scene in JSON"}],"context":{"location":"Smoke Camp"}}'

head -n 8 "${legacy_dm_out}"
if ! grep -q "^data: " "${legacy_dm_out}"; then
  echo "Expected SSE data lines from dungeon-master; got:" >&2
  tail -n 20 "${legacy_dm_out}" >&2 || true
  exit 1
fi

hdr "mythic-board-transition (town -> travel)"
transition_out="$(curl_json mythic-board-transition "{\"campaignId\":\"${campaign_id}\",\"toBoardType\":\"travel\",\"reason\":\"smoke\"}")"
cat "${transition_out}"

hdr "mythic-combat-start"
combat_start_out="$(curl_json mythic-combat-start "{\"campaignId\":\"${campaign_id}\",\"reason\":\"smoke\"}")"
cat "${combat_start_out}"
combat_session_id="$(node_get "${combat_start_out}" "(j.combat_session_id||j.combatSessionId||'')")"

if [[ -n "${combat_session_id}" ]]; then
  hdr "mythic-combat-tick"
  tick_out="$(curl_json mythic-combat-tick "{\"campaignId\":\"${campaign_id}\",\"combatSessionId\":\"${combat_session_id}\",\"maxSteps\":1}")"
  cat "${tick_out}"
fi

if [[ -n "${character_id}" ]]; then
  hdr "mythic-generate-loot"
  loot_out="$(curl_json mythic-generate-loot "{\"campaignId\":\"${campaign_id}\",\"characterId\":\"${character_id}\",\"count\":1,\"source\":\"smoke\"}")"
  cat "${loot_out}"

  if [[ -n "${skill_ids_csv}" ]]; then
    first_four="$(node -e "const ids=(process.argv[1]||'').split(',').filter(Boolean).slice(0,4); console.log(JSON.stringify(ids));" "${skill_ids_csv}")"
    hdr "mythic-set-loadout"
    loadout_out="$(curl_json mythic-set-loadout "{\"campaignId\":\"${campaign_id}\",\"characterId\":\"${character_id}\",\"name\":\"Smoke\",\"skillIds\":${first_four},\"activate\":true}")"
    cat "${loadout_out}"

    hdr "mythic-recompute-character"
    recompute_out="$(curl_json mythic-recompute-character "{\"campaignId\":\"${campaign_id}\",\"characterId\":\"${character_id}\"}")"
    cat "${recompute_out}"
  fi
fi

if [[ -n "${vendor_id}" ]]; then
  hdr "mythic-shop-stock"
  stock_out="$(curl_json mythic-shop-stock "{\"campaignId\":\"${campaign_id}\",\"vendorId\":\"${vendor_id}\"}")"
  cat "${stock_out}"
fi

hdr "world-generator (optional auth)"
wg_out="$(curl_json world-generator "$(printf '{"type":"npc","campaignSeed":{"title":%s,"description":%s}}' "$(node -p "JSON.stringify(process.argv[1])" "${CAMPAIGN_NAME}")" "$(node -p "JSON.stringify(process.argv[1])" "${CAMPAIGN_DESCRIPTION}")")")"
cat "${wg_out}"

hdr "world-content-writer (minimal request)"
action_hash="smoke-$(date +%s)-$RANDOM"
wcw_out="$(curl_json world-content-writer "{\"campaignId\":\"${campaign_id}\",\"actionHash\":\"${action_hash}\",\"action\":{\"text\":\"smoke\"}}")"
cat "${wcw_out}"

hdr "mythic-tts (writes audio file)"
tts_out_file="${TMP_DIR}/tts.mp3"
curl -sS -o "${tts_out_file}" \
  -X POST "${BASE_URL}/mythic-tts" \
  -H "authorization: Bearer ${TOKEN}" \
  -H "content-type: application/json" \
  --data "$(printf '{"campaignId":"%s","text":%s,"format":"mp3"}' "${campaign_id}" "$(node -p "JSON.stringify(process.argv[1])" "Mythic smoke test narration.")")"
echo "Saved: ${tts_out_file}"

echo
echo "Smoke complete."
echo "campaign_id=${campaign_id}"
if [[ -n "${character_id}" ]]; then
  echo "character_id=${character_id}"
fi

