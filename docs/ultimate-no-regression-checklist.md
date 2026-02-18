# Ultimate No-Regression Checklist (Mythic + Supabase Edge)

This checklist is designed to keep **zero regressions** while tightening server authority, determinism, and safety guarantees.

Related inventory:
- `/Users/dev/saga-spark-web/docs/edge-functions-inventory.md` (repo-derived, diffable)
- `/Users/dev/saga-spark-web/docs/edge-functions-matrix.md` (human-verified purpose + response shapes)

## A) Preflight (Before Any Deploy)

- [ ] `supabase/functions` contains every required function folder:
  - `mythic-*`, `world-generator`, `world-content-writer`.
- [ ] Supabase project secrets configured (no plaintext in repo):
  - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - `OPENAI_API_KEY`, `OPENAI_MODEL` (Mythic DM)
  - Optional: `OPENAI_TTS_MODEL` (TTS)
- [ ] Canonical DB rows exist (and names match code):
  - `mythic.generator_scripts(name='mythic-weave-core', is_active=true)`
  - `mythic.game_rules(name='mythic-weave-rules-v1')`
  - `mythic.ui_turn_flow_rules(name='mythic-weave-ui-flow-v1')` (if used)
- [ ] DB migrations are applied forward-only:
  - `supabase db push` clean

## B) Campaign Lifecycle

- [ ] Create campaign returns terminal success/error quickly (no stuck UI).
  - Where: `/Users/dev/saga-spark-web/supabase/functions/mythic-create-campaign/index.ts`
  - DB: `public.campaigns`, `public.campaign_members`, `mythic.boards`, `mythic.board_transitions`, `mythic.world_profiles`
- [ ] Join campaign is idempotent (repeat join does not duplicate membership).
  - Where: `/Users/dev/saga-spark-web/supabase/functions/mythic-join-campaign/index.ts`
- [ ] List campaigns returns stable shape and health status hints.
  - Where: `/Users/dev/saga-spark-web/supabase/functions/mythic-list-campaigns/index.ts`

## C) Character Creation + Progression

- [ ] Create character is idempotent and cannot hang indefinitely.
  - Where: `/Users/dev/saga-spark-web/supabase/functions/mythic-create-character/index.ts`
- [ ] Apply XP is server-authoritative and writes an audit trail.
  - Where: `/Users/dev/saga-spark-web/supabase/functions/mythic-apply-xp/index.ts`
  - DB: RPC `mythic.apply_xp` and wrapper `public.mythic_apply_xp`
- [ ] Loadouts enforce slot limits by level on the server.
  - Where: `/Users/dev/saga-spark-web/supabase/functions/mythic-set-loadout/index.ts`

## D) Canonical Turn Engine (MUST BE TRUE)

Goal:
- **Only one** place calls the DM, validates output, applies patches, and commits the turn atomically.

- [ ] Authoritative turn resolver is `mythic-dungeon-master`.
  - Where: `/Users/dev/saga-spark-web/supabase/functions/mythic-dungeon-master/index.ts`
- [ ] Turn commits are atomic:
  - If DM output fails validation, **no DB state mutates**.
  - Where: Postgres function `mythic.commit_turn(...)` (transactional)
- [ ] DM output validation + regeneration exists:
  - validate once
  - retry once with validation errors
  - fallback safe narration with **no mutation** if still invalid

## E) World Persistence / Learning / Reaction

These are the minimum append-only/persistence tables expected:
- [ ] `mythic.turns` (turn record + seed + request/response JSON + roll log)
- [ ] `mythic.world_state` (world_time, heat/notoriety, last_tick)
- [ ] `mythic.world_facts` (supersession model)
- [ ] `mythic.world_entities` (NPCs, quests, locations, vendors, etc.)
- [ ] `mythic.relationships`
- [ ] `mythic.audit_log`
- [ ] `mythic.content_flags`

World tick:
- [ ] World time advances per turn by board type.
- [ ] Heat/notoriety affects encounter selection (even if minimally).
- [ ] Faction/world tick runs lazily on turn commit using `last_tick_at` (no cron required initially).

## F) Math / Determinism

- [ ] Turn seed is stored and derived deterministically:
  - seed = H(campaign_seed, turn_index, character_id, server_salt)
- [ ] All randomness is derived from `(turn_seed, roll_index)` and logged.
  - `roll_log` stored per turn
- [ ] Replay with same seed reproduces the same roll log and resulting patches.

## G) Combat Engine

- [ ] Combat state is DB-truth (grid coordinates, HP, action log append-only).
  - Where: `mythic.combat_sessions`, `mythic.combatants`, `mythic.action_events`
- [ ] `mythic-combat-use-skill` validates:
  - turn ownership
  - range/LOS
  - cooldown/cost
  - target validity
- [ ] `mythic-combat-tick` is deterministic for NPCs/bosses and advances turn order safely.

## H) Shops / Economy

- [ ] `mythic-shop-stock` is deterministic + persists stock in board state.
- [ ] `mythic-shop-buy` is server-authoritative:
  - validates coins/resources
  - inserts items/inventory atomically
  - writes audit + memory events

## I) Safety / Content Policy (Server-Side)

Allowed in DM output:
- gore/violence/profanity
- mild sexuality / playful banter

Disallowed:
- sexual violence, coercion, rape
- minors/underage sexual content
- explicit pornographic sex acts/anatomy

- [ ] Enforced server-side:
  - validate DM output text fields
  - retry once with violation details
  - fallback safe response and **no mutation** if still invalid

Where:
- `/Users/dev/saga-spark-web/supabase/functions/_shared/content_policy.ts`
- Postgres: `mythic.contains_forbidden_sexual_content(text)` (or successor functions)

## J) Observability

- [ ] Every meaningful action writes:
  - `mythic.audit_log` (game-level)
  - `mythic.operation_audit` (ops-level) where applicable
- [ ] Every error response includes an actionable:
  - `code`
  - `requestId`

## K) Verification (Minimum Manual Smoke)

1. Login
2. Create campaign
3. Bootstrap mythic
4. Create character
5. Open Mythic page
6. Send DM message
7. Confirm a turn record exists and DB state matches narration
8. Start combat -> use skill -> tick NPC
9. Buy an item from shop

## L) Verification (Function-Level)

- [ ] Invalid token => `401`
- [ ] Valid token, no campaign access => `403`
- [ ] DM output invalid => no DB mutation
- [ ] Determinism: same seed => same roll log
