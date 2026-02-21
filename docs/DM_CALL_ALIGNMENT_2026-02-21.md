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

## Smoke Request IDs (Post-Alignment)
- `mythic-create-campaign`: `98c3a844-46a5-4a55-afd7-ebfa4702da18`
- `mythic-create-character`: `17af6ab9-0ffd-4e5f-a7ee-f78a485a33f1`
- `mythic-dm-context`: `bf04d4b7-8c2d-4afe-95df-83c86e8c8217`
- `mythic-dungeon-master`: `98d22065-343e-4d67-a66f-51c8bf1f1c98`
- `mythic-runtime-transition:travel`: `22ffbff4-a761-4ab0-80a3-d6833fb48f53`
- `mythic-runtime-transition:dungeon`: `888451b0-2acf-4540-be50-c1c071b6e004`
- `mythic-runtime-transition:town`: `a1d7e75d-98aa-4efa-b730-9ff2d6e6019e`
- `mythic-combat-start`: `4c1aa0bb-c6fb-4a59-b3e8-898b2bbae21a`

## Residual Risks
- DM responsiveness is still bounded by upstream model latency variance; this pass reduces avoidable overhead but does not eliminate provider-side jitter.
- Further gains likely require model-tier strategy or caching of structured state slices by turn id.
