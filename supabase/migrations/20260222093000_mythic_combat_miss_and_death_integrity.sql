-- Combat integrity lock-in:
-- 1) Add `miss` to action event contract.
-- 2) Normalize status tick HP to integers and enforce death invariant (hp <= 0 => dead).
-- 3) Emit `death` when status ticks drop an alive unit to zero.

create schema if not exists mythic;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'action_events_event_type_contract'
      and conrelid = 'mythic.action_events'::regclass
  ) then
    alter table mythic.action_events drop constraint action_events_event_type_contract;
  end if;

  alter table mythic.action_events
    add constraint action_events_event_type_contract
    check (
      event_type in (
        'combat_start',
        'round_start',
        'turn_start',
        'skill_used',
        'moved',
        'miss',
        'damage',
        'status_roll',
        'status_applied',
        'status_tick',
        'status_expired',
        'armor_shred',
        'power_drain',
        'power_gain',
        'healed',
        'cleanse',
        'revive',
        'phase_shift',
        'summon_spawn',
        'death',
        'loot_drop',
        'xp_gain',
        'level_up',
        'turn_end',
        'round_end',
        'combat_end',
        'board_transition'
      )
    );
end $$;

create or replace function mythic.resolve_status_tick(
  p_combat_session_id uuid,
  p_combatant_id uuid,
  p_turn_index int,
  p_phase text default 'start'
)
returns jsonb
language plpgsql
volatile
as $$
declare
  c mythic.combatants%rowtype;
  s jsonb;
  next_statuses jsonb := '[]'::jsonb;
  expired jsonb := '[]'::jsonb;
  dot_damage numeric := 0;
  hot_heal numeric := 0;
  next_hp numeric;
  next_hp_int int;
  alive_after boolean;
  prev_alive boolean;
  expires_turn int;
  stacks int;
  dmg_per_turn numeric;
  heal_per_turn numeric;
  payload jsonb;
  sid text;
begin
  select * into c
  from mythic.combatants
  where id = p_combatant_id
    and combat_session_id = p_combat_session_id
  for update;

  if not found then
    raise exception 'combatant not found: %', p_combatant_id;
  end if;

  for s in
    select value
    from jsonb_array_elements(coalesce(c.statuses, '[]'::jsonb))
  loop
    sid := coalesce(s->>'id', '');
    if sid = '' then
      continue;
    end if;

    expires_turn := nullif(coalesce(s->>'expires_turn', ''), '')::int;
    stacks := greatest(1, coalesce((s->>'stacks')::int, 1));

    dmg_per_turn := coalesce((s->'data'->>'damage_per_turn')::numeric, 0);
    heal_per_turn := coalesce((s->'data'->>'heal_per_turn')::numeric, 0);

    if p_phase = 'start' then
      if dmg_per_turn > 0 then
        dot_damage := dot_damage + (dmg_per_turn * stacks);
      end if;
      if heal_per_turn > 0 then
        hot_heal := hot_heal + (heal_per_turn * stacks);
      end if;
    end if;

    if expires_turn is not null and expires_turn <= p_turn_index then
      expired := expired || jsonb_build_array(s);
    else
      next_statuses := next_statuses || jsonb_build_array(s);
    end if;
  end loop;

  next_hp := greatest(0, least(c.hp_max, c.hp - dot_damage + hot_heal));
  next_hp_int := greatest(0, coalesce(round(next_hp)::int, 0));
  alive_after := next_hp_int > 0;
  prev_alive := coalesce(c.is_alive, false) and coalesce(c.hp, 0) > 0;

  update mythic.combatants
  set hp = next_hp_int,
      is_alive = alive_after,
      statuses = next_statuses,
      updated_at = now()
  where id = c.id
    and combat_session_id = c.combat_session_id;

  if dot_damage > 0 or hot_heal > 0 then
    payload := jsonb_build_object(
      'target_combatant_id', c.id,
      'phase', p_phase,
      'dot_damage', greatest(0, floor(dot_damage)),
      'hot_heal', greatest(0, floor(hot_heal)),
      'hp_after', next_hp_int,
      'is_alive', alive_after
    );
    insert into mythic.action_events (combat_session_id, turn_index, actor_combatant_id, event_type, payload)
    values (c.combat_session_id, greatest(coalesce(p_turn_index, 0), 0), c.id, 'status_tick', payload);
  end if;

  if jsonb_array_length(expired) > 0 then
    payload := jsonb_build_object(
      'target_combatant_id', c.id,
      'phase', p_phase,
      'expired', expired
    );
    insert into mythic.action_events (combat_session_id, turn_index, actor_combatant_id, event_type, payload)
    values (c.combat_session_id, greatest(coalesce(p_turn_index, 0), 0), c.id, 'status_expired', payload);
  end if;

  if prev_alive and not alive_after then
    insert into mythic.action_events (combat_session_id, turn_index, actor_combatant_id, event_type, payload)
    values (
      c.combat_session_id,
      greatest(coalesce(p_turn_index, 0), 0),
      c.id,
      'death',
      jsonb_build_object(
        'target_combatant_id', c.id,
        'reason', 'status_tick',
        'hp_after', next_hp_int
      )
    );
  end if;

  return jsonb_build_object(
    'combatant_id', c.id,
    'phase', p_phase,
    'hp_after', next_hp_int,
    'is_alive', alive_after,
    'dot_damage', greatest(0, floor(dot_damage)),
    'hot_heal', greatest(0, floor(hot_heal)),
    'expired_count', jsonb_array_length(expired)
  );
end;
$$;
