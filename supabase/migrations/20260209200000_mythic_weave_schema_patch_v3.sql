-- Mythic Weave Core: schema patch v3 (policy + targeting_json + view refresh)
-- Idempotent by design: CREATE IF NOT EXISTS / CREATE OR REPLACE, additive constraints only.

create schema if not exists mythic;

-- -------------------------------------------------------------------
-- Content policy enforcement helpers
-- Violence/gore allowed. Sexual content/sexual violence forbidden.
-- Harsh language allowed (do NOT ban profanity here).
-- -------------------------------------------------------------------
create or replace function mythic.contains_forbidden_sexual_content(txt text)
returns boolean
language sql
immutable
as $$
  select coalesce(txt, '') ~* '(
    \\bsex\\b|
    \\bsexual\\b|
    \\bsexual\\s+violence\\b|
    \\brape\\b|\\braped\\b|\\braping\\b|
    \\bmolest\\b|\\bmolested\\b|\\bmolester\\b|
    \\bporn\\b|\\bpornography\\b|
    \\berotic\\b|
    \\bnude\\b|\\bnudity\\b|
    \\bincest\\b|
    \\bunderage\\b|
    \\bchild\\s*porn\\b|
    \\bminor\\s*porn\\b|
    \\bblowjob\\b|\\bhandjob\\b|
    \\bintercourse\\b|
    \\bgenitals\\b|
    \\bvagina\\b|
    \\bpenis\\b|
    \\bclitoris\\b|
    \\btesticles\\b|
    \\borgasm\\b|
    \\bpenetrat(e|es|ed|ing)\\b
  )';
$$;

create or replace function mythic.content_is_allowed(txt text)
returns boolean
language sql
immutable
as $$
  select not mythic.contains_forbidden_sexual_content(txt);
$$;

-- -------------------------------------------------------------------
-- Skills: add targeting_json (explicit contract required by canonical spec)
-- -------------------------------------------------------------------
alter table mythic.skills
  add column if not exists targeting_json jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'skills_json_shape_contract_v2') then
    alter table mythic.skills
      add constraint skills_json_shape_contract_v2
      check (
        jsonb_typeof(cost_json) = 'object'
        and jsonb_typeof(effects_json) = 'object'
        and jsonb_typeof(scaling_json) = 'object'
        and jsonb_typeof(counterplay) = 'object'
        and jsonb_typeof(targeting_json) = 'object'
      );
  end if;
end $$;

-- -------------------------------------------------------------------
-- DM/UI payload views (ensure they exist and are canonical)
-- -------------------------------------------------------------------
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

create or replace view mythic.v_board_state_for_dm as
select
  b.campaign_id,
  b.id as board_id,
  b.board_type,
  b.status,
  b.state_json,
  b.ui_hints_json,
  b.active_scene_id,
  b.combat_session_id,
  b.updated_at,
  (
    select jsonb_agg(jsonb_build_object(
      'id', t.id,
      'from_board_type', t.from_board_type,
      'to_board_type', t.to_board_type,
      'reason', t.reason,
      'animation', t.animation,
      'payload_json', t.payload_json,
      'created_at', t.created_at
    ) order by t.created_at desc)
    from mythic.board_transitions t
    where t.campaign_id = b.campaign_id
    limit 20
  ) as recent_transitions
from mythic.boards b
where b.status = 'active';

