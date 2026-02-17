-- Mythic ready-play sync: DM character view contract + canonical world profile table.
-- Forward-only, idempotent.

create schema if not exists mythic;

create table if not exists mythic.world_profiles (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  seed_title text not null,
  seed_description text not null,
  template_key text not null default 'custom',
  world_profile_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    template_key in (
      'custom',
      'graphic_novel_fantasy',
      'sci_fi_ruins',
      'post_apoc_warlands',
      'gothic_horror',
      'mythic_chaos',
      'dark_mythic_horror',
      'post_apocalypse'
    )
  ),
  check (jsonb_typeof(world_profile_json) = 'object')
);

create index if not exists idx_mythic_world_profiles_template
  on mythic.world_profiles(template_key);

create index if not exists idx_mythic_world_profiles_updated
  on mythic.world_profiles(updated_at);

do $$
begin
  if to_regclass('mythic.campaign_world_profiles') is not null then
    insert into mythic.world_profiles (
      campaign_id,
      seed_title,
      seed_description,
      template_key,
      world_profile_json,
      created_at,
      updated_at
    )
    select
      cwp.campaign_id,
      cwp.seed_title,
      cwp.seed_description,
      cwp.template_key,
      cwp.world_profile_json,
      cwp.created_at,
      cwp.updated_at
    from mythic.campaign_world_profiles cwp
    on conflict (campaign_id) do update
    set
      seed_title = excluded.seed_title,
      seed_description = excluded.seed_description,
      template_key = excluded.template_key,
      world_profile_json = excluded.world_profile_json,
      updated_at = greatest(mythic.world_profiles.updated_at, excluded.updated_at);
  end if;
end $$;

-- Keep compatibility for older readers still using campaign_world_profiles.
do $$
begin
  if to_regclass('mythic.campaign_world_profiles') is not null then
    insert into mythic.campaign_world_profiles (
      campaign_id,
      seed_title,
      seed_description,
      template_key,
      world_profile_json,
      created_at,
      updated_at
    )
    select
      wp.campaign_id,
      wp.seed_title,
      wp.seed_description,
      wp.template_key,
      wp.world_profile_json,
      wp.created_at,
      wp.updated_at
    from mythic.world_profiles wp
    on conflict (campaign_id) do update
    set
      seed_title = excluded.seed_title,
      seed_description = excluded.seed_description,
      template_key = excluded.template_key,
      world_profile_json = excluded.world_profile_json,
      updated_at = greatest(mythic.campaign_world_profiles.updated_at, excluded.updated_at);
  end if;
end $$;

drop view if exists mythic.v_character_state_for_dm;

create view mythic.v_character_state_for_dm as
select
  c.id as character_id,
  c.campaign_id,
  c.player_id,
  c.name,
  c.level,
  c.updated_at,
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

grant usage on schema mythic to anon, authenticated, service_role;
grant select on mythic.v_character_state_for_dm to anon, authenticated, service_role;
