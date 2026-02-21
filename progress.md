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
- Deployment:
  - committed and pushed `main` to `origin` and `vault` at commit `8ead222`.
  - deployed VM API to `root@api.mythweaver.online:/opt/mythic-api` via rsync + `docker compose up -d --build --force-recreate`.
  - fixed production TLS binding by setting `MYTHIC_API_SITE=api.mythweaver.online` in VM `.env` and recreating caddy.
  - health checks now pass: `https://api.mythweaver.online/healthz` -> 200.
  - frontend deployed to Vercel production and aliased to `https://mythweaver.online`.
- Post-deploy verification:
  - `./scripts/smoke-vm-functions.sh` pass.
  - `npm run smoke:board` pass.
  - `https://mythweaver.online` opens with title `Saga Spark`.

2026-02-21 (board-only + menu sheet + DM latency continuation)
- Completed right-panel board-only strict path in `NarrativeBoardPage`:
  - board remains primary surface,
  - inspect popup overlays board (hotspot + miss-click),
  - combat-only action rail for Attack/Defend/Recover MP + skill expansion.
- Added stable board interaction test hooks:
  - `data-testid="narrative-board-page"`
  - `data-testid="board-grid-layer"`
  - `data-testid="board-hotspot-*"`
  - `data-testid="board-inspect-card"`
- Updated `tests/right-panel-cards.spec.ts` for popup-first interaction checks (no card-dock assertions).
- Extended player command parser panel type with `shop` (`/menu shop` now type-valid).
- Finished DM backend latency-core call path in `mythic-dungeon-master.ts`:
  - switched request attempts to `mythicOpenAIChatCompletionsStream`,
  - parse streamed deltas via `readModelStreamText`,
  - compacted prompt payload blocks with bounded `jsonInline`,
  - compacted conversational message history with `compactModelMessages`,
  - reduced validation attempts to 2 for earlier deterministic recovery.
- Skill MP readiness normalization:
  - `src/lib/mythic/skillAvailability.ts` now reads cost from `power|mp|amount` consistently.
- Added docs:
  - `docs/BOARD_PLAYER_SHEET_LATENCY_PASS_2026-02-21.md`
  - updated `docs/RIGHT_PANEL_CARD_REBUILD_2026-02-21.md` with superseded note.

Validation run:
- `npm run typecheck` PASS
- `npm run build` PASS
- `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts` PASS (right-panel test skipped without `PLAYWRIGHT_MYTHIC_CAMPAIGN_ID`)
- `./scripts/smoke-vm-functions.sh` PASS
- `npm run smoke:board` PASS
- `npm run smoke:prod` PASS

TODO / next suggested hardening:
- Remove legacy utility drawer panel stack (status/skills/combat/quests/companions/shop) in favor of direct 6-tab character-sheet launcher only.
- Add one deterministic e2e for hotspot-specific town building popup actions once stable campaign fixture is available.
- Capture manual QA notes from real campaign for DM latency perception (time-to-first-token and total turn resolution) to guide next DM tuning pass.
