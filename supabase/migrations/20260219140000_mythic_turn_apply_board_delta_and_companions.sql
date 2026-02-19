-- Mythic parity recovery:
-- 1) Introduce campaign companions
-- 2) Normalize transition reason/test-marker artifacts
-- 3) Apply DM board_delta atomically during mythic_commit_turn

create schema if not exists mythic;

create table if not exists mythic.campaign_companions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  companion_id text not null,
  name text not null,
  archetype text not null default 'scout',
  voice text not null default 'dry',
  mood text not null default 'steady',
  cadence_turns int not null default 3,
  urgency_bias double precision not null default 0.5,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, companion_id),
  check (cadence_turns between 1 and 24),
  check (urgency_bias between 0 and 1)
);

create index if not exists idx_mythic_campaign_companions_campaign
  on mythic.campaign_companions(campaign_id, companion_id);

create or replace function mythic.touch_campaign_companions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_campaign_companions_updated_at on mythic.campaign_companions;
create trigger trg_campaign_companions_updated_at
before update on mythic.campaign_companions
for each row execute function mythic.touch_campaign_companions_updated_at();

create or replace function mythic.stable_int(raw text)
returns int
language sql
immutable
as $$
  select (('x' || substr(md5(coalesce(raw, '')), 1, 8))::bit(32)::int & 2147483647);
$$;

create or replace function mythic.jsonb_array_tail(payload jsonb, max_items int)
returns jsonb
language sql
immutable
as $$
  with arr as (
    select case when jsonb_typeof(payload) = 'array' then payload else '[]'::jsonb end as value
  ),
  lens as (
    select jsonb_array_length(value) as n, value from arr
  ),
  trimmed as (
    select e.value, e.ord
    from lens l
    cross join lateral jsonb_array_elements(l.value) with ordinality as e(value, ord)
    where e.ord > greatest(l.n - greatest(max_items, 0), 0)
  )
  select coalesce(jsonb_agg(value order by ord), '[]'::jsonb) from trimmed;
$$;

create or replace function mythic.reason_code(raw_reason text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      trim(both '_' from lower(regexp_replace(
        case
          when raw_reason is null then 'story_progression'
          when raw_reason like 'narrative:%' then substr(raw_reason, length('narrative:') + 1)
          when raw_reason like 'transition_reason:%' then substr(raw_reason, length('transition_reason:') + 1)
          else raw_reason
        end,
        '[^a-zA-Z0-9]+',
        '_',
        'g'
      ))),
      ''
    ),
    'story_progression'
  );
$$;

create or replace function mythic.humanize_reason(raw_reason text)
returns text
language sql
immutable
as $$
  with normalized as (
    select case
      when raw_reason is null or btrim(raw_reason) = '' then 'story progression'
      when raw_reason like 'narrative:%' then substr(raw_reason, length('narrative:') + 1)
      when raw_reason like 'transition_reason:%' then substr(raw_reason, length('transition_reason:') + 1)
      when raw_reason ~ '^(fallback-|dm-action-)' then regexp_replace(raw_reason, '^(fallback-|dm-action-)', '')
      else raw_reason
    end as token
  )
  select initcap(regexp_replace(replace(replace(token, '-', ' '), '_', ' '), '\s+', ' ', 'g'))
  from normalized;
$$;

