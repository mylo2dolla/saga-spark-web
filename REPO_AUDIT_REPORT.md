# Saga Spark Repo Audit Report

Date: 2026-01-18

## Architecture Map (Routes → UI → Data Sources)

- `/login` → `src/ui/screens/AuthScreen.tsx` → Supabase Auth (`supabase.auth.signInWithPassword`)
- `/signup` → `src/ui/screens/AuthScreen.tsx` → Supabase Auth (`supabase.auth.signUp`)
- `/dashboard` → `src/ui/screens/DashboardScreen.tsx` → Supabase tables: `campaigns`, `campaign_members`, `combat_state` + edge functions `world-generator`, `world-content-writer`
- `/servers` + `/admin` → `src/ui/screens/ServerAdminScreen.tsx` → Supabase table: `server_nodes` + `campaigns` (DB test) + edge function `generate-class` (DEV test)
- `/game/:campaignId` → `src/routes/GameSessionRoute.tsx` → `src/ui/screens/GameScreen.tsx` → `useGameSession` (Supabase: `campaigns`, `game_saves`, `ai_generated_content`) + engine (`UnifiedState`, `WorldTravelEngine`)
- `/game/:campaignId/create-character` → `src/ui/screens/CharacterScreen.tsx` → `AICharacterCreator` → `useClassGenerator` (edge: `generate-class`) + Supabase table `characters`
- `*` → `src/pages/NotFound.tsx` (static)

Providers:
- `DiagnosticsProvider` → `src/ui/data/diagnostics.tsx`
- `AppShell` → `src/ui/app-shell/AppShell.tsx` (auth + DB health display)
- `GameSessionProvider` → `src/contexts/GameSessionContext.tsx`

Data clients:
- Supabase client: `src/integrations/supabase/client.ts`
- Edge functions: `supabase/functions/generate-class`, `supabase/functions/world-generator`, `supabase/functions/world-content-writer`, `supabase/functions/dungeon-master`

Engine/AI:
- Engine: `src/engine/**`
- World generation: `src/hooks/useWorldGenerator.ts` (calls `world-generator`)
- Class generation: `src/hooks/useClassGenerator.ts` (calls `generate-class`)
- World content persistence: `src/hooks/useWorldContent.ts` (reads `ai_generated_content`)
- Unified session + persistence: `src/hooks/useGameSession.ts`, `src/hooks/useGamePersistence.ts`

## Screen Inventory (Real Data Wiring)

Active routes (from `src/App.tsx`):
- AuthScreen (`/login`, `/signup`): REAL (Supabase auth)
- DashboardScreen (`/dashboard`): REAL (campaigns/campaign_members + world generation/persistence)
- CharacterScreen (`/game/:campaignId/create-character`): REAL (generate-class + characters)
- GameScreen (`/game/:campaignId`): REAL (game_saves + ai_generated_content + engine state)
- ServerAdminScreen (`/servers`, `/admin`): REAL (server_nodes + DB/edge checks)
- NotFound (`*`): STATIC

Legacy/unrouted screens:
- Removed from repo in fixes (all legacy `src/pages/*` except `src/pages/NotFound.tsx`).

## DB Schema Inventory (from `supabase/bootstrap.sql`)

Tables:
- `campaigns`: id, name, description, invite_code, owner_id, current_scene, game_state, is_active, created_at, updated_at
- `campaign_members`: id, campaign_id, user_id, is_dm, joined_at
- `profiles`: id, user_id, display_name, avatar_url, created_at, updated_at
- `characters`: id, campaign_id, user_id, name, class, level, hp, max_hp, ac, stats, abilities, inventory, xp, xp_to_next, position, status_effects, avatar_url, is_active, created_at, updated_at, equipment, backpack, resources, class_description, passives
- `abilities`: id, character_id, name, description, ability_type, damage, healing, range, cost, cost_type, cooldown, targeting_type, area_size, effects, is_equipped, created_at
- `items`: id, name, description, item_type, slot, rarity, stat_modifiers, abilities_granted, effects, value, created_at
- `chat_messages`: id, campaign_id, user_id, message_type, content, roll_data, created_at
- `combat_state`: id, campaign_id, is_active, round_number, current_turn_index, initiative_order, enemies, updated_at
- `grid_state`: id, campaign_id, grid_size, tiles, updated_at
- `user_roles`: id, user_id, role, created_at
- `game_saves`: id, campaign_id, user_id, save_name, campaign_seed, world_state, game_state, player_level, total_xp, playtime_seconds, created_at, updated_at
- `ai_generated_content`: id, campaign_id, content_type, content_id, content, generation_context, created_at
- `server_nodes`: id, node_name, user_id, campaign_id, status, last_heartbeat, active_players, active_campaigns, realtime_connections, database_latency_ms, memory_usage, cpu_usage, created_at, updated_at

Relations/constraints (high-level):
- `campaign_members.campaign_id` → `campaigns.id`
- `characters.campaign_id` → `campaigns.id`
- `game_saves.campaign_id` → `campaigns.id`
- `ai_generated_content.campaign_id` → `campaigns.id`
- `server_nodes.campaign_id` → `campaigns.id`
- `campaigns.invite_code` unique
- `campaign_members (campaign_id, user_id)` unique
- `server_nodes (user_id, node_name)` unique

## RLS/Policies Inventory (from `supabase/bootstrap.sql`)

