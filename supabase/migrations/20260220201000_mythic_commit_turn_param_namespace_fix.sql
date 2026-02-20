-- Hardening fix: avoid PL/pgSQL arg/column name collisions in mythic_commit_turn.
-- Keep public RPC parameter names unchanged; this only redefines mythic.mythic_commit_turn.

drop function if exists public.mythic_commit_turn(
  uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb
);

drop function if exists mythic.mythic_commit_turn(
  uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb
);

create function mythic.mythic_commit_turn(
  p_campaign_id uuid,
  p_player_id uuid,
  p_board_id uuid,
  p_board_type text,
  p_turn_seed text,
  p_dm_request_json jsonb,
  p_dm_response_json jsonb,
  p_patches_json jsonb,
  p_roll_log_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = mythic, public
as $$
declare
  expected_turn_index int;
  next_turn_index int;
  inserted_turn_id uuid;
  runtime_row mythic.campaign_runtime%rowtype;
  runtime_state jsonb := '{}'::jsonb;
  runtime_delta jsonb := '{}'::jsonb;
  merged_state jsonb := '{}'::jsonb;
  seed_text text;
  world_heat double precision := null;

  existing_rumors jsonb := '[]'::jsonb;
  existing_objectives jsonb := '[]'::jsonb;
  existing_discovery_log jsonb := '[]'::jsonb;
  existing_discovery_flags jsonb := '{}'::jsonb;
  existing_scene_cache jsonb := '{}'::jsonb;
  existing_companion_checkins jsonb := '[]'::jsonb;
  existing_action_chips jsonb := '[]'::jsonb;

  delta_rumors jsonb := '[]'::jsonb;
  delta_objectives jsonb := '[]'::jsonb;
  delta_discovery_log jsonb := '[]'::jsonb;
  delta_discovery_flags jsonb := '{}'::jsonb;
  delta_scene_cache jsonb := '{}'::jsonb;
  delta_companion_checkins jsonb := '[]'::jsonb;
  delta_action_chips jsonb := '[]'::jsonb;

  companion_count int := 0;
  companion_offset int := 0;
  companion_turn_cadence int := 3;
  companion_record record;
  generated_companion_checkins jsonb := '[]'::jsonb;
  generated_checkin jsonb := null;
  urgency_roll int := 0;
  urgency_label text := 'medium';
  mood_label text := 'steady';
  checkin_line text := '';
  template_idx int := 0;
  line_templates text[] := array[
    'Eyes up. Something on this route is moving where it should not.',
    'Supply line is still open, but the timing window is getting narrow.',
    'Your last move rattled somebody important. Expect pressure.',
    'Terrain looks calm; pattern does not. Keep your blade warm.'
  ];
begin
  expected_turn_index := nullif(p_dm_request_json ->> 'expected_turn_index', '')::int;

  select coalesce(max(t.turn_index), -1) + 1
    into next_turn_index
    from mythic.turns t
   where t.campaign_id = p_campaign_id;

  if expected_turn_index is not null and expected_turn_index <> next_turn_index then
    raise exception 'expected_turn_index_mismatch expected=% got=%', expected_turn_index, next_turn_index
      using errcode = '40001';
  end if;

  insert into mythic.campaign_runtime (campaign_id, mode, status, state_json, ui_hints_json)
  values (
    p_campaign_id,
    case when p_board_type in ('town','travel','dungeon','combat') then p_board_type else 'town' end,
    'active',
    '{}'::jsonb,
    '{}'::jsonb
  )
  on conflict (campaign_id) do nothing;

  select *
    into runtime_row
    from mythic.campaign_runtime cr
   where cr.campaign_id = p_campaign_id
   for update;

  if runtime_row.id is null then
    raise exception 'runtime_missing_for_campaign:%', p_campaign_id;
  end if;

  runtime_state := coalesce(runtime_row.state_json, '{}'::jsonb);

  runtime_delta := case
    when jsonb_typeof(coalesce(p_dm_response_json, '{}'::jsonb) -> 'runtime_delta') = 'object'
      then (p_dm_response_json -> 'runtime_delta')
    when jsonb_typeof(coalesce(p_dm_response_json, '{}'::jsonb) -> 'board_delta') = 'object'
      then (p_dm_response_json -> 'board_delta')
    else '{}'::jsonb
  end;

  existing_rumors := case when jsonb_typeof(runtime_state -> 'rumors') = 'array' then runtime_state -> 'rumors' else '[]'::jsonb end;
  existing_objectives := case when jsonb_typeof(runtime_state -> 'objectives') = 'array' then runtime_state -> 'objectives' else '[]'::jsonb end;
  existing_discovery_log := case when jsonb_typeof(runtime_state -> 'discovery_log') = 'array' then runtime_state -> 'discovery_log' else '[]'::jsonb end;
  existing_discovery_flags := case when jsonb_typeof(runtime_state -> 'discovery_flags') = 'object' then runtime_state -> 'discovery_flags' else '{}'::jsonb end;
  existing_scene_cache := case when jsonb_typeof(runtime_state -> 'scene_cache') = 'object' then runtime_state -> 'scene_cache' else '{}'::jsonb end;
  existing_companion_checkins := case when jsonb_typeof(runtime_state -> 'companion_checkins') = 'array' then runtime_state -> 'companion_checkins' else '[]'::jsonb end;
  existing_action_chips := case when jsonb_typeof(runtime_state -> 'action_chips') = 'array' then runtime_state -> 'action_chips' else '[]'::jsonb end;

  delta_rumors := case when jsonb_typeof(runtime_delta -> 'rumors') = 'array' then runtime_delta -> 'rumors' else '[]'::jsonb end;
  delta_objectives := case when jsonb_typeof(runtime_delta -> 'objectives') = 'array' then runtime_delta -> 'objectives' else '[]'::jsonb end;
  delta_discovery_log := case when jsonb_typeof(runtime_delta -> 'discovery_log') = 'array' then runtime_delta -> 'discovery_log' else '[]'::jsonb end;
  delta_discovery_flags := case when jsonb_typeof(runtime_delta -> 'discovery_flags') = 'object' then runtime_delta -> 'discovery_flags' else '{}'::jsonb end;
  delta_scene_cache := case when jsonb_typeof(runtime_delta -> 'scene_cache') = 'object' then runtime_delta -> 'scene_cache' else '{}'::jsonb end;
  delta_companion_checkins := case when jsonb_typeof(runtime_delta -> 'companion_checkins') = 'array' then runtime_delta -> 'companion_checkins' else '[]'::jsonb end;
  delta_action_chips := case when jsonb_typeof(runtime_delta -> 'action_chips') = 'array' then runtime_delta -> 'action_chips' else '[]'::jsonb end;

  seed_text := coalesce(nullif(p_turn_seed, ''), md5(next_turn_index::text || ':' || p_campaign_id::text));

  if mod(next_turn_index, companion_turn_cadence) = 0 then
    select count(*)
      into companion_count
      from mythic.campaign_companions cc
     where cc.campaign_id = p_campaign_id;

    if companion_count > 0 then
      companion_offset := mythic.stable_int(seed_text || ':companion:' || next_turn_index::text) % companion_count;
      select *
        into companion_record
        from mythic.campaign_companions cc
       where cc.campaign_id = p_campaign_id
       order by cc.companion_id
       offset companion_offset
       limit 1;

      if companion_record.id is not null then
        urgency_roll := mythic.stable_int(seed_text || ':urgency:' || companion_record.companion_id) % 100;
        urgency_label := case
          when urgency_roll < 34 then 'low'
          when urgency_roll < 67 then 'medium'
          else 'high'
        end;
        mood_label := coalesce(nullif(companion_record.mood, ''), 'steady');
        template_idx := (mythic.stable_int(seed_text || ':line:' || companion_record.companion_id) % array_length(line_templates, 1)) + 1;
        checkin_line := format('%s: %s', companion_record.name, line_templates[template_idx]);

        generated_checkin := jsonb_build_object(
          'companion_id', companion_record.companion_id,
          'line', checkin_line,
          'mood', mood_label,
          'urgency', urgency_label,
          'hook_type', 'companion_checkin',
          'turn_index', next_turn_index
        );
        generated_companion_checkins := jsonb_build_array(generated_checkin);

        insert into mythic.dm_memory_events (
          campaign_id,
          player_id,
          category,
          severity,
          payload
        ) values (
          p_campaign_id,
          p_player_id,
          'companion_checkin',
          case urgency_label when 'high' then 3 when 'medium' then 2 else 1 end,
          jsonb_build_object(
            'turn_index', next_turn_index,
            'runtime_id', runtime_row.id,
            'companion_checkin', generated_checkin
          )
        );
      end if;
    end if;
  end if;

  merged_state := coalesce(runtime_state, '{}'::jsonb) || jsonb_build_object(
    'rumors', mythic.jsonb_array_tail(existing_rumors || delta_rumors, 36),
    'objectives', mythic.jsonb_array_tail(existing_objectives || delta_objectives, 24),
    'discovery_log', mythic.normalize_discovery_log(existing_discovery_log || delta_discovery_log),
    'discovery_flags', existing_discovery_flags || delta_discovery_flags,
    'scene_cache', existing_scene_cache || delta_scene_cache,
    'companion_checkins', mythic.jsonb_array_tail(existing_companion_checkins || delta_companion_checkins || generated_companion_checkins, 24),
    'action_chips', mythic.jsonb_array_tail(existing_action_chips || delta_action_chips, 12),
    'companion_presence', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'companion_id', cc.companion_id,
          'name', cc.name,
          'mood', cc.mood,
          'archetype', cc.archetype
        )
        order by cc.companion_id
      )
      from mythic.campaign_companions cc
      where cc.campaign_id = p_campaign_id
    ), '[]'::jsonb)
  );

  update mythic.campaign_runtime
     set mode = case when coalesce(nullif(p_board_type, ''), runtime_row.mode) in ('town','travel','dungeon','combat')
       then coalesce(nullif(p_board_type, ''), runtime_row.mode)
       else runtime_row.mode
     end,
         state_json = merged_state,
         updated_at = now()
   where id = runtime_row.id;

  insert into mythic.turns (
    campaign_id,
    player_id,
    board_id,
    board_type,
    runtime_id,
    mode,
    turn_index,
    turn_seed,
    dm_request_json,
    dm_response_json,
    patches_json,
    roll_log_json,
    status
  ) values (
    p_campaign_id,
    p_player_id,
    null,
    runtime_row.mode,
    runtime_row.id,
    runtime_row.mode,
    next_turn_index,
    coalesce(nullif(p_turn_seed, ''), md5(random()::text)),
    coalesce(p_dm_request_json, '{}'::jsonb),
    coalesce(p_dm_response_json, '{}'::jsonb),
    coalesce(p_patches_json, '[]'::jsonb),
    coalesce(p_roll_log_json, '[]'::jsonb),
    'committed'
  )
  returning id into inserted_turn_id;

  select dwt.tension
    into world_heat
    from mythic.dm_world_tension dwt
   where dwt.campaign_id = p_campaign_id
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'turn_id', inserted_turn_id,
    'turn_index', next_turn_index,
    'world_time', now(),
    'heat', world_heat,
    'runtime_id', runtime_row.id,
    'mode', runtime_row.mode,
    'board_id', runtime_row.id,
    'board_type', runtime_row.mode
  );
exception
  when unique_violation then
    raise exception 'expected_turn_index_conflict:%', next_turn_index using errcode = '40001';
end;
$$;

grant execute on function mythic.mythic_commit_turn(
  uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb
) to anon, authenticated, service_role;

create function public.mythic_commit_turn(
  campaign_id uuid,
  player_id uuid,
  board_id uuid,
  board_type text,
  turn_seed text,
  dm_request_json jsonb,
  dm_response_json jsonb,
  patches_json jsonb,
  roll_log_json jsonb
)
returns jsonb
language sql
security definer
set search_path = public, mythic
as $$
  select mythic.mythic_commit_turn(
    campaign_id,
    player_id,
    board_id,
    board_type,
    turn_seed,
    dm_request_json,
    dm_response_json,
    patches_json,
    roll_log_json
  );
$$;

grant execute on function public.mythic_commit_turn(
  uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb
) to anon, authenticated, service_role;
