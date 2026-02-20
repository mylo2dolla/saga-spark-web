Original prompt: Implement Board Combat Dial-In Plan (Basic Actions, MP, Ally/Enemy Turns, Loadout Removal) with VM-hosted gameplay runtime and Supabase only for auth/db.

2026-02-20
- Initialized progress tracking for combat dial-in pass.
- Existing partial work detected: companion spawning started in mythic-combat-start.ts.
- Next: complete mythic-combat-use-skill.ts basic actions + ally logic, then mythic-combat-tick.ts ally/enemy autonomous turns, then board2/UI updates and validation.
- Completed backend combat authority pass:
  - mythic-combat-start.ts: companion ally spawn from campaign_companions (up to 2), deterministic scaling and placement.
  - mythic-combat-use-skill.ts: built-in actions accepted (`basic_attack`, `basic_defend`, `basic_recover_mp`), MP wording, team-aware ally filtering.
  - mythic-combat-tick.ts: autonomous companion turns + team-aware enemy targeting; companions can defend/recover/attack.
- Completed board/UI combat pass:
  - board2 types/adapters extended for allies/enemies, core actions, HUD entities, and recent combat deltas.
  - CombatScene now renders core action buttons, HP/MP gauges, ally/enemy clarity, and short-lived delta markers.
  - actionBuilders now emits core combat chips and combat hotspot attack chips.
- Loadout surface removed from visible panel tabs; legacy panel/loadout intents remap to supported panel paths.
- DM/parser touchups:
  - local parser now treats open-panel intent directly and de-emphasizes loadout wording.
  - VM dungeon-master sanitization remaps legacy loadout panels to non-loadout panels while preserving loadout_action compatibility.
- Validation run results:
  - npm run typecheck: PASS
  - npm run build: PASS
  - npx playwright test tests/game-smoke.spec.ts: PASS
  - ./scripts/smoke-vm-functions.sh: PASS
  - npm run smoke:board: PASS
- Added docs/BOARD_COMBAT_DIALIN_2026-02-20.md with pass/fail matrix + request IDs.