Campaigns/members:
- Campaigns: select for members/owners; insert/update/delete for owner
- Campaign members: select for members/owners; insert/delete for authenticated user

Profiles:
- Select: public
- Insert/update: owner only

Characters/abilities:
- Characters select: campaign members/owner
- Characters insert/update/delete: owner/user with membership
- Abilities select/insert/update/delete: owner of character

Combat/grid/chat/items:
- Combat state insert/update/select: campaign members/owner
- Grid state insert/update/select/delete: campaign owner (and members for update/select)
- Chat messages insert/select: campaign members
- Items select: public; insert blocked

Saves/AI content:
- game_saves: select/insert/update/delete by user
- ai_generated_content: select/insert by campaign members

Server nodes:
- server_nodes: select authenticated users; insert/update/delete by user_id

## Placeholder/Mock/Hardcoded Findings (rg hits, pre-fix)

NOTE: These are recorded before any cleanup. Line numbers from `rg -n`.

Resolved items (post-fix) are noted below in “Fixes Applied”.

Current remaining non-data placeholders (UI-only input placeholders):
- `src/ui/screens/AuthScreen.tsx:128/139/149` (input placeholders)
- `src/ui/screens/DashboardScreen.tsx:506/511/527` (input placeholders)
- `src/components/AICharacterCreator.tsx:197/415` (input placeholders)
- `src/components/DMChat.tsx:277` (input placeholder, component currently unused)
- `src/components/game/SaveLoadMenu.tsx:129` (input placeholder, component currently unused)

Engine-internal fallback IDs (engine files, not edited by policy):
- `src/engine/narrative/TravelPersistence.ts:91` → `"starting_location"`
- `src/engine/narrative/Narrator.ts:14` → `MOCK_NARRATIVE_PATTERN`

UI/hooks with `starting_location` safeguards (kept only for normalization or engine compatibility, not rendered as data):
- `src/hooks/useWorldContent.ts:28/192/195/214` → filters `starting_location` from AI content
- `src/ui/screens/DashboardScreen.tsx:73` → normalization avoids `starting_location` IDs
- `src/hooks/useUnifiedEngine.ts:81` → default `startingLocationId` (hook unused in active routes)

## Missing Implementations / Dead UI Paths (pre-fix)

Fixed in implementation commit(s) (see “Fixes Applied”):
- Campaign creation now generates AI world content and persists via `world-content-writer`.
- Legacy `src/pages/*` demo screens removed.
- `/servers` dashboard expanded to show engine snapshot + read/write timestamps.

## Fixes Applied (post-audit)

- Removed legacy demo pages (unused, placeholder-heavy): `src/pages/{ServerDashboard,CreateCharacter,QuestView,WorldMap,CombatView,NewCampaign,Signup,LocationView,Dashboard,NPCView,Index,Game}.tsx`.
- Removed unused placeholder asset: `public/placeholder.svg`.
- Removed hardcoded name suggestions in `src/components/AICharacterCreator.tsx`.
- Campaign creation now calls `world-generator`, normalizes locations, persists with `world-content-writer`, and updates `campaigns.current_scene` (`src/ui/screens/DashboardScreen.tsx`).
- Removed fallback location injection in `useGameSession` and removed `starting_location` fallback usage in `useGamePersistence` (errors surfaced if world has zero locations).
- `/servers` dashboard now shows engine snapshot + last read/write/edge timestamps (`src/ui/screens/ServerAdminScreen.tsx` + `src/ui/screens/GameScreen.tsx`).
- `/servers` dashboard includes reconnect + refresh flow for auth/session/DB checks.

## Definition of Done Checklist (post-fix)

- [x] No Lovable branding/artifacts found.
- [x] All UI elements use real data (demo/preset data and name suggestions removed).
- [x] Campaign creation generates and persists AI world content.
- [x] No fallback placeholder locations when real data is missing (errors surfaced; generation required).
- [x] Character creation persists and reloads (`characters` table).
- [x] Travel/encounter/combat updates are persisted (`game_saves`).
- [x] Ops dashboard shows DB/auth/engine status and reconnect.
- [x] Legacy/demo UI removed.

## Files Read

- `src/App.tsx`
- `src/ui/app-shell/AppShell.tsx`
- `src/ui/screens/AuthScreen.tsx`
- `src/ui/screens/DashboardScreen.tsx`
- `src/ui/screens/CharacterScreen.tsx`
- `src/ui/screens/GameScreen.tsx`
- `src/ui/screens/ServerAdminScreen.tsx`
- `src/components/AICharacterCreator.tsx`
- `src/hooks/useAuth.ts`
- `src/hooks/useGameSession.ts`
- `src/hooks/useGamePersistence.ts`
- `src/hooks/useWorldContent.ts`
- `src/hooks/useWorldGenerator.ts`
- `src/hooks/useCharacter.ts`
- `src/hooks/useClassGenerator.ts`
- `src/hooks/useRealtimeGame.ts`
- `src/integrations/supabase/client.ts`
- `src/ui/data/networkHealth.ts`
- `supabase/bootstrap.sql`
- `supabase/functions/generate-class/index.ts`
- `supabase/functions/world-content-writer/index.ts`
- `supabase/functions/world-generator/index.ts`
- `src/pages/NewCampaign.tsx`
- `src/pages/NotFound.tsx`
