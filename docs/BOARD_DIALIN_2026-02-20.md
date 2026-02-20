# Board Dial-In Report - 2026-02-20

## Scope
- Repo: `/Users/dev/dev-setup/repos/saga-spark-web`
- Workstream: board2 interaction/readability stabilization across `town`, `travel`, `dungeon`, and `combat`
- Runtime boundary: Supabase auth/db only; gameplay runtime VM functions only

## Changes Applied
- Added shared board primitives:
  - `src/ui/components/mythic/board2/BoardGridLayer.tsx`
  - `src/ui/components/mythic/board2/HotspotOverlay.tsx`
  - `src/ui/components/mythic/board2/BoardLegend.tsx`
- Added non-breaking board scene metadata contracts:
  - hotspot visual tier/icon/emphasis
  - scene legend rows
  - scene layout seed/version
- Refactored scene renderers onto shared primitives:
  - `src/ui/components/mythic/board2/scenes/TownScene.tsx`
  - `src/ui/components/mythic/board2/scenes/TravelScene.tsx`
  - `src/ui/components/mythic/board2/scenes/DungeonScene.tsx`
  - `src/ui/components/mythic/board2/scenes/CombatScene.tsx`
- Improved adapter stability/readability:
  - deterministic ordering for core lists
  - explicit travel path placement
  - richer hotspot metadata and visual tiers
  - legend/layout seed generation
- Tightened action quality and traceability:
  - enhanced dedupe/low-signal filtering in `actionBuilders.ts`
  - source-labeled action strip and richer inspect card UX
  - stale inspect target reconciliation on scene refresh
- Integrated source-hint wiring from `MythicGameScreen` into `NarrativeBoardPage`.

## Automated Validation
- `npm run typecheck` -> pass
- `npm run build` -> pass
- `npx playwright test tests/game-smoke.spec.ts` -> pass (2/2)
- `./scripts/smoke-vm-functions.sh` -> pass
- `npm run smoke:board` -> pass
  - `mythic-create-campaign`: `18302ad7-a78a-4697-9cbb-784ac4e3a0e8`
  - `mythic-create-character`: `d402bdde-17e3-42bf-9aa7-a18f090a4672`
  - `mythic-dm-context`: `a4d4f730-db4f-45ea-b550-454344aafa04`
  - `mythic-dungeon-master`: `a14adafa-5b8e-4b85-a2a5-63cce0590822`
  - `mythic-runtime-transition:travel`: `ec35fa64-3f0d-49cc-b9b5-2cd69d554c2f`
  - `mythic-runtime-transition:dungeon`: `aec98157-c341-4312-baf5-6fd740712b2f`
  - `mythic-runtime-transition:town`: `15c83243-3a70-4d7c-86f9-abcfb3b15deb`
  - `mythic-combat-start`: `ac4690cd-89d0-4189-927f-a1766a5dbb36`

## Manual Board QA (Disposable Campaign)
- Campaign: `dcbacd5b-0162-4e71-9064-6338cbb923c0` (cleaned up after QA)
- Town:
  - vendor hotspot opens inspect card first -> pass
  - explicit inspect action triggers DM run -> pass
- Travel:
  - board miss-click opens probe inspect card only -> pass
  - no auto-execution from miss-click -> pass
- Dungeon:
  - door hotspot inspect metadata includes `from_room_id` + `to_room_id` -> pass
- Combat:
  - inspect-first hotspot behavior confirmed -> pass
  - quick-cast execution remained turn-gated during manual run (`Not your turn`) -> partial/manual deferred

## Additional Runtime Checks (Disposable QA)
- Manual runtime transitions via authenticated API:
  - `town` requestId `2cda7cfd-5f69-48d4-ab28-7a3a7bec666c`
  - `travel` requestId `21831508-fbda-4a60-acaf-f9ac99cbfd56`
  - `dungeon` requestId `fa265df3-b4e6-4067-88fd-ef9c6f2ef7b3`
  - `town` requestId `80e6bedb-d773-4429-9d2e-4efa64d72f2f`
  - `travel` requestId `446580ba-68ac-4d76-865d-cc9f7941026c`
  - `dungeon` requestId `428215b6-2544-4260-a173-6a20dc6b42a2`
- Combat start sanity:
  - requestId `0ef95839-a483-4bdf-b74d-05a3236d63f5`

## Pass/Fail Matrix
- Interaction contract (inspect-first + miss-click no auto-run): pass
- Action source integrity + dedupe: pass
- Mode scene readability uplift: pass
- Dungeon payload semantics (`room_id`, `to_room_id`): pass
- Combat quick-cast manual execution (UI path): partial (turn-gated in disposable run)
- VM runtime contract stability: pass
- `turn_commit_failed` regression: not observed

## Residual Notes
- During explicit user-triggered DM cancel actions, expected cancel logs/toasts may still appear in console diagnostics.
- Real-campaign manual QA remains recommended as a follow-up after this disposable verification pass.
