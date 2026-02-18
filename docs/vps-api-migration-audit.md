# VPS API Migration Audit (Supabase Edge -> Self-Hosted Mythic API)

This repo is migrating Supabase Edge Functions to a self-hosted VPS API **without changing function names or client call shapes**.

## Scope / Contract
- Paths stay: `POST /functions/v1/<function-name>` (and `OPTIONS` for CORS preflight).
- Auth stays: `Authorization: Bearer <Supabase access token>`.
- DB stays: Supabase Postgres (service role on server).
- Client change: **base URL only** (see `VITE_MYTHIC_FUNCTIONS_BASE_URL` in `/Users/dev/saga-spark-web/src/lib/edge.ts`).

## Function Mapping

Notes:
- **Auth** column reflects current edge behavior:
  - `required`: edge required a valid bearer token.
  - `optional`: edge accepted missing/invalid auth.
- “Request/Response shape” is a **summary**, not a full schema. The VPS handlers preserve existing JSON fields and add only backward-compatible fields (e.g. `requestId`).

| Function | Edge Impl | VPS Impl | Auth | Request JSON (summary) | Response JSON (summary) | Tables / RPCs touched (summary) |
|---|---|---|---|---|---|---|
| `mythic-apply-xp` | `/Users/dev/saga-spark-web/supabase/functions/mythic-apply-xp/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-apply-xp.ts` | required | `{campaignId, characterId?, amount, reason?, metadata?}` | `{ok:true,result}` or `{error, code?}` | `campaigns`, `campaign_members`, `mythic.characters`, RPC `mythic_apply_xp` |
| `mythic-board-transition` | `/Users/dev/saga-spark-web/supabase/functions/mythic-board-transition/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-board-transition.ts` | required | `{campaignId,toBoardType,reason?,payload?}` | `{ok:true, board, transition}` or `{error, code?, requestId?}` | `campaigns`, `campaign_members`, `mythic.boards`, `mythic.board_transitions`, `mythic.world_profiles` |
| `mythic-bootstrap` | `/Users/dev/saga-spark-web/supabase/functions/mythic-bootstrap/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-bootstrap.ts` | required | `{campaignId}` | `{ok:true, ...}` or `{error, code?, requestId?}` | `campaigns`, `campaign_members`, `mythic.world_profiles`, `mythic.boards`, `mythic.board_transitions` |
| `mythic-combat-start` | `/Users/dev/saga-spark-web/supabase/functions/mythic-combat-start/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-combat-start.ts` | required | `{campaignId, reason?, seed?}` | `{ok:true, combatSessionId, ...}` or `{error, code?, requestId?}` | `mythic.combat_sessions`, `mythic.combatants`, `mythic.turn_order`, `mythic.action_events`, `mythic.boards`, `mythic.board_transitions` |
| `mythic-combat-tick` | `/Users/dev/saga-spark-web/supabase/functions/mythic-combat-tick/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-combat-tick.ts` | required | `{campaignId, combatSessionId, maxSteps?}` | `{ok:true, ...}` or `{error, code?, requestId?}` | `mythic.combat_sessions`, `mythic.combatants`, `mythic.turn_order`, `mythic.action_events` |
| `mythic-combat-use-skill` | `/Users/dev/saga-spark-web/supabase/functions/mythic-combat-use-skill/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-combat-use-skill.ts` | required | `{campaignId, combatSessionId, actorCombatantId, skillId, target:{...}}` | `{ok:true, ...}` or `{error, code?, requestId?}` | `mythic.skills`, `mythic.combat_sessions`, `mythic.combatants`, `mythic.turn_order`, `mythic.action_events`, RPC `mythic_compute_damage` (via SQL) |
| `mythic-create-campaign` | `/Users/dev/saga-spark-web/supabase/functions/mythic-create-campaign/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-create-campaign.ts` | required | `{name, description, template_key?}` | `{ok:true,campaignId,inviteCode,...}` or `{ok:false,error,code?,requestId?}` | `campaigns`, `campaign_members`, `mythic.world_profiles`, `mythic.boards`, `mythic.board_transitions`, `mythic.factions` |
| `mythic-create-character` | `/Users/dev/saga-spark-web/supabase/functions/mythic-create-character/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-create-character.ts` | required | `{campaignId, name, classPrompt, ...}` | `{ok:true, characterId, skills:[...], ...}` or `{error, code?, requestId?}` | `mythic.characters`, `mythic.skills`, `mythic.character_loadouts` (if present), `mythic.inventory` |
| `mythic-dm-context` | `/Users/dev/saga-spark-web/supabase/functions/mythic-dm-context/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-dm-context.ts` | required | `{campaignId}` | `{ok:true, context:{...}}` or `{error, code?, requestId?}` | Views `mythic.v_*_for_dm`, rules/script tables `mythic.generator_scripts`, `mythic.game_rules`, board state `mythic.boards` |
| `mythic-dungeon-master` | `/Users/dev/saga-spark-web/supabase/functions/mythic-dungeon-master/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-dungeon-master.ts` | required | `{campaignId, messages:[...], actionContext?}` | Streaming assistant output (`text/event-stream` or JSON) with `{requestId}` on errors | Reads DM context views + rules, writes `mythic.dm_memory_events` (when enabled), uses OpenAI chat streaming |
| `mythic-field-generate` | `/Users/dev/saga-spark-web/supabase/functions/mythic-field-generate/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-field-generate.ts` | required | `{mode, fieldType, currentText?, campaignId?, context?}` | `{ok:true,text,...}` or `{error, code?, requestId?}` | Reads `mythic.world_profiles` / DM context hints, uses OpenAI |
| `mythic-generate-loot` | `/Users/dev/saga-spark-web/supabase/functions/mythic-generate-loot/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-generate-loot.ts` | required | `{campaignId, combatSessionId?, characterId?, count?, source?, rarity?, seed?}` | `{ok:true, items:[...], ...}` or `{error, code?, requestId?}` | `mythic.items`, `mythic.inventory`, optional `mythic.loot_drops`, reads `mythic.characters` |
| `mythic-join-campaign` | `/Users/dev/saga-spark-web/supabase/functions/mythic-join-campaign/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-join-campaign.ts` | required | `{inviteCode}` | `{ok:true,campaignId,...}` or `{ok:false,error,code?,requestId?}` | `campaigns`, `campaign_members`, `mythic.boards` (seed helper), `mythic.world_profiles` (mirror) |
| `mythic-list-campaigns` | `/Users/dev/saga-spark-web/supabase/functions/mythic-list-campaigns/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-list-campaigns.ts` | required | `{}` | `{ok:true,campaigns:[...],warnings?,requestId?}` or `{ok:false,error,code?,requestId?}` | `campaigns`, `campaign_members`, `mythic.boards`, `mythic.world_profiles` |
| `mythic-recompute-character` | `/Users/dev/saga-spark-web/supabase/functions/mythic-recompute-character/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-recompute-character.ts` | required | `{campaignId, characterId?}` | `{ok:true, character:{...}}` or `{error, code?, requestId?}` | `mythic.characters`, `mythic.inventory`, `mythic.items` |
| `mythic-set-loadout` | `/Users/dev/saga-spark-web/supabase/functions/mythic-set-loadout/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-set-loadout.ts` | required | `{campaignId, characterId?, name, skillIds:[...], activate?}` | `{ok:true, loadout:{...}}` or `{error, code?, requestId?}` | `mythic.character_loadouts`, `mythic.characters` (active loadout), reads `mythic.skills` |
| `mythic-shop-stock` | `/Users/dev/saga-spark-web/supabase/functions/mythic-shop-stock/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-shop-stock.ts` | required | `{campaignId, vendorId}` | `{ok:true, stock:{...}}` or `{error, code?, requestId?}` | `mythic.boards` (vendor stock in `state_json`) |
| `mythic-shop-buy` | `/Users/dev/saga-spark-web/supabase/functions/mythic-shop-buy/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-shop-buy.ts` | required | `{campaignId, characterId, vendorId, stockItemId}` | `{ok:true, purchase:{...}}` or `{error, code?, requestId?}` | `mythic.characters` (coins/resources), `mythic.items`, `mythic.inventory`, `mythic.boards` (mark sold), `mythic.dm_memory_events` |
| `mythic-tts` | `/Users/dev/saga-spark-web/supabase/functions/mythic-tts/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/mythic-tts.ts` | required | `{campaignId, messageId?, text, voice?, format?}` | Binary audio body (`audio/*`) | Uses OpenAI TTS, reads `campaigns`/`campaign_members` for access checks |
| `world-content-writer` | `/Users/dev/saga-spark-web/supabase/functions/world-content-writer/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/world-content-writer.ts` | required | `{campaignId, action?, context?, content?, ...}` | `{ok:true, ...}` or `{error, code?, requestId?}` | Writes `mythic.dm_memory_events`, may write world content tables (campaign-scoped) |
| `world-generator` | `/Users/dev/saga-spark-web/supabase/functions/world-generator/index.ts` | `/Users/dev/saga-spark-web/services/mythic-api/src/functions/world-generator.ts` | optional | `{type, campaignSeed:{...}, context?}` | JSON matching requested schema | Pure generation (LLM), optional writes (when campaignId present) |

## Client Call Sites (Top-Level)
- Function invocation is centralized in `/Users/dev/saga-spark-web/src/lib/edge.ts`.
- All Mythic UI/hooks call `callEdgeFunction("<name>", ...)` with the function name from the list above.

## VPS Authorization Notes
The VPS uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS), so **explicit checks** are enforced:
- Campaign access: owner or member (`campaign_members`), see `/Users/dev/saga-spark-web/services/mythic-api/src/shared/authz.ts`.
- Character access: must belong to user unless DM/owner, used in loot/shop endpoints.

