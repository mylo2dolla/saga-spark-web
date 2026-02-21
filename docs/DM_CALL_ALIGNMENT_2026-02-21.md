# DM Call Alignment (2026-02-21)

## Scope
This pass audited and tightened the full DM call surface:
- `mythic-dm-context` (VM)
- `mythic-dungeon-master` (VM)
- `useMythicDmContext` (frontend)
- `useMythicDungeonMaster` + queueing/execution path in `MythicGameScreen`

Goal: reduce dead-wait feel, reduce stale/racy context updates, suppress low-signal chips/prompts, and preserve strict authoritative turn commit behavior.

## Fix Matrix

| Surface | Issue | Change | Result |
| --- | --- | --- | --- |
| `src/hooks/useMythicDmContext.ts` | In-flight refresh calls were dropped and could leave context stale under rapid board updates. | Added request sequencing + campaign guard + pending refresh replay after in-flight completion. | Context refresh stays current without stale overwrite on rapid updates. |
| `services/mythic-api/src/functions/mythic-dm-context.ts` | Sequential query chain increased context fetch latency and lacked explicit timing/companion payload in response. | Parallelized independent queries (`rules/script/dm_state/tension/companions`) and added `companions` + `timings_ms.total` to response payload (additive). | Faster context assembly and better parity/debug visibility without breaking contracts. |
| `services/mythic-api/src/functions/mythic-dungeon-master.ts` | Prior assistant JSON turns were passed back verbatim into prompt history, inflating token footprint and slowing completion. | Added assistant-turn compaction (`Narration/Focus/Mood/Actions` summary) and filtered system-role history from replay window. | Smaller prompt footprint and improved response latency consistency. |
| `services/mythic-api/src/functions/mythic-dungeon-master.ts` | Recovery/normalization could still leak low-signal action shapes in edge cases. | Tightened action label/prompt low-signal filters and dedupe key strategy in `sanitizeUiActions`. | Cleaner, mode-relevant action chips and less generic noise. |
| `src/ui/screens/MythicGameScreen.tsx` | Queue dedupe for `dm_prompt` could still allow repeated low-signal prompts with slight wording differences. | Added low-signal narration prompt classifier and shorter canonical dedupe slice for low-signal `dm_prompt` entries. | Reduced duplicate low-value DM call pressure and chip spam. |
| `src/types/mythic.ts` | DM context additive fields were not typed. | Added optional `companions` and `timings_ms` to `MythicDmContextResponse`. | Type-safe consumption of additive response metadata. |

## Contract/Compatibility
- No endpoint removals or renames.
- No breaking response envelope changes.
- Additive only:
  - `mythic-dm-context` now may include:
    - `companions: []`
    - `timings_ms.total`
- Canonical gameplay authority remains VM runtime + committed turn pipeline.
- Supabase remains auth/db only.

## Validation
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `services/mythic-api`: `npm run check`, `npm run build`: PASS
- `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts`: PASS (`right-panel-cards` skipped without campaign env)
- `./scripts/smoke-vm-functions.sh`: PASS
- `npm run smoke:board`: PASS
- `npm run smoke:prod`: PASS

## Production Deploy
- Commit: `26f6cc1`
- Frontend (Vercel):
  - URL: `https://saga-spark-426d0wvwi-mylo2dollas-projects.vercel.app`
  - Alias: `https://mythweaver.online`
  - Deployment ID: `dpl_9vhWkueKHgCWucmJzHQG4gPhACXw`
  - Created: `Sat Feb 21 2026 06:49:08 GMT-0700 (MST)`
- VM runtime:
  - Host: `api.mythweaver.online`
  - Path: `/opt/mythic-api`
  - Deploy method: `docker compose up -d --build --force-recreate`
  - Health check: `GET /healthz` success

## Smoke Request IDs (Post-Deploy)
- `mythic-create-campaign`: `d3b82923-be7a-4950-adad-7c717b235a03`
- `mythic-create-character`: `5e41cd3d-2333-4562-98fe-13e42e9c15a2`
- `mythic-dm-context`: `5850a70f-5c62-4e9b-b7cf-98991ed0273d`
- `mythic-dungeon-master`: `8aa975d1-6d2d-4b12-80b5-fa924d679e05`
- `mythic-runtime-transition:travel`: `044d0f39-ccab-47f4-a060-54fd0e12dda6`
- `mythic-runtime-transition:dungeon`: `1371141b-57b5-4ad9-a0db-22966dea0341`
- `mythic-runtime-transition:town`: `99b2dbfd-9ae8-43d5-a04b-b872fd4dc545`
- `mythic-combat-start`: `6b983abc-68cb-4830-a85b-8dc06452ffb6`

## Residual Risks
- DM responsiveness is still bounded by upstream model latency variance; this pass reduces avoidable overhead but does not eliminate provider-side jitter.
- Further gains likely require model-tier strategy or caching of structured state slices by turn id.
