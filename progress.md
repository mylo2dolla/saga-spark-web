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

2026-02-22 (RPG math + progression modular rules pass)
- Added canonical modular rules package under `src/rules`:
  - `schema.ts`, `constants.ts`, `leveling.ts`, `stats.ts`, `combatMath.ts`, `skills.ts`, `status.ts`, `loot.ts`, `equipment.ts`, `economy.ts`, `qol.ts`, `simulateFight.ts`
- Added root compatibility exports under `rules/` to match requested module paths.
- Added simulation harness and balance tests:
  - `tests/sim/simulateFight.ts`
  - `tests/sim/balance.sim.test.ts`
- Added dev tuning surface:
  - `src/debug/BalancePanel.tsx`
  - mounted in `src/App.tsx`
  - root compatibility export `debug/BalancePanel.tsx`
- Character sheet adapter now builds canonical rules-backed view model with:
  - rule version,
  - derived stats/resistances/status summaries/tooltips,
  - rank+power skill summaries,
  - rule-based inventory auto-sort.
- Combat + DM context rule-version wiring:
  - `services/mythic-api/src/lib/rules/version.ts`
  - `mythic-combat-use-skill`, `mythic-combat-tick`, `mythic-dm-context` now emit `rule_version` metadata.
  - frontend combat snapshots/log diagnostics surface rule version.
- Added rules documentation:
  - `docs/rules.md`

TODO / next suggested hardening:
- Replace remaining DB RPC combat calculations (`mythic_compute_damage`, `mythic_status_apply_chance`) with shared TS rules calls for full single-source parity.
- Add one focused e2e that opens the dev balance panel and verifies tune values reflect in table outputs.
- Expand status simulation coverage for stacking mode edge cases (`stack` cap pressure and `intensity` overflow behavior).

2026-02-22 (follow-up hardening pass: forge inspector + determinism + DM budget + backfill + CI gate)
- Added shared worldforge helper modules:
  - `services/mythic-api/src/lib/worldforge/context_bindings.ts`
  - `services/mythic-api/src/lib/worldforge/prompt_budget.ts`
  - exported from `services/mythic-api/src/lib/worldforge/index.ts`
- Switched backend world-context payload wiring to shared builders in:
  - `mythic-create-campaign.ts`
  - `mythic-bootstrap.ts`
  - `mythic-join-campaign.ts`
  - `mythic-runtime-transition.ts`
  - `mythic-dm-context.ts`
- Added DM prompt budget guardrail in `mythic-dungeon-master.ts`:
  - deterministic world-context compaction via `buildPromptWorldContextBlock`
  - budget trim warnings emitted into runtime warnings list
  - request logs now include world prompt budget/trim metrics
- Added endpoint/worldforge contract snapshot tests:
  - `services/mythic-api/src/lib/worldforge/worldforge.contracts.test.ts`
  - `services/mythic-api/package.json` script: `test:worldforge:contracts`
- Frontend debug integration:
  - `useMythicDmContext.ts` now publishes snapshots into `mythicDebugStore`
  - `BalancePanel.tsx` expanded with:
    - Forge Inspector (seed/tone/preset trace/forge inputs)
    - diff vs previous snapshot
    - world-state timeline/faction/rumor/collapsed dungeon tables
- Character Forge UX expanded in `MythicCharacterCreator.tsx`:
  - origin region, faction alignment, background, personality traits, moral leaning
  - lock toggles + deterministic randomize unlocked fields
  - values passed into create-character request
- `useMythicCreator.ts` now normalizes forge fields and includes them in idempotency key fingerprint.
- Added world profile migration/backfill script:
  - `scripts/backfill-worldforge-profiles.ts`
  - updates both profile tables + optional active runtime patch
  - supports `--campaign-id`/`--all`, dry-run safety, and explicit `--yes`
- Added balance drift gate:
  - root script `test:balance:gate`
  - workflow `.github/workflows/balance-gate.yml`

TODO / verification remaining in this pass:
- run full typecheck for root + mythic-api
- run worldforge tests (including new contract snapshots)
- run balance gate test command
- resolve any compile/test fallout from new UI + helper wiring

Validation run complete (same pass):
- `services/mythic-api`: `npm run check` PASS
- `services/mythic-api`: `npm run test:worldforge && npm run test:worldforge:contracts` PASS
- repo root: `npm run typecheck` PASS
- repo root: `npm run test:balance:gate` PASS
- repo root: `npx tsx scripts/backfill-worldforge-profiles.ts --help` PASS
