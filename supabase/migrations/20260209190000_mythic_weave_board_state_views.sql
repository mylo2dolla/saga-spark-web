-- Mythic Weave Core: board state views for AI DM and UI determinism
-- Idempotent by CREATE OR REPLACE.

create schema if not exists mythic;

-- Active board + recent transitions, per campaign.
create or replace view mythic.v_board_state_for_dm as
select
  b.campaign_id,
  b.id as board_id,
  b.board_type,
  b.status,
  b.state_json,
  b.ui_hints_json,
  b.active_scene_id,
  b.combat_session_id,
  b.updated_at,
  (
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'from_board_type', t.from_board_type,
      'to_board_type', t.to_board_type,
      'reason', t.reason,
      'animation', t.animation,
      'payload_json', t.payload_json,
      'created_at', t.created_at
    ) order by t.created_at desc)
    from mythic.board_transitions t
    where t.campaign_id = b.campaign_id
    limit 20
  ) as recent_transitions
from mythic.boards b
where b.status = 'active';

