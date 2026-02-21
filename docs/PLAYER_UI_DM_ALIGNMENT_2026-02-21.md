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

## Follow-Up Latency + Voice Tightening (same date)
- `services/mythic-api/src/functions/mythic-dungeon-master.ts`
  - Reduced DM prompt footprint (shorter message window + tighter serialized state caps) to cut completion latency.
  - Added stronger low-signal action suppression and action dedupe in sanitizer.
  - Replaced generic recovery chips with board-mode tactical actions (especially in combat).
  - Enabled earlier deterministic fast-recovery for critical schema/JSON failures.
  - Slightly reduced generation temperature for more stable tactical output.
- `src/hooks/useMythicDungeonMaster.ts`
  - Added stricter prompt/label low-signal filters and deterministic board-aware fallback chip generation when model actions are weak/empty.
  - Added DM phase progression timers so players see progress (`assembling -> resolving -> committing`) during longer turns.
- `src/ui/components/mythic/NarrativePage.tsx`
  - Updated phase text to player-readable phrasing.

## Follow-Up Production Deploy (Latency + Voice pass)
- Commit: `4723439`
- Frontend (Vercel):
  - URL: `https://saga-spark-keoovvgxt-mylo2dollas-projects.vercel.app`
  - Alias: `https://mythweaver.online`
  - Deployment ID: `dpl_CjRqGYCaNm8J1E5eWSUPxz5H8VBg`
  - Created: `Fri Feb 20 2026 21:23:40 GMT-0700 (MST)`
- VM runtime:
  - Host: `api.mythweaver.online`
  - Path: `/opt/mythic-api`
  - Deploy method: `docker compose up -d --build --force-recreate`
  - Health check: `GET /healthz` success

## Follow-Up Smoke Request IDs
- `mythic-create-campaign`: `f1b63ddd-6267-4131-9efa-79e4faa0307d`
- `mythic-create-character`: `ebc73000-bd95-4eb6-b77e-3f8e826a4501`
- `mythic-dm-context`: `7211068b-1d3b-46c4-b4ea-dce80347e31f`
- `mythic-dungeon-master`: `52ce4a33-f415-4ec4-96bb-d4b192bbcd3e`
- `mythic-runtime-transition:travel`: `90f07ba7-d389-4516-929d-86ca9038f552`
- `mythic-runtime-transition:dungeon`: `00fe4546-0f23-4f42-bb43-927d361a9d4a`
- `mythic-runtime-transition:town`: `16bc56ff-d823-49b0-8688-81593d219c40`
- `mythic-combat-start`: `506d226a-600c-4027-a955-428104a7957e`

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
