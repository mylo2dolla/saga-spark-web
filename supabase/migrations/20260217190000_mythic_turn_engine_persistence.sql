-- Mythic Turn Engine: persistence + atomic commit RPC
-- Forward-only, additive, idempotent.

create schema if not exists mythic;

-- -----------------------------
-- World state (campaign-scoped)
-- -----------------------------
create table if not exists mythic.world_state (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(state_json) = 'object')
);

create index if not exists idx_mythic_world_state_updated
  on mythic.world_state(updated_at desc);

-- -----------------------------
-- Turns (authoritative DM turn commits)
-- -----------------------------
create table if not exists mythic.turns (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  player_id uuid null references auth.users(id) on delete set null,
  board_id uuid null references mythic.boards(id) on delete set null,
  board_type mythic.board_type not null,
  turn_index int not null,
  turn_seed bigint not null,
  status text not null default 'committed' check (status in ('committed','rejected','failed')),
  dm_request_json jsonb not null default '{}'::jsonb,
  dm_response_json jsonb not null default '{}'::jsonb,
  patches_json jsonb not null default '[]'::jsonb,
  roll_log_json jsonb not null default '[]'::jsonb,
  error_code text null,
  error_message text null,
  created_at timestamptz not null default now(),
  committed_at timestamptz null,
  check (jsonb_typeof(dm_request_json) = 'object'),
  check (jsonb_typeof(dm_response_json) = 'object'),
  check (jsonb_typeof(patches_json) = 'array'),
  check (jsonb_typeof(roll_log_json) = 'array')
);

create unique index if not exists uq_mythic_turns_campaign_turn_index
  on mythic.turns(campaign_id, turn_index);

create index if not exists idx_mythic_turns_campaign_time
  on mythic.turns(campaign_id, created_at desc);

create index if not exists idx_mythic_turns_player_time
  on mythic.turns(player_id, created_at desc);

-- -----------------------------
-- World facts (supersession model)
-- -----------------------------
create table if not exists mythic.world_facts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  fact_key text not null,
  fact_json jsonb not null default '{}'::jsonb,
  supersedes_fact_id uuid null references mythic.world_facts(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  superseded_at timestamptz null,
  check (jsonb_typeof(fact_json) = 'object')
);

create index if not exists idx_mythic_world_facts_campaign_key
  on mythic.world_facts(campaign_id, fact_key);

create unique index if not exists uq_mythic_world_facts_active
  on mythic.world_facts(campaign_id, fact_key)
  where is_active;

-- -----------------------------
-- World entities (NPCs/quests/locations/etc)
-- -----------------------------
create table if not exists mythic.world_entities (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  entity_key text not null,
  entity_type text not null,
  entity_json jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, entity_key),
  check (jsonb_typeof(entity_json) = 'object')
);

create index if not exists idx_mythic_world_entities_campaign_type
  on mythic.world_entities(campaign_id, entity_type);

-- -----------------------------
-- Relationships
-- -----------------------------
create table if not exists mythic.relationships (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  subject_key text not null,
  object_key text not null,
  rel_type text not null,
  rel_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, subject_key, object_key, rel_type),
  check (jsonb_typeof(rel_json) = 'object')
);

create index if not exists idx_mythic_relationships_campaign_subject
  on mythic.relationships(campaign_id, subject_key);

-- -----------------------------
-- Audit log (game-level events)
-- -----------------------------
create table if not exists mythic.audit_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  player_id uuid null references auth.users(id) on delete set null,
  actor text not null default 'system',
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_mythic_audit_log_campaign_time
  on mythic.audit_log(campaign_id, created_at desc);

-- -----------------------------
-- Content flags (safety / validation)
-- -----------------------------
create table if not exists mythic.content_flags (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  turn_id uuid null references mythic.turns(id) on delete cascade,
  flag_type text not null,
  severity int not null default 1 check (severity between 1 and 5),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(details) = 'object')
);

create index if not exists idx_mythic_content_flags_campaign_time
  on mythic.content_flags(campaign_id, created_at desc);

