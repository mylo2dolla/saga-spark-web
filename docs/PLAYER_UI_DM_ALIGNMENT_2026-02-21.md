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

## Production Deploy
- Commit: `c5896db`
- Frontend (Vercel):
  - URL: `https://saga-spark-bc66oxquf-mylo2dollas-projects.vercel.app`
  - Alias: `https://mythweaver.online`
  - Deployment ID: `dpl_EUyynKgB4y6eLynQULDmLxyihDeH`
  - Deployed UTC: `2026-02-21T01:05:13Z`
- VM runtime:
  - Host: `api.mythweaver.online`
  - Path: `/opt/mythic-api`
  - Deployed UTC: `2026-02-21T01:06:28Z`
  - Runtime marker SHA (`mythic-dungeon-master.ts`): `7492dd229b3b7ee028c1558bd4b447020394e2e1ddf13f98de0d75f2071aa7cf`

## Smoke Request IDs (Board Auth Smoke, Post-Deploy)
- `mythic-create-campaign`: `aca95f7a-25ab-490c-b63a-f665bac3fcae`
- `mythic-create-character`: `757aacae-afa6-4650-a078-aa61334bc195`
- `mythic-dm-context`: `153e33a0-79a4-4a20-9f38-680f4824d2ee`
- `mythic-dungeon-master`: `d64e762d-40c5-47b3-b6e3-27c8216cdb2e`
- `mythic-runtime-transition:travel`: `7af49449-483a-4bff-ae1e-ea15b6c6c463`
- `mythic-runtime-transition:dungeon`: `8342d94d-493d-4557-af3a-c2ca497d354f`
- `mythic-runtime-transition:town`: `59aa0d95-ff0e-4d25-a7f0-cb1d27b52a60`
- `mythic-combat-start`: `4ea70376-7586-4c31-90a7-36f826562d8d`