create or replace function mythic.normalize_discovery_log(payload jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  row_value jsonb;
  out_log jsonb := '[]'::jsonb;
  raw_text text;
  kind text;
  detail text;
begin
  if jsonb_typeof(payload) <> 'array' then
    return '[]'::jsonb;
  end if;

  for row_value in
    select value
    from jsonb_array_elements(payload)
  loop
    if jsonb_typeof(row_value) = 'object' then
      out_log := out_log || jsonb_build_array(row_value);
    elsif jsonb_typeof(row_value) = 'string' then
      raw_text := trim(both '"' from row_value::text);
      if raw_text like 'transition_reason:%' then
        kind := 'transition_reason';
        detail := mythic.humanize_reason(substr(raw_text, length('transition_reason:') + 1));
      elsif raw_text like 'travel_goal:%' then
        kind := 'travel_goal';
        detail := initcap(replace(substr(raw_text, length('travel_goal:') + 1), '_', ' '));
      elsif raw_text like 'search_target:%' then
        kind := 'search_target';
        detail := initcap(replace(substr(raw_text, length('search_target:') + 1), '_', ' '));
      elsif raw_text like 'probe:%' then
        kind := 'probe';
        detail := initcap(replace(substr(raw_text, length('probe:') + 1), '_', ' '));
      elsif raw_text like 'encounter:%' then
        kind := 'encounter';
        detail := initcap(replace(substr(raw_text, length('encounter:') + 1), '_', ' '));
      elsif raw_text like 'treasure:%' then
        kind := 'treasure';
        detail := initcap(replace(substr(raw_text, length('treasure:') + 1), '_', ' '));
      elsif raw_text like 'dungeon_traces:%' then
        kind := 'dungeon_traces';
        detail := initcap(replace(substr(raw_text, length('dungeon_traces:') + 1), '_', ' '));
      elsif raw_text like 'board:%' then
        kind := 'board';
        detail := initcap(replace(substr(raw_text, length('board:') + 1), '_', ' '));
      else
        kind := 'note';
        detail := raw_text;
      end if;
      out_log := out_log || jsonb_build_array(jsonb_build_object('kind', kind, 'detail', detail));
    end if;
  end loop;

  return mythic.jsonb_array_tail(out_log, 64);
end;
$$;

insert into mythic.campaign_companions (
  campaign_id,
  companion_id,
  name,
  archetype,
  voice,
  mood,
  cadence_turns,
  urgency_bias,
  metadata
)
select
  c.id as campaign_id,
  s.companion_id,
  s.name,
  s.archetype,
  s.voice,
  s.mood,
  s.cadence_turns,
  s.urgency_bias,
  s.metadata
from public.campaigns c
join (
  values
    (
      'companion_01',
      'Ash Vesper',
      'scout',
      'dry',
      'watchful',
      3,
      0.52,
      jsonb_build_object('specialty', 'route intelligence', 'hook_tags', jsonb_build_array('threat', 'ambush', 'recon'))
    ),
    (
      'companion_02',
      'Morrow Pike',
      'tactician',
      'blunt',
      'measured',
      3,
      0.48,
      jsonb_build_object('specialty', 'logistics and timing', 'hook_tags', jsonb_build_array('supply', 'tempo', 'fallback'))
    )
) as s(companion_id, name, archetype, voice, mood, cadence_turns, urgency_bias, metadata)
  on true
where exists (
  select 1
  from mythic.boards b
  where b.campaign_id = c.id
)
on conflict (campaign_id, companion_id) do nothing;

with raw as (
  select id, reason as raw_reason
  from mythic.board_transitions
)
update mythic.board_transitions t
set
  reason = mythic.humanize_reason(raw.raw_reason),
  payload_json = coalesce(t.payload_json, '{}'::jsonb) || jsonb_build_object(
    'reason_code',
    coalesce(
      nullif(t.payload_json ->> 'reason_code', ''),
      mythic.reason_code(raw.raw_reason)
    )
  )
from raw
where t.id = raw.id;

update mythic.boards b
set state_json = coalesce(b.state_json, '{}'::jsonb)
  || jsonb_build_object(
    'discovery_log',
    mythic.normalize_discovery_log(coalesce(b.state_json -> 'discovery_log', '[]'::jsonb)),
    'companion_checkins',
    mythic.jsonb_array_tail(coalesce(b.state_json -> 'companion_checkins', '[]'::jsonb), 24),
    'companion_presence',
    coalesce((
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
      where cc.campaign_id = b.campaign_id
    ), '[]'::jsonb)
  )
where exists (
  select 1 from mythic.campaign_companions cc where cc.campaign_id = b.campaign_id
);

create or replace function mythic.mythic_commit_turn(
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
language plpgsql
security definer
set search_path = mythic, public
as $$
declare
  expected_turn_index int;
  next_turn_index int;
  inserted_turn_id uuid;
  active_board_id uuid;
  active_state jsonb := '{}'::jsonb;
  board_delta jsonb := '{}'::jsonb;
  merged_state jsonb := '{}'::jsonb;
  seed_text text;
  world_heat double precision := null;

  existing_rumors jsonb := '[]'::jsonb;
  existing_objectives jsonb := '[]'::jsonb;
  existing_discovery_log jsonb := '[]'::jsonb;
  existing_discovery_flags jsonb := '{}'::jsonb;
  existing_scene_cache jsonb := '{}'::jsonb;
  existing_companion_checkins jsonb := '[]'::jsonb;

  delta_rumors jsonb := '[]'::jsonb;
  delta_objectives jsonb := '[]'::jsonb;
  delta_discovery_log jsonb := '[]'::jsonb;
  delta_discovery_flags jsonb := '{}'::jsonb;
  delta_scene_cache jsonb := '{}'::jsonb;
  delta_companion_checkins jsonb := '[]'::jsonb;

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
  expected_turn_index := nullif(dm_request_json ->> 'expected_turn_index', '')::int;

  select coalesce(max(t.turn_index), -1) + 1
    into next_turn_index
    from mythic.turns t
   where t.campaign_id = mythic_commit_turn.campaign_id;

  if expected_turn_index is not null and expected_turn_index <> next_turn_index then
    raise exception 'expected_turn_index_mismatch expected=% got=%', expected_turn_index, next_turn_index
      using errcode = '40001';
  end if;

  insert into mythic.turns (
    campaign_id,
    player_id,
    board_id,
    board_type,
    turn_index,
    turn_seed,
    dm_request_json,
    dm_response_json,
    patches_json,
    roll_log_json,
    status
  ) values (
    mythic_commit_turn.campaign_id,
    mythic_commit_turn.player_id,
    mythic_commit_turn.board_id,
    coalesce(nullif(mythic_commit_turn.board_type, ''), 'town'),
    next_turn_index,
    coalesce(nullif(mythic_commit_turn.turn_seed, ''), md5(random()::text)),
    coalesce(mythic_commit_turn.dm_request_json, '{}'::jsonb),
    coalesce(mythic_commit_turn.dm_response_json, '{}'::jsonb),
    coalesce(mythic_commit_turn.patches_json, '[]'::jsonb),
    coalesce(mythic_commit_turn.roll_log_json, '[]'::jsonb),
    'committed'
  )
  returning id into inserted_turn_id;

  select b.id, coalesce(b.state_json, '{}'::jsonb)
    into active_board_id, active_state
    from mythic.boards b
   where b.id = mythic_commit_turn.board_id
   for update;

  if active_board_id is null then
    select b.id, coalesce(b.state_json, '{}'::jsonb)
      into active_board_id, active_state
      from mythic.boards b
     where b.campaign_id = mythic_commit_turn.campaign_id
       and b.status = 'active'
     order by b.updated_at desc
     limit 1
     for update;
  end if;

  board_delta := case
    when jsonb_typeof(coalesce(mythic_commit_turn.dm_response_json, '{}'::jsonb) -> 'board_delta') = 'object'
      then (mythic_commit_turn.dm_response_json -> 'board_delta')
    else '{}'::jsonb
  end;

  existing_rumors := case when jsonb_typeof(active_state -> 'rumors') = 'array' then active_state -> 'rumors' else '[]'::jsonb end;
  existing_objectives := case when jsonb_typeof(active_state -> 'objectives') = 'array' then active_state -> 'objectives' else '[]'::jsonb end;
  existing_discovery_log := case when jsonb_typeof(active_state -> 'discovery_log') = 'array' then active_state -> 'discovery_log' else '[]'::jsonb end;
  existing_discovery_flags := case when jsonb_typeof(active_state -> 'discovery_flags') = 'object' then active_state -> 'discovery_flags' else '{}'::jsonb end;
  existing_scene_cache := case when jsonb_typeof(active_state -> 'scene_cache') = 'object' then active_state -> 'scene_cache' else '{}'::jsonb end;
  existing_companion_checkins := case when jsonb_typeof(active_state -> 'companion_checkins') = 'array' then active_state -> 'companion_checkins' else '[]'::jsonb end;

  delta_rumors := case when jsonb_typeof(board_delta -> 'rumors') = 'array' then board_delta -> 'rumors' else '[]'::jsonb end;
  delta_objectives := case when jsonb_typeof(board_delta -> 'objectives') = 'array' then board_delta -> 'objectives' else '[]'::jsonb end;
  delta_discovery_log := case when jsonb_typeof(board_delta -> 'discovery_log') = 'array' then board_delta -> 'discovery_log' else '[]'::jsonb end;
  delta_discovery_flags := case when jsonb_typeof(board_delta -> 'discovery_flags') = 'object' then board_delta -> 'discovery_flags' else '{}'::jsonb end;
  delta_scene_cache := case when jsonb_typeof(board_delta -> 'scene_cache') = 'object' then board_delta -> 'scene_cache' else '{}'::jsonb end;
  delta_companion_checkins := case when jsonb_typeof(board_delta -> 'companion_checkins') = 'array' then board_delta -> 'companion_checkins' else '[]'::jsonb end;

  seed_text := coalesce(nullif(mythic_commit_turn.turn_seed, ''), md5(next_turn_index::text || ':' || mythic_commit_turn.campaign_id::text));

  if mod(next_turn_index, 3) = 0 then
    select count(*)
      into companion_count
      from mythic.campaign_companions cc
     where cc.campaign_id = mythic_commit_turn.campaign_id;

    if companion_count > 0 then
      companion_offset := mythic.stable_int(seed_text || ':companion:' || next_turn_index::text) % companion_count;
      select *
        into companion_record
        from mythic.campaign_companions cc
       where cc.campaign_id = mythic_commit_turn.campaign_id
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
          mythic_commit_turn.campaign_id,
          mythic_commit_turn.player_id,
          'companion_checkin',
          case urgency_label when 'high' then 3 when 'medium' then 2 else 1 end,
          jsonb_build_object(
            'turn_index', next_turn_index,
            'board_id', active_board_id,
            'companion_checkin', generated_checkin
          )
        );
      end if;
    end if;
  end if;

  merged_state := coalesce(active_state, '{}'::jsonb) || jsonb_build_object(
    'rumors', mythic.jsonb_array_tail(existing_rumors || delta_rumors, 36),
    'objectives', mythic.jsonb_array_tail(existing_objectives || delta_objectives, 24),
    'discovery_log', mythic.normalize_discovery_log(existing_discovery_log || delta_discovery_log),
    'discovery_flags', existing_discovery_flags || delta_discovery_flags,
    'scene_cache', existing_scene_cache || delta_scene_cache,
    'companion_checkins', mythic.jsonb_array_tail(existing_companion_checkins || delta_companion_checkins || generated_companion_checkins, 24),
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
      where cc.campaign_id = mythic_commit_turn.campaign_id
    ), '[]'::jsonb)
  );

  if active_board_id is not null then
    update mythic.boards
       set state_json = merged_state,
           updated_at = now()
     where id = active_board_id;
  end if;

  select dwt.tension
    into world_heat
    from mythic.dm_world_tension dwt
   where dwt.campaign_id = mythic_commit_turn.campaign_id
   limit 1;

  return jsonb_build_object(
    'ok', true,
    'turn_id', inserted_turn_id,
    'turn_index', next_turn_index,
    'world_time', now(),
    'heat', world_heat,
    'board_id', active_board_id
  );
exception
  when unique_violation then
    raise exception 'expected_turn_index_conflict:%', next_turn_index using errcode = '40001';
end;
$$;
