# Mythic DM Presentation/Naming Overhaul (2026-02-22)

## Scope
This pass shipped presentation-layer stabilization without touching combat math formulas:

- Added deterministic presentation engine modules under `services/mythic-api/src/lib/presentation/`:
  - `deterministic.ts`
  - `toneRotation.ts`
  - `boardNarrationEngine.ts`
  - `enemyPersonality.ts`
  - `spellNameBuilder.ts`
  - `reputationTitleEngine.ts`
  - `narrativeMiddleware.ts`
  - `spectacleEngine.ts`
  - `wordBanks.ts`
- Wired DM recovery output to use the presentation engine and persisted `dm_presentation` state in `runtime_delta` / `board_delta`.
- Added final sanitization guards for non-player-facing leak phrases (including `command:unknown`, `opening move`, and `campaign_intro_opening_*`).
- Enforced combat-step recovery narration from authoritative event batches with dedupe/compression and dead-actor filtering.

## Determinism Contract
- Tone selection, board opener rotation, line dedupe hashes, and verb rotation are all deterministic from state + seed inputs.
- Narration middleware collapses duplicated event signatures per tick and suppresses same-line replays using hash memory.
- Death integrity in presentation path: non-`death` events from actors flagged dead are ignored in recovery narration output.

## Banned Phrase Blocklist (Player Mode)
- `command:unknown`
- `opening move`
- `board answers with hard state`
- `committed pressure lines`
- `commit one decisive move`
- `campaign_intro_opening_*`
- `Resolved X non-player turn steps`

## Before/After Signal
- Before: fallback/system wording leaked into player-visible narration and repeated pressure telemetry phrasing.
- After: recovery output uses board hooks + tone rotation + compressed action beats with internal tokens scrubbed.

## Verification
- `npm run typecheck` ✅
- `npm run build` ✅
- `./scripts/smoke-vm-functions.sh` ✅
- `npm run smoke:board` ✅

### Key Smoke Request IDs
- `mythic-create-campaign`: `921faf82-9e30-4aea-867b-b50d884d1798`
- `mythic-create-character`: `b310be6c-2886-42fd-8963-88877f56e14c`
- `mythic-dm-context`: `8abb8396-8b9b-4fd5-b654-953d44533d53`
- `mythic-dungeon-master`: `f48624df-9603-4414-ab65-00b2d9995acd`
- `mythic-runtime-transition:travel`: `4899ea47-b055-45f3-bcaf-249ed901d5d8`
- `mythic-runtime-transition:dungeon`: `137636f5-9033-4a9b-bd31-337167d1b6ca`
- `mythic-runtime-transition:town`: `2b807949-0125-4a26-8458-626f138a55cc`
- `mythic-combat-start`: `ba8adb6b-5a47-4bd5-b229-937e07bc157b`

## Residuals
- LLM primary path remains active; deterministic presentation recovery now hardens fallback quality and leak prevention.
- Existing campaigns with old generated labels can still carry legacy naming until backfill/reset is run.

## Latest Validation Run (2026-02-22, Post-Integration)
- `mythic-create-campaign`: `39fbd2ba-673a-4f3f-9160-3f3cfe646326`
- `mythic-create-character`: `1c9af930-c92f-47ad-839c-90110edc9667`
- `mythic-dm-context`: `656e24ea-07e8-412e-ac4b-0e1794bfb1e9`
- `mythic-dungeon-master`: `ee437449-910f-4b45-9a22-6913d3bbc5eb`
- `mythic-runtime-transition:travel`: `a6b7b030-ce39-4319-a5bb-93cf81cd9143`
- `mythic-runtime-transition:dungeon`: `160bff64-d981-4d57-b346-e714fb60c124`
- `mythic-runtime-transition:town`: `87aae7b8-7256-47ee-a754-2d6f9a7fe590`
- `mythic-combat-start`: `da9d5f91-5f98-4346-a651-e312ef4498c2`

## Post-Deploy Verification (2026-02-22)
- `mythic-create-campaign`: `245b719d-6822-4d67-957c-d6223b72954c`
- `mythic-create-character`: `b118c863-e84d-4e16-9964-22383c46f6dd`
- `mythic-dm-context`: `e95614ad-87a6-4764-9b09-fc54c6ced525`
- `mythic-dungeon-master`: `c016054e-b9da-4bd5-a6ff-b26ffb4d4624`
- `mythic-runtime-transition:travel`: `046e6afb-93df-48d7-9c8e-5a0bbfbf0f76`
- `mythic-runtime-transition:dungeon`: `8fa09666-d191-485b-8d8a-8fa35be7bae5`
- `mythic-runtime-transition:town`: `e1f259d0-0e69-4ef1-8622-e11c83a1cd5c`
- `mythic-combat-start`: `21e01a2f-cd0a-4d2f-8655-86b82952c3af`
