create schema if not exists mythic;

create table if not exists mythic.quest_arcs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  arc_key text not null,
  title text not null,
  summary text not null default '',
  state text not null default 'available',
  priority int not null default 3,
  source text not null default 'dm',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, arc_key),
  check (state in ('available', 'active', 'blocked', 'completed', 'failed')),
  check (priority between 1 and 5)
);

create table if not exists mythic.quest_objectives (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  arc_id uuid not null references mythic.quest_arcs(id) on delete cascade,
  objective_key text not null,
  description text not null,
  target_count int not null default 1,
  current_count int not null default 0,
  state text not null default 'active',
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (arc_id, objective_key),
  check (target_count >= 1),
  check (current_count >= 0),
  check (state in ('active', 'completed', 'failed'))
);

create table if not exists mythic.story_beats (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  beat_type text not null default 'event',
  title text not null,
  narrative text not null,
  emphasis text not null default 'normal',
  metadata jsonb not null default '{}'::jsonb,
  created_by text not null default 'dm',
  created_at timestamptz not null default now(),
  check (emphasis in ('low', 'normal', 'high', 'critical'))
);

create table if not exists mythic.dm_turn_log (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  player_id uuid,
  player_action text not null,
  action_tags text[] not null default '{}'::text[],
  narration text not null,
  mood_before text,
  mood_after text,
  dm_deltas jsonb not null default '{}'::jsonb,
  tension_deltas jsonb not null default '{}'::jsonb,
  applied_ops jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_mythic_quest_arcs_campaign_state
  on mythic.quest_arcs(campaign_id, state, updated_at desc);
create index if not exists idx_mythic_quest_objectives_campaign_arc
  on mythic.quest_objectives(campaign_id, arc_id, sort_order, updated_at desc);
create index if not exists idx_mythic_story_beats_campaign_created
  on mythic.story_beats(campaign_id, created_at desc);
create index if not exists idx_mythic_dm_turn_log_campaign_created
  on mythic.dm_turn_log(campaign_id, created_at desc);
create index if not exists idx_mythic_dm_turn_log_player_created
  on mythic.dm_turn_log(player_id, created_at desc);

alter table mythic.quest_arcs enable row level security;
alter table mythic.quest_objectives enable row level security;
alter table mythic.story_beats enable row level security;
alter table mythic.dm_turn_log enable row level security;

drop policy if exists quest_arcs_select_members on mythic.quest_arcs;
create policy quest_arcs_select_members
  on mythic.quest_arcs
  for select
  using (
    auth.uid() is not null
    and (
      public.is_campaign_member(campaign_id, auth.uid())
      or public.is_campaign_owner(campaign_id, auth.uid())
    )
  );

drop policy if exists quest_objectives_select_members on mythic.quest_objectives;
create policy quest_objectives_select_members
  on mythic.quest_objectives
  for select
  using (
    auth.uid() is not null
    and (
      public.is_campaign_member(campaign_id, auth.uid())
      or public.is_campaign_owner(campaign_id, auth.uid())
    )
  );

drop policy if exists story_beats_select_members on mythic.story_beats;
create policy story_beats_select_members
  on mythic.story_beats
  for select
  using (
    auth.uid() is not null
    and (
      public.is_campaign_member(campaign_id, auth.uid())
      or public.is_campaign_owner(campaign_id, auth.uid())
    )
  );

drop policy if exists dm_turn_log_select_members on mythic.dm_turn_log;
create policy dm_turn_log_select_members
  on mythic.dm_turn_log
  for select
  using (
    auth.uid() is not null
    and (
      public.is_campaign_member(campaign_id, auth.uid())
      or public.is_campaign_owner(campaign_id, auth.uid())
    )
  );

drop policy if exists quest_arcs_service_write on mythic.quest_arcs;
create policy quest_arcs_service_write
  on mythic.quest_arcs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists quest_objectives_service_write on mythic.quest_objectives;
create policy quest_objectives_service_write
  on mythic.quest_objectives
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists story_beats_service_write on mythic.story_beats;
create policy story_beats_service_write
  on mythic.story_beats
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists dm_turn_log_service_write on mythic.dm_turn_log;
create policy dm_turn_log_service_write
  on mythic.dm_turn_log
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function mythic.apply_dm_turn(
  p_campaign_id uuid,
  p_player_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = mythic, public
as $$
declare
  v_apply_ts timestamptz := now();
  v_action_tags text[] := '{}'::text[];
  v_action_text text := coalesce(p_payload->>'player_action', '');
  v_narration text := coalesce(p_payload->>'narration', '');
  v_mood_before text := nullif(trim(coalesce(p_payload->>'mood_before', '')), '');
  v_mood_after text := nullif(trim(coalesce(p_payload->>'mood_after', '')), '');
  v_quest_op jsonb;
  v_story_beat jsonb := coalesce(p_payload->'story_beat', 'null'::jsonb);
  v_memory_event jsonb;
  v_arc_id uuid;
  v_arc_key text;
  v_arc_title text;
  v_arc_summary text;
  v_arc_state text;
  v_arc_priority int;
  v_objective_key text;
  v_objective_description text;
  v_objective_target int;
  v_objective_delta int;
  v_objective_state text;
  v_has_threaten boolean := false;
  v_has_mercy boolean := false;
  v_has_greed boolean := false;
  v_has_investigate boolean := false;
  v_has_retreat boolean := false;
  v_count_arcs int := 0;
  v_count_objectives int := 0;
  v_count_beats int := 0;
  v_count_memory int := 0;
begin
  if p_campaign_id is null then
    raise exception 'p_campaign_id is required';
  end if;
  if p_player_id is null then
    raise exception 'p_player_id is required';
  end if;

  select coalesce(array_agg(value), '{}'::text[])
    into v_action_tags
    from jsonb_array_elements_text(coalesce(p_payload->'action_tags', '[]'::jsonb)) as t(value);

  v_has_threaten := 'threaten' = any(v_action_tags) or 'dominance' = any(v_action_tags);
  v_has_mercy := 'mercy' = any(v_action_tags) or 'restraint' = any(v_action_tags);
  v_has_greed := 'demand_payment' = any(v_action_tags) or 'greed' = any(v_action_tags);
  v_has_investigate := 'investigate' = any(v_action_tags) or 'caution' = any(v_action_tags);
  v_has_retreat := 'retreat' = any(v_action_tags) or 'survival' = any(v_action_tags);

  insert into mythic.dm_campaign_state (campaign_id)
  values (p_campaign_id)
  on conflict (campaign_id) do nothing;

  insert into mythic.dm_world_tension (campaign_id)
  values (p_campaign_id)
  on conflict (campaign_id) do nothing;

  insert into mythic.dm_player_model (campaign_id, player_id)
  values (p_campaign_id, p_player_id)
  on conflict (campaign_id, player_id) do nothing;

  update mythic.dm_campaign_state
  set
    cruelty = greatest(0::double precision, least(1::double precision, cruelty + case when jsonb_typeof(p_payload->'dm_deltas'->'cruelty') = 'number' then (p_payload->'dm_deltas'->>'cruelty')::double precision else 0 end + case when v_has_threaten then 0.04 else 0 end - case when v_has_mercy then 0.02 else 0 end)),
    honesty = greatest(0::double precision, least(1::double precision, honesty + case when jsonb_typeof(p_payload->'dm_deltas'->'honesty') = 'number' then (p_payload->'dm_deltas'->>'honesty')::double precision else 0 end)),
    playfulness = greatest(0::double precision, least(1::double precision, playfulness + case when jsonb_typeof(p_payload->'dm_deltas'->'playfulness') = 'number' then (p_payload->'dm_deltas'->>'playfulness')::double precision else 0 end + case when v_has_threaten then 0.03 else 0 end + case when v_has_mercy then 0.02 else 0 end)),
    intervention = greatest(0::double precision, least(1::double precision, intervention + case when jsonb_typeof(p_payload->'dm_deltas'->'intervention') = 'number' then (p_payload->'dm_deltas'->>'intervention')::double precision else 0 end + case when v_has_retreat then 0.03 else 0 end)),
    favoritism = greatest(0::double precision, least(1::double precision, favoritism + case when jsonb_typeof(p_payload->'dm_deltas'->'favoritism') = 'number' then (p_payload->'dm_deltas'->>'favoritism')::double precision else 0 end + case when v_has_mercy then 0.04 else 0 end)),
    irritation = greatest(0::double precision, least(1::double precision, irritation + case when jsonb_typeof(p_payload->'dm_deltas'->'irritation') = 'number' then (p_payload->'dm_deltas'->>'irritation')::double precision else 0 end + case when v_has_retreat then 0.02 else 0 end + case when v_has_threaten then 0.01 else 0 end)),
    amusement = greatest(0::double precision, least(1::double precision, amusement + case when jsonb_typeof(p_payload->'dm_deltas'->'amusement') = 'number' then (p_payload->'dm_deltas'->>'amusement')::double precision else 0 end + case when v_has_threaten then 0.03 else 0 end + case when v_has_investigate then 0.01 else 0 end)),
    menace = greatest(0::double precision, least(1::double precision, menace + case when jsonb_typeof(p_payload->'dm_deltas'->'menace') = 'number' then (p_payload->'dm_deltas'->>'menace')::double precision else 0 end + case when v_has_threaten then 0.04 else 0 end - case when v_has_mercy then 0.01 else 0 end)),
    respect = greatest(0::double precision, least(1::double precision, respect + case when jsonb_typeof(p_payload->'dm_deltas'->'respect') = 'number' then (p_payload->'dm_deltas'->>'respect')::double precision else 0 end + case when v_has_investigate then 0.02 else 0 end + case when v_has_mercy then 0.02 else 0 end)),
    boredom = greatest(0::double precision, least(1::double precision, boredom + case when jsonb_typeof(p_payload->'dm_deltas'->'boredom') = 'number' then (p_payload->'dm_deltas'->>'boredom')::double precision else 0 end - case when v_has_threaten then 0.02 else 0 end - case when v_has_investigate then 0.01 else 0 end)),
    updated_at = v_apply_ts
  where campaign_id = p_campaign_id;

  update mythic.dm_world_tension
  set
    tension = greatest(0::double precision, least(1::double precision, tension + case when jsonb_typeof(p_payload->'tension_deltas'->'tension') = 'number' then (p_payload->'tension_deltas'->>'tension')::double precision else 0 end + case when v_has_threaten then 0.03 else 0 end + case when v_has_retreat then 0.01 else 0 end)),
    doom = greatest(0::double precision, least(1::double precision, doom + case when jsonb_typeof(p_payload->'tension_deltas'->'doom') = 'number' then (p_payload->'tension_deltas'->>'doom')::double precision else 0 end + case when v_has_retreat then 0.02 else 0 end + case when v_has_greed then 0.01 else 0 end)),
    spectacle = greatest(0::double precision, least(1::double precision, spectacle + case when jsonb_typeof(p_payload->'tension_deltas'->'spectacle') = 'number' then (p_payload->'tension_deltas'->>'spectacle')::double precision else 0 end + case when v_has_threaten then 0.02 else 0 end + case when v_has_mercy then 0.01 else 0 end)),
    updated_at = v_apply_ts
  where campaign_id = p_campaign_id;

  update mythic.dm_player_model
  set
    cruelty_score = greatest(0, least(100, cruelty_score + case when v_has_threaten then 4 else 0 end - case when v_has_mercy then 2 else 0 end)),
    heroism_score = greatest(0, least(100, heroism_score + case when v_has_mercy then 3 else 0 end)),
    cunning_score = greatest(0, least(100, cunning_score + case when v_has_investigate then 2 else 0 end + case when v_has_retreat then 1 else 0 end)),
    chaos_score = greatest(0, least(100, chaos_score + case when v_has_threaten then 2 else 0 end + case when v_has_greed then 1 else 0 end)),
    honor_score = greatest(0, least(100, honor_score + case when v_has_mercy then 2 else 0 end - case when v_has_greed then 1 else 0 end)),
    greed_score = greatest(0, least(100, greed_score + case when v_has_greed then 3 else 0 end)),
    boredom_signals = greatest(0, boredom_signals + case when v_has_retreat then 1 else 0 end),
    exploit_signals = greatest(0, exploit_signals + case when v_has_greed then 1 else 0 end),
    preferred_tactics = jsonb_set(
      coalesce(preferred_tactics, '{}'::jsonb),
      '{last_action_tags}',
      to_jsonb(v_action_tags),
      true
    ),
    updated_at = v_apply_ts
  where campaign_id = p_campaign_id and player_id = p_player_id;

  for v_quest_op in
    select value
    from jsonb_array_elements(coalesce(p_payload->'quest_ops', '[]'::jsonb))
  loop
    v_arc_key := nullif(trim(coalesce(v_quest_op->>'arc_key', '')), '');
    if v_arc_key is null then
      continue;
    end if;

    v_arc_title := coalesce(
      nullif(trim(coalesce(v_quest_op->>'title', '')), ''),
      initcap(replace(v_arc_key, '-', ' '))
    );
    v_arc_summary := coalesce(v_quest_op->>'summary', '');
    v_arc_state := case
      when coalesce(v_quest_op->>'state', '') in ('available', 'active', 'blocked', 'completed', 'failed')
        then v_quest_op->>'state'
      else 'active'
    end;
    v_arc_priority := case
      when coalesce(v_quest_op->>'priority', '') ~ '^\d+$'
        then greatest(1, least(5, (v_quest_op->>'priority')::int))
      else 3
    end;

    if coalesce(v_quest_op->>'type', '') in ('upsert_arc', 'set_arc_state', 'upsert_objective', 'progress_objective') then
      insert into mythic.quest_arcs (
        campaign_id,
        arc_key,
        title,
        summary,
        state,
        priority,
        source,
        created_at,
        updated_at
      ) values (
        p_campaign_id,
        v_arc_key,
        v_arc_title,
        v_arc_summary,
        v_arc_state,
        v_arc_priority,
        'dm',
        v_apply_ts,
        v_apply_ts
      )
      on conflict (campaign_id, arc_key)
      do update
        set
          title = excluded.title,
          summary = excluded.summary,
          state = case
            when coalesce(v_quest_op->>'type', '') = 'set_arc_state' then excluded.state
            when coalesce(v_quest_op->>'type', '') = 'upsert_arc' then excluded.state
            else mythic.quest_arcs.state
          end,
          priority = excluded.priority,
          source = excluded.source,
          updated_at = v_apply_ts
      returning id into v_arc_id;
    end if;

    if coalesce(v_quest_op->>'type', '') = 'upsert_arc' then
      v_count_arcs := v_count_arcs + 1;
      continue;
    end if;

    if coalesce(v_quest_op->>'type', '') = 'set_arc_state' then
      v_count_arcs := v_count_arcs + 1;
      continue;
    end if;

    v_objective_key := nullif(trim(coalesce(v_quest_op->>'objective_key', '')), '');
    if v_objective_key is null then
      continue;
    end if;

    if coalesce(v_quest_op->>'type', '') = 'upsert_objective' then
      v_objective_description := coalesce(
        nullif(trim(coalesce(v_quest_op->>'objective_description', '')), ''),
        initcap(replace(v_objective_key, '-', ' '))
      );
      v_objective_target := case
        when coalesce(v_quest_op->>'objective_target_count', '') ~ '^\d+$'
          then greatest(1, (v_quest_op->>'objective_target_count')::int)
        else 1
      end;
      v_objective_state := case
        when coalesce(v_quest_op->>'objective_state', '') in ('active', 'completed', 'failed')
          then v_quest_op->>'objective_state'
        else 'active'
      end;

      insert into mythic.quest_objectives (
        campaign_id,
        arc_id,
        objective_key,
        description,
        target_count,
        current_count,
        state,
        sort_order,
        created_at,
        updated_at
      ) values (
        p_campaign_id,
        v_arc_id,
        v_objective_key,
        v_objective_description,
        v_objective_target,
        0,
        v_objective_state,
        0,
        v_apply_ts,
        v_apply_ts
      )
      on conflict (arc_id, objective_key)
      do update
        set
          description = excluded.description,
          target_count = excluded.target_count,
          state = excluded.state,
          updated_at = v_apply_ts;

      v_count_objectives := v_count_objectives + 1;
      continue;
    end if;

    if coalesce(v_quest_op->>'type', '') = 'progress_objective' then
      v_objective_delta := case
        when coalesce(v_quest_op->>'objective_delta', '') ~ '^-?\d+$'
          then (v_quest_op->>'objective_delta')::int
        else 1
      end;
      if v_objective_delta = 0 then
        continue;
      end if;

      update mythic.quest_objectives
      set
        current_count = greatest(0, least(target_count, current_count + v_objective_delta)),
        state = case
          when greatest(0, least(target_count, current_count + v_objective_delta)) >= target_count then 'completed'
          else state
        end,
        updated_at = v_apply_ts
      where arc_id = v_arc_id and objective_key = v_objective_key;

      if found then
        v_count_objectives := v_count_objectives + 1;
      end if;
    end if;
  end loop;

  update mythic.quest_arcs qa
  set
    state = 'completed',
    updated_at = v_apply_ts
  where
    qa.campaign_id = p_campaign_id
    and qa.state in ('available', 'active', 'blocked')
    and exists (
      select 1
      from mythic.quest_objectives qo
      where qo.arc_id = qa.id
    )
    and not exists (
      select 1
      from mythic.quest_objectives qo
      where qo.arc_id = qa.id and qo.state <> 'completed'
    );

  if jsonb_typeof(v_story_beat) = 'object'
     and nullif(trim(coalesce(v_story_beat->>'title', '')), '') is not null
     and nullif(trim(coalesce(v_story_beat->>'narrative', '')), '') is not null then
    insert into mythic.story_beats (
      campaign_id,
      beat_type,
      title,
      narrative,
      emphasis,
      metadata,
      created_by,
      created_at
    ) values (
      p_campaign_id,
      coalesce(nullif(trim(coalesce(v_story_beat->>'beat_type', '')), ''), 'event'),
      v_story_beat->>'title',
      v_story_beat->>'narrative',
      case
        when coalesce(v_story_beat->>'emphasis', '') in ('low', 'normal', 'high', 'critical')
          then v_story_beat->>'emphasis'
        else 'normal'
      end,
      case
        when jsonb_typeof(v_story_beat->'metadata') = 'object' then v_story_beat->'metadata'
        else '{}'::jsonb
      end,
      'dm',
      v_apply_ts
    );
    v_count_beats := v_count_beats + 1;
  end if;

  for v_memory_event in
    select value
    from jsonb_array_elements(coalesce(p_payload->'memory_events', '[]'::jsonb))
  loop
    if jsonb_typeof(v_memory_event) <> 'object' then
      continue;
    end if;
    if nullif(trim(coalesce(v_memory_event->>'category', '')), '') is null then
      continue;
    end if;

    insert into mythic.dm_memory_events (
      campaign_id,
      player_id,
      category,
      severity,
      payload,
      created_at
    ) values (
      p_campaign_id,
      p_player_id,
      v_memory_event->>'category',
      case
        when coalesce(v_memory_event->>'severity', '') ~ '^\d+$'
          then greatest(1, least(5, (v_memory_event->>'severity')::int))
        else 1
      end,
      case
        when jsonb_typeof(v_memory_event->'payload') = 'object' then v_memory_event->'payload'
        else '{}'::jsonb
      end,
      v_apply_ts
    );
    v_count_memory := v_count_memory + 1;
  end loop;

  insert into mythic.dm_turn_log (
    campaign_id,
    player_id,
    player_action,
    action_tags,
    narration,
    mood_before,
    mood_after,
    dm_deltas,
    tension_deltas,
    applied_ops,
    created_at
  ) values (
    p_campaign_id,
    p_player_id,
    coalesce(nullif(v_action_text, ''), '(no action)'),
    v_action_tags,
    coalesce(nullif(v_narration, ''), '(no narration)'),
    v_mood_before,
    v_mood_after,
    coalesce(p_payload->'dm_deltas', '{}'::jsonb),
    coalesce(p_payload->'tension_deltas', '{}'::jsonb),
    jsonb_build_object(
      'quest_ops', coalesce(p_payload->'quest_ops', '[]'::jsonb),
      'story_beat', coalesce(p_payload->'story_beat', 'null'::jsonb),
      'memory_events', coalesce(p_payload->'memory_events', '[]'::jsonb)
    ),
    v_apply_ts
  );

  return jsonb_build_object(
    'quest_arcs_updated', v_count_arcs,
    'quest_objectives_updated', v_count_objectives,
    'story_beats_created', v_count_beats,
    'dm_memory_events_created', v_count_memory,
    'mood_after', v_mood_after
  );
end;
$$;

grant select on table mythic.quest_arcs to authenticated;
grant select on table mythic.quest_objectives to authenticated;
grant select on table mythic.story_beats to authenticated;
grant select on table mythic.dm_turn_log to authenticated;

grant all on table mythic.quest_arcs to service_role;
grant all on table mythic.quest_objectives to service_role;
grant all on table mythic.story_beats to service_role;
grant all on table mythic.dm_turn_log to service_role;
grant execute on function mythic.apply_dm_turn(uuid, uuid, jsonb) to service_role;
