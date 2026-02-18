-- Public RPC wrappers for mythic runtime.
-- Purpose: avoid PostgREST schema-cache misses when calling non-public schema RPCs.
-- Forward-only and idempotent.

create schema if not exists mythic;

-- Self-heal core write helpers if remote drifted and these were dropped/missed.
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

-- Drop legacy wrapper signatures to avoid parameter-name conflicts on CREATE OR REPLACE.
drop function if exists public.mythic_start_combat_session(uuid, int, jsonb, text);
drop function if exists public.mythic_end_combat_session(uuid, jsonb);
drop function if exists public.mythic_append_action_event(uuid, int, uuid, text, jsonb);
drop function if exists public.mythic_max_hp(int, int, int);
drop function if exists public.mythic_max_power_bar(int, int, int);
drop function if exists public.mythic_compute_damage(int, text, int, int, int, int, numeric, numeric, numeric, double precision);
drop function if exists public.mythic_status_apply_chance(int, int, int);
drop function if exists public.mythic_resolve_status_tick(uuid, uuid, int, text);
drop function if exists public.mythic_apply_xp(uuid, int, text, jsonb);
drop function if exists public.mythic_loadout_slots_for_level(int);

create or replace function public.mythic_start_combat_session(
  campaign_id uuid,
  seed int,
  scene_json jsonb,
  reason text default 'encounter'
)
returns uuid
language sql
volatile
as $$
  select mythic.start_combat_session(campaign_id, seed, scene_json, reason);
$$;

create or replace function public.mythic_end_combat_session(
  combat_session_id uuid,
  outcome jsonb default '{}'::jsonb
)
returns void
language sql
volatile
as $$
  select mythic.end_combat_session(combat_session_id, outcome);
$$;

create or replace function public.mythic_append_action_event(
  combat_session_id uuid,
  turn_index int,
  actor_combatant_id uuid,
  event_type text,
  payload jsonb
)
returns uuid
language sql
volatile
as $$
  select mythic.append_action_event(combat_session_id, turn_index, actor_combatant_id, event_type, payload);
$$;

create or replace function public.mythic_max_hp(
  lvl int,
  defense int,
  support int
)
returns numeric
language sql
stable
as $$
  select mythic.max_hp(lvl, defense, support);
$$;

create or replace function public.mythic_max_power_bar(
  lvl int,
  utility int,
  support int
)
returns numeric
language sql
stable
as $$
  select mythic.max_power_bar(lvl, utility, support);
$$;

create or replace function public.mythic_compute_damage(
  seed int,
  label text,
  lvl int,
  offense int,
  mobility int,
  utility int,
  weapon_power numeric,
  skill_mult numeric,
  resist numeric,
  spread_pct double precision default 0.10
)
returns jsonb
language sql
immutable
as $$
  select mythic.compute_damage(seed, label, lvl, offense, mobility, utility, weapon_power, skill_mult, resist, spread_pct);
$$;

create or replace function public.mythic_status_apply_chance(
  control int,
  utility int,
  target_resolve int
)
returns double precision
language sql
immutable
as $$
  select mythic.status_apply_chance(control, utility, target_resolve);
$$;

create or replace function public.mythic_resolve_status_tick(
  combat_session_id uuid,
  combatant_id uuid,
  turn_index int,
  phase text default 'start'
)
returns jsonb
language sql
volatile
as $$
  select mythic.resolve_status_tick(combat_session_id, combatant_id, turn_index, phase);
$$;

create or replace function public.mythic_apply_xp(
  character_id uuid,
  amount int,
  reason text default 'combat',
  metadata jsonb default '{}'::jsonb
)
returns jsonb
language sql
volatile
as $$
  select mythic.apply_xp(character_id, amount, reason, metadata);
$$;

create or replace function public.mythic_loadout_slots_for_level(
  lvl int
)
returns int
language sql
stable
as $$
  select mythic.loadout_slots_for_level(lvl);
$$;

grant execute on function public.mythic_start_combat_session(uuid, int, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.mythic_end_combat_session(uuid, jsonb) to anon, authenticated, service_role;
grant execute on function public.mythic_append_action_event(uuid, int, uuid, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.mythic_max_hp(int, int, int) to anon, authenticated, service_role;
grant execute on function public.mythic_max_power_bar(int, int, int) to anon, authenticated, service_role;
grant execute on function public.mythic_compute_damage(int, text, int, int, int, int, numeric, numeric, numeric, double precision) to anon, authenticated, service_role;
grant execute on function public.mythic_status_apply_chance(int, int, int) to anon, authenticated, service_role;
grant execute on function public.mythic_resolve_status_tick(uuid, uuid, int, text) to anon, authenticated, service_role;
grant execute on function public.mythic_apply_xp(uuid, int, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.mythic_loadout_slots_for_level(int) to anon, authenticated, service_role;
