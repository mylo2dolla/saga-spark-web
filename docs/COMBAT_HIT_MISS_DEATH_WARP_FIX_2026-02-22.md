# Combat Hit/Miss + Death + Warp Fix (2026-02-22)

## Root Cause Summary
- Combat settlement auto-transitioned runtime mode immediately after `combat_end`, which could yank the board out of combat while narration was still resolving.
- Attack resolution had no hit gate, so attacks effectively always landed when range checks passed.
- Dead-state integrity could drift when stale rows had `is_alive=true` with `hp <= 0`.
- Movement events did not always include explicit `target_combatant_id` for actor self-moves, reducing board trail reliability.

## Contracts Locked In
- Combat end is now **manual continue**:
  - Settlement keeps runtime mode on `combat`.
  - Runtime state writes `state_json.combat_resolution.pending=true` with `return_mode`, `won`, `xp_gained`, and `loot`.
  - Transition out of combat is explicit via `mythic-runtime-transition`.
- Hit model is now **deterministic d20 + evasion**:
  - Natural 1 => auto miss.
  - Natural 20 => auto hit.
  - All normal attack actions run through deterministic hit resolution before damage.
- Death invariant is now strict:
  - `hp` normalized to integers in status ticks.
  - `hp <= 0` always implies dead.
  - Dead units are skipped by turn selection and removed from active board token render.
- Event contract now includes `miss`.

## Implementation Notes
- Added deterministic hit resolver module:
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/lib/combat/hitResolution.ts`
- Integrated miss/hit flow in:
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-combat-use-skill.ts`
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-combat-tick.ts`
- Settlement now writes pending combat resolution instead of auto mode warp:
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/lib/combat/settlement.ts`
- Runtime transition clears pending combat resolution on post-combat transition:
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-runtime-transition.ts`
- Migration for event contract + status tick death integrity:
  - `/Users/dev/dev-setup/repos/saga-spark-web/supabase/migrations/20260222093000_mythic_combat_miss_and_death_integrity.sql`
- Frontend manual continue + pending combat UX:
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/screens/MythicGameScreen.tsx`
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/NarrativeBoardPage.tsx`
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/adapters.ts`
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/types.ts`
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/scenes/CombatScene.tsx`
- DM recovery narration now treats combat event batches as combat-first and emits miss lines:
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-dungeon-master.ts`

## Targeted Test Coverage Added
- `/Users/dev/dev-setup/repos/saga-spark-web/tests/combat-hit-miss.spec.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/tests/combat-death-integrity.spec.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/tests/combat-end-manual-continue.spec.ts`

## Validation Matrix
- `npm run typecheck`: pass
- `npm run build`: pass
- `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts tests/combat-visual-parity.spec.ts tests/combat-hit-miss.spec.ts tests/combat-death-integrity.spec.ts tests/combat-end-manual-continue.spec.ts`: pass (`2` passed, `6` skipped due missing `PLAYWRIGHT_MYTHIC_CAMPAIGN_ID`)
- `./scripts/smoke-vm-functions.sh`: pass
- `npm run smoke:board`: pass
- `npm run smoke:prod`: pass

## Runtime Request IDs
- `mythic-dm-context`: `6dd219da-752f-4642-a3ad-da46ee2fe0aa`
- `mythic-dungeon-master`: `ec21bd0d-c0a4-4efb-ab52-2d797ab33766`
- `mythic-runtime-transition:travel`: `66cd6682-cb63-43b7-b25f-251607d78e74`
- `mythic-runtime-transition:dungeon`: `892da0c3-9bba-43bd-8564-8c317891767e`
- `mythic-runtime-transition:town`: `3a5c6b1b-7222-4429-a802-be5e905f47cb`
- `mythic-combat-start`: `389615c9-6aa7-4124-9c17-257797e0986a`

## Production Rollout Lock-In (2026-02-21 UTC)
- Release commit: `a5c95f5`
- Frontend production deploy (Vercel):
  - deployment id: `Ey82PmphLRm4ky4vizSdUEvZw2cn`
  - production url: `https://mythweaver.online`
  - deployment url: `https://saga-spark-bmgge6hkj-mylo2dollas-projects.vercel.app`
- Database migration applied remotely:
  - `20260222093000_mythic_combat_miss_and_death_integrity.sql`
- VM runtime deployment:
  - host: `api.mythweaver.online`
  - path: `/opt/mythic-api` (source-synced + docker recreate)
  - health: `https://api.mythweaver.online/healthz` => `200 {"ok":true}`

## Post-Deploy Smoke IDs (2026-02-21 UTC)
- `mythic-dm-context`: `bcc7e2a0-d79f-4c34-957f-31731d12f84e`
- `mythic-dungeon-master`: `db79465e-19b6-46cd-a1af-68e1aa86f1df`
- `mythic-runtime-transition:travel`: `9efa811f-9428-4b80-8f30-a4a2c8ddc3ed`
- `mythic-runtime-transition:dungeon`: `e30d50b8-d222-4c18-92bf-65a25c0cd8fa`
- `mythic-runtime-transition:town`: `7f61f2e9-4be0-4629-b20f-fb3a6ca572aa`
- `mythic-combat-start`: `d326a1e8-cc77-4a55-80d1-e439ffe8d381`
- `smoke-vm-functions` auth gate sample:
  - `mythic-combat-use-skill`: `7e1f80fd-1988-4eed-ba20-c76db6e00880`
  - `mythic-dungeon-master`: `c6c85895-b09e-46d6-a9c1-78bec344c0a7`
