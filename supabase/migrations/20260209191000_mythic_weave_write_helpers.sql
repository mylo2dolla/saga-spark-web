-- Mythic Weave Core: write helpers for deterministic playback logs (DB is authority)
-- Idempotent by CREATE OR REPLACE.

create schema if not exists mythic;

-- Append-only helper for action_events.
create or replace function mythic.append_action_event(
  p_combat_session_id uuid,
  p_turn_index int,
  p_actor_combatant_id uuid,
  p_event_type text,
  p_payload jsonb
)
returns uuid
language plpgsql
volatile
as $$
declare
  new_id uuid;
begin
  insert into mythic.action_events (combat_session_id, turn_index, actor_combatant_id, event_type, payload)
  values (
    p_combat_session_id,
    greatest(coalesce(p_turn_index, 0), 0),
    p_actor_combatant_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into new_id;

  return new_id;
end;
$$;

-- Start a combat session and create/activate a combat board with a page-turn transition.
-- This does not populate combatants/turn_order; the app/agent should insert them deterministically.
create or replace function mythic.start_combat_session(
  p_campaign_id uuid,
  p_seed int,
  p_scene_json jsonb,
  p_reason text default 'encounter'
)
returns uuid
language plpgsql
volatile
as $$
declare
  prev_board mythic.boards%rowtype;
  combat_id uuid;
begin
  select * into prev_board
  from mythic.boards
  where campaign_id = p_campaign_id and status = 'active'
  order by updated_at desc
  limit 1;

  insert into mythic.combat_sessions (campaign_id, seed, status, scene_json, current_turn_index)
  values (p_campaign_id, coalesce(p_seed, 0), 'active', coalesce(p_scene_json, '{}'::jsonb), 0)
  returning id into combat_id;

  -- Archive previous active board (if any), then set combat board active.
  if found then
    update mythic.boards
    set status = 'archived', updated_at = now()
    where id = prev_board.id;
  end if;

  insert into mythic.boards (campaign_id, board_type, status, state_json, ui_hints_json, combat_session_id)
  values (p_campaign_id, 'combat', 'active', jsonb_build_object('combat_session_id', combat_id), '{}'::jsonb, combat_id);

  insert into mythic.board_transitions (
    campaign_id, from_board_type, to_board_type, reason, animation, payload_json
  ) values (
    p_campaign_id,
    prev_board.board_type,
    'combat',
    coalesce(p_reason, 'encounter'),
    'page_turn',
    jsonb_build_object('combat_session_id', combat_id)
  );

  perform mythic.append_action_event(combat_id, 0, null, 'combat_start', jsonb_build_object('reason', p_reason));

  return combat_id;
end;
$$;

-- End a combat session and emit a combat_end action event. Board switching is handled by the app
-- using mythic.board_transitions(animation='page_turn') and mythic.boards.
create or replace function mythic.end_combat_session(
  p_combat_session_id uuid,
  p_outcome jsonb default '{}'::jsonb
)
returns void
language plpgsql
volatile
as $$
begin
  update mythic.combat_sessions
  set status = 'ended',
      updated_at = now()
  where id = p_combat_session_id;

  perform mythic.append_action_event(p_combat_session_id, 0, null, 'combat_end', coalesce(p_outcome, '{}'::jsonb));
end;
$$;

