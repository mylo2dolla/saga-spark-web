-- Mythic Weave Core (sync): constraints, append-only enforcement, derived helpers, DM views
-- Reconciles local migration history with remote.
-- Idempotent by design.

create schema if not exists mythic;

-- -----------------------------
-- Content policy enforcement helpers
-- Violence/gore allowed. Sexual content/sexual violence forbidden.
-- -----------------------------
create or replace function mythic.contains_forbidden_sexual_content(txt text)
returns boolean
language sql
immutable
as $$
  select coalesce(txt, '') ~* '(\\bsex\\b|\\bsexual\\b|\\brape\\b|\\bmolest\\b|\\bfuck\\b|\\bporn\\b|\\berotic\\b|\\bnude\\b|\\bnudity\\b|\\bincest\\b|\\bchild\\b\\s*(sex|porn)|\\bunderage\\b\\s*(sex|porn))';
$$;

create or replace function mythic.content_is_allowed(txt text)
returns boolean
language sql
immutable
as $$
  select not mythic.contains_forbidden_sexual_content(txt);
$$;

-- -----------------------------
-- Loot budgets (canonical ladder)
-- -----------------------------
create or replace function mythic.loot_budget_points(r mythic.rarity)
returns int
language sql
immutable
as $$
  select case r
    when 'common' then 8
    when 'magical' then 16
    when 'unique' then 24
    when 'legendary' then 40
    when 'mythic' then 60
    when 'unhinged' then 70
    else 8
  end;
$$;

-- -----------------------------
-- Grid/range math (authoritative)
-- -----------------------------
create or replace function mythic.tile_distance(ax int, ay int, bx int, by int, metric text default 'manhattan')
returns int
language plpgsql
immutable
as $$
declare
  dx int := abs(coalesce(ax,0) - coalesce(bx,0));
  dy int := abs(coalesce(ay,0) - coalesce(by,0));
  m text := coalesce(metric, 'manhattan');
begin
  if m = 'chebyshev' then
    return greatest(dx, dy);
  elsif m = 'euclidean' then
    return floor(sqrt((dx*dx + dy*dy)::double precision))::int;
  else
    return dx + dy;
  end if;
end;
$$;

create or replace function mythic.is_in_range(ax int, ay int, bx int, by int, range_tiles int, metric text default 'manhattan')
returns boolean
language sql
immutable
as $$
  select mythic.tile_distance(ax, ay, bx, by, metric) <= greatest(coalesce(range_tiles, 0), 0);
$$;

-- -----------------------------
-- Equipment stat stacking helpers
-- Unlimited rings/trinkets stack by design.
-- -----------------------------
create or replace function mythic.jsonb_num(obj jsonb, key text)
returns numeric
language sql
immutable
as $$
  select case
    when obj ? key and jsonb_typeof(obj->key) = 'number' then (obj->>key)::numeric
    else 0::numeric
  end;
$$;

