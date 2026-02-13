-- Fix ambiguous character_id references in derived-stat stack for DM payload view.
-- Idempotent forward migration.

create schema if not exists mythic;

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
    where inv.character_id = $1
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
  select * into c from mythic.characters where id = $1;
  if not found then
    return '{}'::jsonb;
  end if;

  eq := mythic.compute_equipment_mods($1);
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

create or replace view mythic.v_character_state_for_dm as
select
  c.id as character_id,
  c.campaign_id,
  c.player_id,
  c.name,
  c.level,
  jsonb_build_object(
    'offense', c.offense,
    'defense', c.defense,
    'control', c.control,
    'support', c.support,
    'mobility', c.mobility,
    'utility', c.utility
  ) as base_stats,
  c.class_json,
  c.resources,
  mythic.compute_character_derived(c.id) as derived_json,
  (
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'kind', s.kind,
      'targeting', s.targeting,
      'targeting_json', s.targeting_json,
      'name', s.name,
      'description', s.description,
      'range_tiles', s.range_tiles,
      'cooldown_turns', s.cooldown_turns,
      'cost_json', s.cost_json,
      'effects_json', s.effects_json,
      'scaling_json', s.scaling_json,
      'counterplay', s.counterplay,
      'narration_style', s.narration_style
    ) order by s.kind, s.created_at)
    from mythic.skills s
    where s.character_id = c.id
  ) as skills,
  (
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'rarity', i.rarity,
      'item_type', i.item_type,
      'slot', i.slot,
      'weapon_family', i.weapon_family,
      'weapon_profile', i.weapon_profile,
      'affixes', i.affixes,
      'stat_mods', i.stat_mods,
      'effects_json', i.effects_json,
      'drawback_json', i.drawback_json,
      'narrative_hook', i.narrative_hook,
      'durability_json', i.durability_json,
      'container', inv.container,
      'equip_slot', inv.equip_slot,
      'quantity', inv.quantity
    ) order by inv.container, inv.equipped_at nulls last, inv.created_at)
    from mythic.inventory inv
    join mythic.items i on i.id = inv.item_id
    where inv.character_id = c.id
  ) as items
from mythic.characters c;