-- -----------------------------
-- Atomic turn commit (service_role only)
-- -----------------------------
create or replace function mythic.commit_turn(
  p_campaign_id uuid,
  p_player_id uuid,
  p_board_id uuid,
  p_board_type mythic.board_type,
  p_turn_seed bigint,
  p_dm_request_json jsonb,
  p_dm_response_json jsonb,
  p_patches_json jsonb default '[]'::jsonb,
  p_roll_log_json jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
volatile
as $$
declare
  v_role text;
  v_now timestamptz := now();
  v_turn_index int;
  v_expected_turn_index int;
  v_turn_id uuid := gen_random_uuid();
  v_world mythic.world_state%rowtype;
  v_patch jsonb;
  v_op text;
  v_key text;
  v_prev_fact_id uuid;
  v_subject text;
  v_object text;
  v_rel_type text;
  v_world_time int;
  v_heat int;
  v_delta_seconds int;
  v_patch_count int := 0;
begin
  v_role := coalesce(auth.role(), current_setting('request.jwt.claim.role', true), '');
  if v_role <> 'service_role' then
    raise exception 'service_role required' using errcode = '42501';
  end if;

  -- Ensure a world_state row exists and lock it for consistent updates.
  insert into mythic.world_state(campaign_id, state_json, updated_at)
  values (p_campaign_id, '{}'::jsonb, v_now)
  on conflict (campaign_id) do update set updated_at = excluded.updated_at;

  select * into v_world
  from mythic.world_state
  where campaign_id = p_campaign_id
  for update;

  select coalesce(max(turn_index), -1) + 1
  into v_turn_index
  from mythic.turns
  where campaign_id = p_campaign_id;

  -- If the caller computed a seed from an expected index, enforce it to prevent
  -- committing with a mismatched (turn_index, turn_seed) pair under concurrency.
  if jsonb_typeof(p_dm_request_json) = 'object' and (p_dm_request_json ? 'expected_turn_index') then
    begin
      v_expected_turn_index := (p_dm_request_json->>'expected_turn_index')::int;
    exception when others then
      raise exception 'expected_turn_index_invalid' using errcode = '40001';
    end;
    if v_expected_turn_index <> v_turn_index then
      raise exception 'expected_turn_index_mismatch' using errcode = '40001';
    end if;
  end if;

  insert into mythic.turns(
    id,
    campaign_id,
    player_id,
    board_id,
    board_type,
    turn_index,
    turn_seed,
    status,
    dm_request_json,
    dm_response_json,
    patches_json,
    roll_log_json,
    created_at,
    committed_at
  )
  values (
    v_turn_id,
    p_campaign_id,
    p_player_id,
    p_board_id,
    p_board_type,
    v_turn_index,
    p_turn_seed,
    'committed',
    coalesce(p_dm_request_json, '{}'::jsonb),
    coalesce(p_dm_response_json, '{}'::jsonb),
    coalesce(p_patches_json, '[]'::jsonb),
    coalesce(p_roll_log_json, '[]'::jsonb),
    v_now,
    v_now
  );

  -- Apply patches (best-effort, strict types, ignore unknown ops).
  if jsonb_typeof(p_patches_json) = 'array' then
    for v_patch in select * from jsonb_array_elements(p_patches_json) loop
      v_op := coalesce(v_patch->>'op', v_patch->>'type', '');
      if v_op = '' then
        continue;
      end if;
      v_patch_count := v_patch_count + 1;

      if v_op = 'FACT_CREATE' or v_op = 'FACT_SUPERSEDE' then
        v_key := coalesce(v_patch->>'fact_key', v_patch->>'key', '');
        if v_key <> '' then
          select id into v_prev_fact_id
          from mythic.world_facts
          where campaign_id = p_campaign_id and fact_key = v_key and is_active = true
          order by created_at desc
          limit 1;

          update mythic.world_facts
            set is_active = false,
                superseded_at = v_now
            where campaign_id = p_campaign_id
              and fact_key = v_key
              and is_active = true;

          insert into mythic.world_facts(
            campaign_id,
            fact_key,
            fact_json,
            supersedes_fact_id,
            is_active,
            created_at
          )
          values (
            p_campaign_id,
            v_key,
            coalesce(v_patch->'data', v_patch->'fact_json', '{}'::jsonb),
            v_prev_fact_id,
            true,
            v_now
          );
        end if;

      elsif v_op = 'ENTITY_UPSERT' then
        v_key := coalesce(v_patch->>'entity_key', v_patch->>'id', '');
        if v_key <> '' then
          insert into mythic.world_entities(
            campaign_id,
            entity_key,
            entity_type,
            entity_json,
            tags,
            created_at,
            updated_at
          )
          values (
            p_campaign_id,
            v_key,
            coalesce(v_patch->>'entity_type', 'entity'),
            coalesce(v_patch->'data', v_patch->'entity_json', '{}'::jsonb),
            coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_patch->'tags', '[]'::jsonb))), '{}'::text[]),
            v_now,
            v_now
          )
          on conflict (campaign_id, entity_key)
          do update set
            entity_type = excluded.entity_type,
            entity_json = excluded.entity_json,
            tags = excluded.tags,
            updated_at = v_now;
        end if;

      elsif v_op = 'REL_SET' then
        v_subject := coalesce(v_patch->>'subject_key', v_patch->>'subject', '');
        v_object := coalesce(v_patch->>'object_key', v_patch->>'object', '');
        v_rel_type := coalesce(v_patch->>'rel_type', v_patch->>'type_name', '');
        if v_subject <> '' and v_object <> '' and v_rel_type <> '' then
          insert into mythic.relationships(
            campaign_id,
            subject_key,
            object_key,
            rel_type,
            rel_json,
            created_at,
            updated_at
          )
          values (
            p_campaign_id,
            v_subject,
            v_object,
            v_rel_type,
            coalesce(v_patch->'data', v_patch->'rel_json', '{}'::jsonb),
            v_now,
            v_now
          )
          on conflict (campaign_id, subject_key, object_key, rel_type)
          do update set
            rel_json = excluded.rel_json,
            updated_at = v_now;
        end if;

      elsif v_op = 'QUEST_UPSERT' then
        v_key := coalesce(v_patch->>'quest_key', v_patch->>'id', '');
        if v_key <> '' then
          insert into mythic.world_entities(
            campaign_id,
            entity_key,
            entity_type,
            entity_json,
            tags,
            created_at,
            updated_at
          )
          values (
            p_campaign_id,
            v_key,
            'quest',
            v_patch,
            '{}'::text[],
            v_now,
            v_now
          )
          on conflict (campaign_id, entity_key)
          do update set
            entity_type = excluded.entity_type,
            entity_json = excluded.entity_json,
            updated_at = v_now;
        end if;

      elsif v_op = 'LOCATION_STATE_UPDATE' then
        v_key := coalesce(v_patch->>'location_key', v_patch->>'id', '');
        if v_key <> '' then
          insert into mythic.world_entities(
            campaign_id,
            entity_key,
            entity_type,
            entity_json,
            tags,
            created_at,
            updated_at
          )
          values (
            p_campaign_id,
            v_key,
            'location_state',
            coalesce(v_patch->'data', '{}'::jsonb),
            '{}'::text[],
            v_now,
            v_now
          )
          on conflict (campaign_id, entity_key)
          do update set
            entity_type = excluded.entity_type,
            entity_json = excluded.entity_json,
            updated_at = v_now;
        end if;
      end if;
    end loop;
  end if;

  -- Advance world time + heat (stored in world_state.state_json).
  v_world_time := coalesce((v_world.state_json->>'world_time')::int, 0);
  v_heat := coalesce((v_world.state_json->>'heat')::int, 0);

  if p_board_type = 'town' then
    v_delta_seconds := 1800;
  elsif p_board_type = 'travel' then
    v_delta_seconds := 7200;
  elsif p_board_type = 'dungeon' then
    v_delta_seconds := 3600;
  else
    v_delta_seconds := 300;
  end if;

  v_world_time := greatest(0, v_world_time + v_delta_seconds);
  -- Passive decay (keeps heat bounded even if nothing writes to it yet).
  v_heat := greatest(0, least(100, floor(v_heat * 0.98)::int));

  update mythic.world_state
    set state_json =
      jsonb_set(
        jsonb_set(v_world.state_json, '{world_time}', to_jsonb(v_world_time), true),
        '{heat}', to_jsonb(v_heat), true
      ),
      updated_at = v_now
    where campaign_id = p_campaign_id;

  insert into mythic.audit_log(campaign_id, player_id, actor, action_type, payload, created_at)
  values (
    p_campaign_id,
    p_player_id,
    'dm',
    'turn_commit',
    jsonb_build_object(
      'turn_id', v_turn_id,
      'turn_index', v_turn_index,
      'board_type', p_board_type,
      'patch_count', v_patch_count
    ),
    v_now
  );

  return jsonb_build_object(
    'ok', true,
    'turn_id', v_turn_id,
    'turn_index', v_turn_index,
    'world_time', v_world_time,
    'heat', v_heat
  );
end;
$$;

-- Public wrapper (callable via PostgREST RPC). Enforces service_role inside mythic.commit_turn.
create or replace function public.mythic_commit_turn(
  campaign_id uuid,
  player_id uuid,
  board_id uuid,
  board_type mythic.board_type,
  turn_seed bigint,
  dm_request_json jsonb,
  dm_response_json jsonb,
  patches_json jsonb default '[]'::jsonb,
  roll_log_json jsonb default '[]'::jsonb
)
returns jsonb
language sql
volatile
as $$
  select mythic.commit_turn(
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

grant execute on function public.mythic_commit_turn(uuid, uuid, uuid, mythic.board_type, bigint, jsonb, jsonb, jsonb, jsonb) to anon, authenticated, service_role;
