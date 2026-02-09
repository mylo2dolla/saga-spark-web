-- Mythic Weave Core: DM payload views/helpers
-- Idempotent by CREATE OR REPLACE.

create schema if not exists mythic;

-- Reputation tier helper (pure function; thresholds are canonical and mirrored in rules JSON).
create or replace function mythic.rep_tier(rep int)
returns text
language plpgsql
immutable
as $$
declare
  r int := coalesce(rep, 0);
begin
  if r >= 600 then return 'ally'; end if;
  if r >= 250 then return 'friendly'; end if;
  if r <= -600 then return 'hunted'; end if;
  if r <= -250 then return 'hostile'; end if;
  return 'neutral';
end;
$$;

-- A single character payload for the AI DM: stats, derived, skills, inventory, equipment.
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

