-- Runtime cutover fix: combat session start must not depend on removed board tables.
-- Replaces mythic.start_combat_session with a campaign_runtime-safe implementation.

create or replace function mythic.start_combat_session(
  p_campaign_id uuid,
  p_seed int,
  p_scene_json jsonb,
  p_reason text default 'encounter'
)
returns uuid
language plpgsql
volatile
set search_path = mythic, public
as $$
declare
  combat_id uuid;
begin
  insert into mythic.combat_sessions (campaign_id, seed, status, scene_json, current_turn_index)
  values (
    p_campaign_id,
    coalesce(p_seed, 0),
    'active',
    coalesce(p_scene_json, '{}'::jsonb),
    0
  )
  returning id into combat_id;

  -- Keep runtime row synced for callers that do not immediately patch runtime state.
  update mythic.campaign_runtime
     set mode = 'combat',
         combat_session_id = combat_id,
         updated_at = now()
   where campaign_id = p_campaign_id;

  perform mythic.append_action_event(
    combat_id,
    0,
    null,
    'combat_start',
    jsonb_build_object('reason', coalesce(nullif(trim(p_reason), ''), 'encounter'))
  );

  return combat_id;
end;
$$;
