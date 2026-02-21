# Player UI + DM Alignment (2026-02-21)

## Scope
This pass shipped three staged fixes in one release lane:
1. Fixed right-panel quick-card click dead state.
2. Switched Mythic game UI to player-facing mode by default.
3. Tuned DM call filtering and DM style profile for stronger tactical voice consistency.

Supabase remains auth/db only. Gameplay runtime remains VM-hosted via `VITE_MYTHIC_FUNCTIONS_BASE_URL`.

## Player Mode vs Dev Mode

| Surface | Player Mode (default) | Dev Mode (`VITE_MYTHIC_DEV_SURFACES=true` + toggle on) |
| --- | --- | --- |
| Utility tabs | `Panels`, `Settings` | `Panels`, `Settings`, `Logs`, `Diagnostics` |
| Right-panel warnings | Player-safe copy | Full technical details (codes/request IDs) |
| Inspect detail | Narrative/context only | Source, grid coordinates, metadata rows |
| Actions detail | No provenance badges | Source badges visible (`inspect`, `runtime`, etc.) |
| Feed detail | Gameplay-readable rows | Adds turn/time technical detail |

## Card Click Regression
- Root cause: `PopoverTrigger` / `DrawerTrigger` used `asChild`, but dock card trigger component did not forward injected props/ref to the native `button`.
- Fix:
  - `src/ui/components/mythic/board2/BoardCardDock.tsx` now uses a `forwardRef` trigger (`PreviewCard`) that spreads trigger props/ref to `<button>`.
  - Added stable test IDs: `board-card-trigger-*`.

## DM Alignment Updates

### Frontend hook
- File: `src/hooks/useMythicDungeonMaster.ts`
- Added stricter low-signal action filtering for labels and generic prompt shells.
- Keeps stale-response sequence guards and error classification unchanged.

### VM DM function
- File: `services/mythic-api/src/functions/mythic-dungeon-master.ts`
- Added explicit DM style profile: `dark_tactical_with_bite.v1`.
- Injected style profile directives into system prompt.
- Applied style-consistent recovery narration/mood so fallback output matches primary persona.
- Widened narration validation tolerance to reduce unnecessary recovery churn:
  - Target range now `52-110` words.
  - Validation hard bounds loosened slightly while keeping compact output.
- No response envelope or intent schema keys changed.

## Validation Matrix
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npx playwright test tests/game-smoke.spec.ts`: PASS
- `./scripts/smoke-vm-functions.sh`: PASS
- `npm run smoke:board`: PASS
- `npm run smoke:prod`: PASS
- `npx playwright test tests/right-panel-cards.spec.ts`: SKIPPED (requires `PLAYWRIGHT_MYTHIC_CAMPAIGN_ID`)

## Smoke Request IDs (Board Auth Smoke)
- `mythic-create-campaign`: `fb13442e-2189-4426-a0b7-52c48fab40c5`
- `mythic-create-character`: `90fdb9fa-2768-4c56-bd9e-12414fc4f4ef`
- `mythic-dm-context`: `bec4f0f4-c99e-45f7-8656-509b96789017`
- `mythic-dungeon-master`: `cc6ffd5a-26c8-4c30-b7bb-f87502323d3c`
- `mythic-runtime-transition:travel`: `7598ca53-7f0b-4ce0-9f79-e5bde01aa4af`
- `mythic-runtime-transition:dungeon`: `98920edb-fb8e-4729-ae55-1b2fd9a6d256`
- `mythic-runtime-transition:town`: `528953e3-2cf6-4537-9b3d-338feadd320f`
- `mythic-combat-start`: `6c34338b-b948-4f7f-96b6-e063add7027b`