create or replace function mythic.compute_equipment_mods(character_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  r record;
  sum_offense numeric := 0;
  sum_defense numeric := 0;
  sum_control numeric := 0;
  sum_support numeric := 0;
  sum_mobility numeric := 0;
  sum_utility numeric := 0;
  sum_weapon_power numeric := 0;
  sum_armor_power numeric := 0;
  sum_resist numeric := 0;
begin
  for r in
    select i.stat_mods
    from mythic.inventory inv
    join mythic.items i on i.id = inv.item_id
    where inv.character_id = character_id
      and inv.container = 'equipment'
  loop
    sum_offense := sum_offense + mythic.jsonb_num(r.stat_mods, 'offense');
    sum_defense := sum_defense + mythic.jsonb_num(r.stat_mods, 'defense');
    sum_control := sum_control + mythic.jsonb_num(r.stat_mods, 'control');
    sum_support := sum_support + mythic.jsonb_num(r.stat_mods, 'support');
    sum_mobility := sum_mobility + mythic.jsonb_num(r.stat_mods, 'mobility');
    sum_utility := sum_utility + mythic.jsonb_num(r.stat_mods, 'utility');
    sum_weapon_power := sum_weapon_power + mythic.jsonb_num(r.stat_mods, 'weapon_power');
    sum_armor_power := sum_armor_power + mythic.jsonb_num(r.stat_mods, 'armor_power');
    sum_resist := sum_resist + mythic.jsonb_num(r.stat_mods, 'resist');
  end loop;

  return jsonb_build_object(
    'offense', sum_offense,
    'defense', sum_defense,
    'control', sum_control,
    'support', sum_support,
    'mobility', sum_mobility,
    'utility', sum_utility,
    'weapon_power', sum_weapon_power,
    'armor_power', sum_armor_power,
    'resist', sum_resist
  );
end;
$$;

create or replace function mythic.compute_character_derived(character_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  c mythic.characters%rowtype;
  eq jsonb;
  weapon_power numeric;
  armor_power numeric;
  resist numeric;
  offense int;
  defense int;
  control int;
  support int;
  mobility int;
  utility int;
  lvl int;
begin
  select * into c from mythic.characters where id = character_id;
  if not found then
    return '{}'::jsonb;
  end if;

  eq := mythic.compute_equipment_mods(character_id);
  lvl := c.level;

  offense := greatest(0, least(100, c.offense + (mythic.jsonb_num(eq, 'offense'))::int));
  defense := greatest(0, least(100, c.defense + (mythic.jsonb_num(eq, 'defense'))::int));
  control := greatest(0, least(100, c.control + (mythic.jsonb_num(eq, 'control'))::int));
  support := greatest(0, least(100, c.support + (mythic.jsonb_num(eq, 'support'))::int));
  mobility := greatest(0, least(100, c.mobility + (mythic.jsonb_num(eq, 'mobility'))::int));
  utility := greatest(0, least(100, c.utility + (mythic.jsonb_num(eq, 'utility'))::int));

  weapon_power := greatest(0, mythic.jsonb_num(eq, 'weapon_power'));
  armor_power := greatest(0, mythic.jsonb_num(eq, 'armor_power'));
  resist := greatest(0, mythic.jsonb_num(eq, 'resist'));

  return jsonb_build_object(
    'equipment_mods', eq,
    'attack_rating', mythic.attack_rating(lvl, offense, weapon_power),
    'armor_rating', mythic.armor_rating(lvl, defense, armor_power),
    'max_hp', mythic.max_hp(lvl, defense, support),
    'max_power_bar', mythic.max_power_bar(lvl, utility, support),
    'crit_chance', mythic.crit_chance(mobility, utility),
    'crit_mult', mythic.crit_mult(offense, utility),
    'resist', resist
  );
end;
$$;

-- -----------------------------
-- Append-only enforcement (combat logs, transitions, memory, rep events)
-- -----------------------------
create or replace function mythic.prevent_update_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'append-only table: updates/deletes are not allowed';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tr_mythic_action_events_append_only') then
    create trigger tr_mythic_action_events_append_only
    before update or delete on mythic.action_events
    for each row execute function mythic.prevent_update_delete();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'tr_mythic_board_transitions_append_only') then
    create trigger tr_mythic_board_transitions_append_only
    before update or delete on mythic.board_transitions
    for each row execute function mythic.prevent_update_delete();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'tr_mythic_dm_memory_events_append_only') then
    create trigger tr_mythic_dm_memory_events_append_only
    before update or delete on mythic.dm_memory_events
    for each row execute function mythic.prevent_update_delete();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'tr_mythic_reputation_events_append_only') then
    create trigger tr_mythic_reputation_events_append_only
    before update or delete on mythic.reputation_events
    for each row execute function mythic.prevent_update_delete();
  end if;
end $$;

-- -----------------------------
-- Legendary+ invariants (loot consequences)
-- -----------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'items_legendary_requires_drawback_worldreaction'
  ) then
    alter table mythic.items
      add constraint items_legendary_requires_drawback_worldreaction
      check (
        rarity in ('common','magical','unique')
        or (
          jsonb_typeof(drawback_json) = 'object'
          and drawback_json <> '{}'::jsonb
          and (effects_json ? 'world_reaction')
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'items_mythic_requires_system_alterations'
  ) then
    alter table mythic.items
      add constraint items_mythic_requires_system_alterations
      check (
        rarity <> 'mythic'
        or (effects_json ? 'system_alterations')
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'items_unhinged_requires_danger_escalation'
  ) then
    alter table mythic.items
      add constraint items_unhinged_requires_danger_escalation
      check (
        rarity <> 'unhinged'
        or (effects_json ? 'danger_escalation')
      );
  end if;
end $$;

-- -----------------------------
-- DM input contracts for models/agents (views)
-- -----------------------------
create or replace view mythic.v_combat_state_for_dm as
select
  cs.id as combat_session_id,
  cs.campaign_id,
  cs.status,
  cs.seed,
  cs.scene_json,
  cs.current_turn_index,
  jsonb_build_object(
    'turn_order', (
      select jsonb_agg(jsonb_build_object(
        'turn_index', t.turn_index,
        'combatant_id', t.combatant_id
      ) order by t.turn_index)
      from mythic.turn_order t
      where t.combat_session_id = cs.id
    ),
    'combatants', (
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'entity_type', c.entity_type,
        'player_id', c.player_id,
        'character_id', c.character_id,
        'name', c.name,
        'x', c.x, 'y', c.y,
        'lvl', c.lvl,
        'stats', jsonb_build_object(
          'offense', c.offense, 'defense', c.defense, 'control', c.control,
          'support', c.support, 'mobility', c.mobility, 'utility', c.utility
        ),
        'weapon_power', c.weapon_power,
        'armor_power', c.armor_power,
        'hp', c.hp, 'hp_max', c.hp_max,
        'power', c.power, 'power_max', c.power_max,
        'armor', c.armor,
        'resist', c.resist,
        'statuses', c.statuses,
        'initiative', c.initiative,
        'is_alive', c.is_alive
      ) order by c.initiative desc, c.name asc)
      from mythic.combatants c
      where c.combat_session_id = cs.id
    ),
    'recent_events', (
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'turn_index', e.turn_index,
        'event_type', e.event_type,
        'payload', e.payload,
        'created_at', e.created_at
      ) order by e.created_at desc)
      from mythic.action_events e
      where e.combat_session_id = cs.id
      limit 50
    )
  ) as dm_payload
from mythic.combat_sessions cs;

