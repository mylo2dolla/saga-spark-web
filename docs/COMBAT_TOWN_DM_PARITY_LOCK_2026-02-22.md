# Combat + Town + DM Parity Lock (2026-02-22)

## Scope
Two-wave stabilization on one branch:
1. Wave 0: VM runtime deploy path cutover to canonical git checkout.
2. Wave 1: Combat readability + DM narration alignment + naming cutover.
3. Wave 2: Town liveness (NPC movement/relationship/grudge memory) + duplicate town render fix.

## Wave 0 Ops Lock
- VM canonical path is now `/opt/saga-spark-web/services/mythic-api`.
- Deploy guard script added: `/Users/dev/dev-setup/repos/saga-spark-web/scripts/vm-deploy-guard.sh`.
- `package.json` script added: `npm run vm:deploy:guard`.
- Expected deploy flow: pull via git (`vault` remote) in `/opt/saga-spark-web`, then `docker compose up -d --build --force-recreate` from service path.

## Wave 1 Changes
### DM alignment (`mythic-dungeon-master`)
- Recovery narration now avoids internal action ids and low-signal mechanical filler.
- Combat recovery lines consume authoritative event batches and synthesize actor/target prose.
- Sanitizer added to strip internal tokens (`campaign_*`, `_vN`) and banned filler phrases.
- Combat board context is forced when `actionContext.combat_event_batch` exists.
- Combat mode action sanitization blocks non-combat transition intents from being emitted.

### Frontend combat guardrails
- Mechanical failure detection broadened in `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/screens/MythicGameScreen.tsx` so combat command failures do not trigger fallback narration.

### Combat board parity
- Added board rendering support for: `status_tick`, `status_expired`, `armor_shred`, `death`, `miss`, `moved`.
- Added status-family aura overlays (bleed/poison/burn/guard/barrier/vulnerable/stunned).
- Added snapshot-diff movement trail fallback when movement events are missing.
- Kept dead-token immediate removal behavior (`hp <= 0` and alive filtering).

### Naming cutover
- Enemy pool names in `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-combat-start.ts` replaced with fantasy-forward sets.
- Deterministic skill naming banks and base templates updated in `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-create-character.ts`.
- Backfill script added: `/Users/dev/dev-setup/repos/saga-spark-web/scripts/backfill-mythic-naming-cutover.ts`.

## Wave 2 Changes
### Town duplicate rendering fix
- Removed duplicate label path by keeping one canonical interactive text layer:
  - Landmarks are now background-only blocks.
  - Clickable labels remain in one overlay path.
- Files:
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/scenes/TownScene.tsx`
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/HotspotOverlay.tsx`

### Town liveness + memory model
- Added additive runtime state fields in `campaign_runtime.state_json`:
  - `town_npcs`
  - `town_relationships`
  - `town_grudges`
  - `town_activity_log`
  - `town_clock`
- Runtime transition now advances deterministic NPC schedule/mood/location and persists relationship/grudge changes.
- Town NPC interactions append memory events and apply faction reputation deltas when mapped.
- Files:
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-runtime-transition.ts`
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-dm-context.ts`
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/adapters.ts`
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/scenes/TownScene.tsx`

## Typing Updates
- Additive board state typing in `/Users/dev/dev-setup/repos/saga-spark-web/src/types/mythic.ts`.
- Additive board scene typing in `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/types.ts`.

## Validation Matrix
### Local/CI checks
- `npm run typecheck` ✅
- `npm run build` ✅
- `npm run check` in `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api` ✅

### Playwright
- `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts tests/combat-visual-parity.spec.ts tests/combat-narration-signal.spec.ts tests/town-board-liveness.spec.ts` ✅
  - Passed: `game-smoke` (2)
  - Skipped (env-gated): combat/town targeted suite (5)
- `npm run smoke:prod` ✅

### VM/runtime smoke
- `./scripts/smoke-vm-functions.sh` ✅
- `npm run smoke:board` ✅

## Request IDs (Auth board smoke)
- `mythic-create-campaign`: `2f95c20e-c32a-43fc-82e6-66e414173aca`
- `mythic-create-character`: `9f822bcc-fb4e-4774-af68-cc61e8a97178`
- `mythic-dm-context`: `481f3f1a-ea29-494f-8ade-7063360e3f04`
- `mythic-dungeon-master`: `ad939c68-9a1a-473f-b3d1-e49162e0c407`
- `mythic-runtime-transition:travel`: `33ea7edb-28d5-420f-a8e1-fe6761b616e5`
- `mythic-runtime-transition:dungeon`: `febd3a45-c494-40d6-ac49-21d415e7568d`
- `mythic-runtime-transition:town`: `4d9d3ab3-50d5-4a11-af1f-0da9b177cd41`
- `mythic-combat-start`: `5fe52026-795f-45fe-aac2-45458e869d2f`

## Rollback Anchors
- Frontend commit anchor: current branch head at release time.
- VM runtime path anchor: `/opt/saga-spark-web/services/mythic-api`.
- If rollback required, deploy previous git SHA/tag in `/opt/saga-spark-web` and recreate compose from service path.
