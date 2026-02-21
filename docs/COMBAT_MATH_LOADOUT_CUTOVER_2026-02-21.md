# Combat Math Rebalance + Loadout Hard Cutover (2026-02-21)

## Summary
This pass closes two gameplay blockers:
- low-level combat damage felt flat (`1`-ish outcomes dominated).
- loadout legacy paths still leaked into player-facing skill flow.

Implemented outcomes:
- authoritative combat math rebalanced to a 6-10 hit baseline target.
- VM damage application now treats resist and armor as separate stages (no double mitigation).
- enemy HP generation now follows the same formula family as player/companions.
- loadout was removed from active runtime/UI flow; only one-way legacy ingress normalization remains.

## Formula Changes
Migration added:
- `/Users/dev/dev-setup/repos/saga-spark-web/supabase/migrations/20260221190000_mythic_combat_math_rebalance.sql`

Old:
- `attack_rating`: `sqrt(power_at_level) * offense/weapon multipliers`
- `max_hp`: `100 + sqrt(power_at_level) * defense/support multipliers`
- `compute_damage.final_damage`: floating numeric from `mitigate(...)`

New:
- `attack_rating(lvl, offense, weapon_power)`:
  - `round(14 + lvl*1.55 + offense*0.32 + weapon_power*0.40)`
- `max_hp(lvl, defense, support)`:
  - `round(120 + lvl*6.5 + defense*0.95 + support*0.75)`
- `compute_damage.final_damage`:
  - `greatest(1, round(mitigated))` when pre-mitigation damage is positive.

## Runtime Combat Semantics Fix
Updated:
- `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-combat-use-skill.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-combat-tick.ts`

Changes:
- RPC `mythic_compute_damage` now receives only target `resist`.
- armor remains shield-like absorption in post-roll stage only.
- persisted/evented damage values are normalized integer values:
  - `damage_to_hp`
  - `shield_absorbed`
  - `hp_after`
  - `armor_after`

## Combat Start HP Parity
Updated:
- `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/mythic-combat-start.ts`

Changes:
- removed enemy hardcoded `hp/hp_max = 100`.
- enemy HP now uses `mythic_max_hp(lvl, defense, support)` with deterministic variance.
- companion/player HP remain formula-aligned.

## Full Skill Access (No Loadout Gating Feel)
Updated:
- `/Users/dev/dev-setup/repos/saga-spark-web/src/lib/mythic/skillAvailability.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/screens/MythicGameScreen.tsx`

Changes:
- `usableNow` now gates only on actionable constraints:
  - alive, player turn, cooldown, MP.
- focused target/range now remain diagnostics, not hard lock in skill tray.
- quick-cast target selection now falls back to nearest alive hostile.
- out-of-range quick-cast errors now surface clear move guidance.

## Hard Loadout Cutover
### Runtime
- removed handler registration/import from:
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/functions/index.ts`

### Frontend
- removed loadout fetch/state from:
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/hooks/useMythicCharacter.ts`
- removed loadout fields from character bundle types:
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/types/mythic.ts`

### Contract normalization (ingress-only)
- canonical output remains `open_panel` and canonical panel names.
- legacy input still accepted and normalized:
  - `loadout`/`loadouts` -> `skills`
  - `gear` -> `equipment`
- updated in:
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/hooks/useMythicDungeonMaster.ts`
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/lib/mythic/playerCommandParser.ts`
  - `/Users/dev/dev-setup/repos/saga-spark-web/services/mythic-api/src/shared/turn_contract.ts`

### Ops smoke cleanup
- removed `mythic-set-loadout` probe from:
  - `/Users/dev/dev-setup/repos/saga-spark-web/scripts/smoke-vm-functions.sh`

## Validation Matrix
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts`: PASS (`2 passed`, `2 skipped`)
- `./scripts/smoke-vm-functions.sh`: PASS
- `npm run smoke:board`: PASS
- `npm run smoke:prod`: PASS

## Key Request IDs (post-change)
Authenticated board smoke:
- `mythic-create-campaign`: `a37a4dee-5a26-44d9-8e42-5576718aa86c`
- `mythic-create-character`: `79f8d6cf-d143-4ba1-a397-4246b78eaf8f`
- `mythic-dm-context`: `82cbb2c3-e38b-42d3-89ba-50f5ef3b1fab`
- `mythic-dungeon-master`: `ba30e744-7b53-4a73-868a-60ebbb8dc816`
- `mythic-runtime-transition:travel`: `bb0d4b15-19a6-4b5d-813b-934befcb0983`
- `mythic-runtime-transition:dungeon`: `7f837447-9ae2-45d8-9ac5-790af622d19a`
- `mythic-runtime-transition:town`: `5545a5b3-4d72-4929-bdef-f0bf7dc5b2e0`
- `mythic-combat-start`: `7386d799-a9eb-497f-8ac1-b3c116d75d80`

VM auth-smoke sample:
- `mythic-combat-use-skill`: `308308b5-81c6-41d4-b812-4b6c48cb1220`

## Rollback
If combat pacing/damage quality regresses:
1. Revert migration `20260221190000_mythic_combat_math_rebalance.sql` via forward corrective migration restoring prior formulas.
2. Re-enable previous combat handler behavior in:
- `mythic-combat-use-skill.ts`
- `mythic-combat-tick.ts`
3. Rebuild/redeploy VM runtime and re-run:
- `./scripts/smoke-vm-functions.sh`
- `npm run smoke:board`
- `npm run smoke:prod`
