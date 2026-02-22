# Combat Parity + Voice Pacing + Rewards (2026-02-21)

## Scope
This pass ships combat parity and pacing stability without changing endpoint names or DB schema:
- authoritative combat truth sync before DM narration
- strict non-player step cadence (`maxSteps: 1`) with voice-gated pacing
- compact per-action combat recovery narration (no generic "resolved N steps" output)
- movement/range readability improvements on board
- combat-end XP/loot reward surfacing on board and character sheet

## Contracts
- No endpoint removals or renames.
- Existing `mythic-combat-use-skill` built-in `basic_move` remains canonical movement action.
- Existing append-only action event stream remains authoritative.
- Legacy panel/loadout normalization behavior unchanged in parser boundaries.

## Frontend Changes
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/screens/MythicGameScreen.tsx`
  - `runNarratedAction` now refreshes authoritative combat + board state before DM send.
  - failure prompts are now explicit when mutation fails.
  - non-player auto-turn now runs strict one-step cadence with pace state:
    - `idle`
    - `step_committed`
    - `narrating`
    - `waiting_voice_end`
    - `next_step_ready`
  - voice gate uses `isSpeaking` + `speechEndedAt` and a 12s deadlock guard.
  - board scene input now includes `paceState` and `rewardSummary`.
  - combat action contexts include `combat_event_batch` for grounded narration.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/hooks/useMythicDmVoice.ts`
  - exposes `isSpeaking`, `utteranceId`, `speechStartedAt`, `speechEndedAt`.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/hooks/useMythicCombat.ts`
  - combat mutation responses return normalized snapshot + recent event batch.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/hooks/useMythicCombatState.ts`
  - `refetch` returns normalized snapshot.
  - combatant row typing expanded to include combat stat fields used by board adapters.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/types.ts`
  - additive models: `CombatStepResolutionModel`, `CombatPaceStateModel`, `CombatRewardSummaryModel`.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/adapters.ts`
  - parses movement tiles, move budget/usage, distance-to-focus, step resolutions, reward model, pace model.
  - uses authoritative combatant HP/MP as primary display truth.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/scenes/CombatScene.tsx`
  - stronger turn/pacing cues, movement overlays, compact impact log, reward banner.
  - token keys now include turn index for immediate turn-state re-render.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/character2/types.ts`
  - additive `CharacterCombatRewardSummary` + `lastCombatReward` field on view model.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/character2/adapters.ts`
  - forwards latest combat reward summary into character sheet model.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/character2/CharacterSheetSections.tsx`
  - displays last combat XP/loot result in Overview and Combat tabs.

## Backend DM Changes
- `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-dungeon-master.ts`
  - combat payload compaction now preserves short event details (actor/target/amount/status/move coords).
  - recovery synthesis now generates per-action combat lines from authoritative `combat_event_batch`.
  - removed generic combat recovery phrasing in favor of concrete event narration.
  - prompt rules now explicitly require short action-by-action combat narration and ban generic "resolved steps" filler.

## Right-Panel / UI Test Coverage Update
- `/Users/dev/dev-setup/repos/saga-spark-web/tests/right-panel-cards.spec.ts`
  - validates inspect popup opening behavior.
  - validates combat rail remains board-first and exposes core actions when present.

## Validation Matrix
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts`: PASS (`2 passed`, `2 skipped` due campaign env gating)
- `./scripts/smoke-vm-functions.sh`: PASS (auth-required endpoints return expected `401 auth_required`)
- `npm run smoke:board`: PASS (authenticated end-to-end)
- `npm run smoke:prod`: PASS

## Key Request IDs (This Run)
Authenticated board/runtime smoke:
- `mythic-create-campaign`: `cb18460a-f6ab-45d9-9614-c540eebc8d4b`
- `mythic-create-character`: `96ef41c0-f31b-455f-b02d-f68a6ded167a`
- `mythic-dm-context`: `24c8611a-b84f-464a-a6da-3d5aa1a7dfa6`
- `mythic-dungeon-master`: `c560bc36-f2b3-48a7-9f23-390d4517e3f7`
- `mythic-runtime-transition:travel`: `9eea0adc-2d76-4962-b0c1-25f3674dcfa9`
- `mythic-runtime-transition:dungeon`: `3c7fdeea-830f-47d3-bc8e-24e11327f6c1`
- `mythic-runtime-transition:town`: `9dd42333-3068-4e72-9fa1-781d1c23fb4c`
- `mythic-combat-start`: `7e9d99ac-3c8f-41a4-a239-2a4dfffdf3db`

VM function auth-smoke sample IDs:
- `mythic-combat-use-skill`: `9fee205b-3213-40f6-9ea9-8c476c9c0651`
- `mythic-dungeon-master`: `bc1ceaed-1a2c-45af-8759-c02cfa97f7fe`

## Fallback/Timeout Behavior
- Strict step pacing waits for voice completion only when voice is enabled + supported + not blocked.
- If voice gate deadlocks, auto-turn proceeds after 12 seconds and logs `mythic.combat.voice_gate_timeout`.
- Combat rewards remain authoritative-first and only surface after confirmed `combat_end`/`xp_gain`/`loot_drop` events.

## Production Deploy Verification (2026-02-21)
- Frontend commit live: `e3043fb7437650e51bc5370bc383c81d2713507d`
- Frontend production alias: `https://mythweaver.online`
- VM API runtime path: `/opt/saga-spark-web/services/mythic-api` (synced from local `services/mythic-api` and rebuilt via Docker Compose)
- VM API health check: `http://127.0.0.1:3001/healthz` returned `200 {"ok":true}`

Post-deploy authenticated board smoke IDs:
- `mythic-create-campaign`: `2674f941-ea06-43c9-ad0b-dfebe1135eec`
- `mythic-create-character`: `9c505650-3e59-4584-a5c0-766168561a8b`
- `mythic-dm-context`: `37f20523-c8ec-4d30-82d1-75a0f5839a68`
- `mythic-dungeon-master`: `0a237407-b8ed-4d2b-9825-ad19c43a150c`
- `mythic-runtime-transition:travel`: `c60fb8fe-77ab-4e7c-912a-c4d45b264420`
- `mythic-runtime-transition:dungeon`: `baa3dfca-e778-4b5e-a597-941bd759c0f8`
- `mythic-runtime-transition:town`: `95f9f115-0ae5-4f52-a9c7-c95147087589`
- `mythic-combat-start`: `b58e1b8b-fadb-4e65-997b-79320acadf27`
