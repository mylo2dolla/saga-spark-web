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

## Ops Lock Addendum (2026-02-22 completion)
- Canonical deploy guard now verifies:
  - `vault` remote exists
  - `vault/main` is fetchable
  - compose config validates in `/opt/saga-spark-web/services/mythic-api`
  - runtime `.env` exists
  - reports branch, local head, `vault/main` head, ahead/behind, and dirty-line count
- Guard command:
  - `npm run vm:deploy:guard`
- Canonical deploy path remains:
  - repo checkout: `/opt/saga-spark-web`
  - runtime service: `/opt/saga-spark-web/services/mythic-api`

## Rollout Verification (2026-02-22 UTC)
- Release commit: `42fa670`
- Frontend production alias: `https://mythweaver.online`
- Vercel deployment URL: `https://saga-spark-g6upreryt-mylo2dollas-projects.vercel.app`
- VM runtime health:
  - `http://127.0.0.1:3001/healthz` => `{"ok":true}`
  - `https://api.mythweaver.online/healthz` => `{"ok":true}`
- Post-rollout board smoke request IDs:
  - `mythic-create-campaign`: `33656240-39e5-43ce-bf10-dd62afbb7430`
  - `mythic-create-character`: `2856ede4-8822-4e82-aa69-b6efdba8663b`
  - `mythic-dm-context`: `8f04ba1e-e068-4328-af55-115c23032c2f`
  - `mythic-dungeon-master`: `6b03f56c-17b6-414f-8220-2c539c367d70`
  - `mythic-runtime-transition:travel`: `bb945f1d-3d4a-4d24-a35b-0dac4df17c8a`
  - `mythic-runtime-transition:dungeon`: `b740c581-7344-4c66-b7fc-2de045c05a59`
  - `mythic-runtime-transition:town`: `8ba4ebfe-d045-4f12-a3a1-20c390d7e87a`
  - `mythic-combat-start`: `e25eb084-394c-495d-8884-628cad31b96e`

## Pixi Renderer Addendum (2026-02-22)
- Board renderer cutover details are tracked in:
  - `/Users/dev/dev-setup/repos/saga-spark-web/docs/BOARD_RENDER_SNAPSHOT_PIXI_LOCK_2026-02-22.md`
- Renderer rollout remains staged by feature flag:
  - `VITE_MYTHIC_BOARD_RENDERER_DEFAULT`
  - `VITE_MYTHIC_PIXI_CANARY_EMAILS`
  - local override `mythic:board-renderer`

## Rollout Verification (2026-02-22T11:33:23Z)
- Release commit: `34d1e26`
- Frontend production alias: `https://mythweaver.online`
- Vercel inspect URL: `https://vercel.com/mylo2dollas-projects/saga-spark-web/4z4YofkjdSUPCE43pGaHAK1fK6w4`
- Vercel production URL: `https://saga-spark-hkcbt1zmj-mylo2dollas-projects.vercel.app`
- VM runtime path: `/opt/saga-spark-web/services/mythic-api`
- VM deploy mode: `git pull --ff-only vault main` + `docker compose up -d --build --force-recreate`
- VM runtime health:
  - `http://127.0.0.1:3001/healthz` => `{"ok":true}`
  - `https://api.mythweaver.online/healthz` => `{"ok":true}`
- Post-rollout board smoke request IDs:
  - `mythic-create-campaign`: `50aac798-bdfb-4008-8371-4cd89eb9f03a`
  - `mythic-create-character`: `139bd1f7-d9c2-4d56-8810-8268a3ffbff8`
  - `mythic-dm-context`: `e4171d32-1b0b-4ad8-8480-47c4f45dd67c`
  - `mythic-dungeon-master`: `ae243d6a-007c-4a7b-b53c-d2eaacec2c81`
  - `mythic-runtime-transition:travel`: `ea476775-86d4-4c31-8176-f6e13a02c243`
  - `mythic-runtime-transition:dungeon`: `8db69fd3-ad41-4ed4-b39f-f78cfe3f1607`
  - `mythic-runtime-transition:town`: `2b3071bd-d71d-4e4e-a230-4ac651a3fb40`
  - `mythic-combat-start`: `0a874837-edd6-4580-aaf4-5942b42b110b`

## 3-Phase Lock-In Verification (2026-02-22)
- Stability gates:
  - `npm run typecheck` ✅
  - `npm run build` ✅
  - `cd services/mythic-api && npm run check` ✅
  - `cd services/mythic-api && npm run test:worldforge` ✅
  - `cd services/mythic-api && npm run test:worldforge:contracts` ✅
  - `npm run test:balance:gate` ✅
- Gameplay gates:
  - full Playwright matrix in plan scope ✅ (8 passed, 11 env-gated skips)
  - dead-actor suppression + mechanical-error narration suppression paths remained green.
- Renderer rollout:
  - Stage A kept canary/override path intact.
  - Stage B complete: default renderer fallback now resolves to Pixi (`VITE_MYTHIC_BOARD_RENDERER_DEFAULT` fallback = `pixi`) with local/env override support unchanged.
- Latest board smoke request IDs:
  - `mythic-create-campaign`: `80b48289-1e5a-4df2-a599-f8c64237b2be`
  - `mythic-create-character`: `f4223898-c1cb-4d5e-8fe5-5e4a1a01b8a7`
  - `mythic-dm-context`: `43bbc5c0-33d9-4164-898a-c207ccbd460f`
  - `mythic-dungeon-master`: `2934a239-dc89-4566-a425-91b14462d4af`
  - `mythic-runtime-transition:travel`: `9343518e-f49b-47ec-bc28-a90028650275`
  - `mythic-runtime-transition:dungeon`: `d277ed8c-d5f2-4938-b3d7-fc48b98a826b`
  - `mythic-runtime-transition:town`: `6dbeeb44-c127-4efe-9e1b-65d624c07728`
  - `mythic-combat-start`: `a8856eec-ed79-4c39-a3bf-e8fabfab1967`

## Production Rollout Verification (2026-02-22, commit `a1d8758`)
- Frontend production alias: `https://mythweaver.online`
- Vercel inspect URL: `https://vercel.com/mylo2dollas-projects/saga-spark-web/4UuHzd5P41uX8M5xsmdjpXjb2WSq`
- Vercel production URL: `https://saga-spark-14a6zubms-mylo2dollas-projects.vercel.app`
- VM runtime deploy path: `/opt/saga-spark-web/services/mythic-api`
- VM deploy mode: `git pull --ff-only vault main` + `docker compose up -d --build --force-recreate`
- Post-rollout smoke request IDs:
  - `mythic-create-campaign`: `266ab98f-1e50-4f98-95cc-22ad77e0f71a`
  - `mythic-create-character`: `38a4024d-0345-4a56-aed7-e12ac21bcf60`
  - `mythic-dm-context`: `80d511e5-597d-47a8-9d47-f7440b457cfc`
  - `mythic-dungeon-master`: `8ba858ad-bb46-4331-870a-f2d8dedde790`
  - `mythic-runtime-transition:travel`: `e5a05286-0025-453d-a75a-12a6c94d1946`
  - `mythic-runtime-transition:dungeon`: `293cc64b-c22a-4726-bf40-0e8d35c92e68`
  - `mythic-runtime-transition:town`: `558bc567-4737-4999-a7e6-6d91dda430a1`
  - `mythic-combat-start`: `11a33535-fc20-48bb-89a1-ebdd0b8ebe0e`
