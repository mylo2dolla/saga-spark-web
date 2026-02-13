-- Mythic Weave: ensure RLS is disabled on mythic schema tables (authoritative DB access)
-- Forward-only, idempotent via ALTER TABLE IF EXISTS.

alter table if exists mythic.generator_scripts disable row level security;
alter table if exists mythic.game_rules disable row level security;
alter table if exists mythic.ui_turn_flow_rules disable row level security;

alter table if exists mythic.dm_campaign_state disable row level security;
alter table if exists mythic.dm_memory_events disable row level security;
alter table if exists mythic.dm_player_model disable row level security;
alter table if exists mythic.dm_world_tension disable row level security;

alter table if exists mythic.factions disable row level security;
alter table if exists mythic.faction_reputation disable row level security;
alter table if exists mythic.reputation_events disable row level security;
alter table if exists mythic.revenge_arcs disable row level security;
alter table if exists mythic.nemesis_memory disable row level security;

alter table if exists mythic.boards disable row level security;
alter table if exists mythic.board_transitions disable row level security;

alter table if exists mythic.combat_sessions disable row level security;
alter table if exists mythic.combatants disable row level security;
alter table if exists mythic.turn_order disable row level security;
alter table if exists mythic.action_events disable row level security;

alter table if exists mythic.characters disable row level security;
alter table if exists mythic.skills disable row level security;
alter table if exists mythic.items disable row level security;
alter table if exists mythic.inventory disable row level security;
