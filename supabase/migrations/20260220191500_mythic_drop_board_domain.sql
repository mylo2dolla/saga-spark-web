-- Mythic runtime cutover finalization: remove legacy board-domain tables/types.
-- Safe to run after all runtime reads/writes use mythic.campaign_runtime + mythic.runtime_events.

set search_path = public, mythic;

-- Remove legacy board-derived views/functions first so enum/type drops cleanly.
drop view if exists mythic.v_board_state_for_dm cascade;
drop view if exists mythic.v_mythic_board_state cascade;

drop function if exists mythic.mythic_board_transition(uuid, text, jsonb) cascade;
drop function if exists public.mythic_board_transition(uuid, text, jsonb) cascade;

-- Remove board append-only trigger functions if present.
drop trigger if exists tr_mythic_board_transitions_append_only on mythic.board_transitions;

-- Remove legacy storage.
drop table if exists mythic.board_transitions cascade;
drop table if exists mythic.boards cascade;

-- Remove legacy enum once table dependencies are gone.
drop type if exists mythic.board_type cascade;
