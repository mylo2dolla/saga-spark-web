-- Mythic Ready-to-Play core expansion
-- Adds progression/loadouts/loot/boss runtime + status tick + expanded contracts.
-- Idempotent and forward-only.

create schema if not exists mythic;

-- ------------------------------------------------------------
-- Characters progression columns
-- ------------------------------------------------------------
alter table mythic.characters
  add column if not exists xp int not null default 0,
  add column if not exists xp_to_next int not null default 300,
  add column if not exists unspent_points int not null default 0,
  add column if not exists progression_json jsonb not null default '{}'::jsonb,
  add column if not exists last_level_up_at timestamptz;

alter table mythic.characters
  drop constraint if exists characters_xp_nonnegative,
  add constraint characters_xp_nonnegative check (xp >= 0);

alter table mythic.characters
  drop constraint if exists characters_xp_to_next_nonnegative,
  add constraint characters_xp_to_next_nonnegative check (xp_to_next >= 0);

alter table mythic.characters
  drop constraint if exists characters_unspent_points_nonnegative,
  add constraint characters_unspent_points_nonnegative check (unspent_points >= 0);

-- ------------------------------------------------------------
-- Items progression columns
-- ------------------------------------------------------------
alter table mythic.items
  add column if not exists required_level int not null default 1,
  add column if not exists item_power numeric not null default 0,
  add column if not exists set_tag text,
  add column if not exists drop_tier text not null default 'common',
  add column if not exists bind_policy text not null default 'unbound';

alter table mythic.items
  drop constraint if exists items_required_level_bounds,
  add constraint items_required_level_bounds check (required_level between 1 and 99);

alter table mythic.items
  drop constraint if exists items_drop_tier_contract,
  add constraint items_drop_tier_contract check (drop_tier in ('common','elite','boss','mythic','event'));

alter table mythic.items
  drop constraint if exists items_bind_policy_contract,
  add constraint items_bind_policy_contract check (bind_policy in ('unbound','bind_on_equip','bind_on_pickup','character_bound'));

-- ------------------------------------------------------------
-- Progression + loadouts
-- ------------------------------------------------------------
create table if not exists mythic.loadout_slot_rules (
  level_required int primary key,
  slots int not null,
  created_at timestamptz not null default now(),
  check (level_required between 1 and 99),
  check (slots between 1 and 20)
);

insert into mythic.loadout_slot_rules (level_required, slots)
values
  (1,2),
  (5,3),
  (10,4),
  (20,5),
  (35,6),
  (50,7),
  (70,8),
  (90,9)
on conflict (level_required) do update
set slots = excluded.slots;

create table if not exists mythic.character_loadouts (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references mythic.characters(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  is_active boolean not null default false,
  slots_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (character_id, name),
  check (jsonb_typeof(slots_json) = 'array')
);

create index if not exists idx_mythic_character_loadouts_character on mythic.character_loadouts(character_id, is_active);
create index if not exists idx_mythic_character_loadouts_campaign on mythic.character_loadouts(campaign_id);

create table if not exists mythic.progression_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  character_id uuid not null references mythic.characters(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (event_type in ('xp_applied','level_up','points_spent','loadout_changed','gear_progression'))
);

create index if not exists idx_mythic_progression_events_character on mythic.progression_events(character_id, created_at);
create index if not exists idx_mythic_progression_events_campaign on mythic.progression_events(campaign_id, created_at);

-- ------------------------------------------------------------
-- World profile + loot + bosses
-- ------------------------------------------------------------
create table if not exists mythic.campaign_world_profiles (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  seed_title text not null,
  seed_description text not null,
  template_key text not null default 'custom',
  world_profile_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (template_key in ('custom','graphic_novel_fantasy','sci_fi_ruins','dark_mythic_horror','post_apocalypse')),
  check (jsonb_typeof(world_profile_json) = 'object')
);

create table if not exists mythic.loot_drops (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  combat_session_id uuid references mythic.combat_sessions(id) on delete set null,
  source text not null default 'combat',
  rarity mythic.rarity not null,
  budget_points int not null default 0,
  item_ids uuid[] not null default '{}'::uuid[],
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (budget_points >= 0),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_mythic_loot_drops_campaign on mythic.loot_drops(campaign_id, created_at);
create index if not exists idx_mythic_loot_drops_combat on mythic.loot_drops(combat_session_id, created_at);

create table if not exists mythic.boss_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  rarity mythic.rarity not null default 'legendary',
  base_stats jsonb not null default '{}'::jsonb,
  phases_json jsonb not null default '[]'::jsonb,
  skill_refs jsonb not null default '[]'::jsonb,
  reward_rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(base_stats) = 'object'),
  check (jsonb_typeof(phases_json) = 'array'),
  check (jsonb_typeof(skill_refs) = 'array'),
  check (jsonb_typeof(reward_rules) = 'object')
);

create table if not exists mythic.boss_instances (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  combat_session_id uuid not null references mythic.combat_sessions(id) on delete cascade,
  boss_template_id uuid references mythic.boss_templates(id) on delete set null,
  combatant_id uuid not null references mythic.combatants(id) on delete cascade,
  current_phase int not null default 1,
  enrage_turn int,
  phase_state jsonb not null default '{}'::jsonb,
  is_defeated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (combat_session_id, combatant_id),
  check (current_phase >= 1),
  check (jsonb_typeof(phase_state) = 'object')
);

create index if not exists idx_mythic_boss_instances_session on mythic.boss_instances(combat_session_id, is_defeated);
create index if not exists idx_mythic_boss_instances_campaign on mythic.boss_instances(campaign_id, created_at);

-- ------------------------------------------------------------
-- Expanded action event contract
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
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

-- Append-only triggers for new append-only tables.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tr_mythic_progression_events_append_only') then
    create trigger tr_mythic_progression_events_append_only
    before update or delete on mythic.progression_events
    for each row execute function mythic.prevent_update_delete();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'tr_mythic_loot_drops_append_only') then
    create trigger tr_mythic_loot_drops_append_only
    before update or delete on mythic.loot_drops
    for each row execute function mythic.prevent_update_delete();
  end if;
end $$;

-- ------------------------------------------------------------
-- Helper functions
-- ------------------------------------------------------------
create or replace function mythic.xp_to_next_level(lvl int)
returns int
language plpgsql
immutable
as $$
declare
  cl int := greatest(1, least(99, coalesce(lvl, 1)));
  p_now numeric;
  p_next numeric;
  raw numeric;
begin
  if cl >= 99 then
    return 0;
  end if;

  p_now := mythic.power_at_level(cl);
  p_next := mythic.power_at_level(cl + 1);
  raw := 120 + ((p_next - p_now) / 250.0);

  return greatest(100, least(500000, floor(raw)::int));
end;
$$;

create or replace function mythic.loadout_slots_for_level(lvl int)
returns int
language sql
stable
as $$
  select coalesce(
    (
      select max(slots)
      from mythic.loadout_slot_rules
      where level_required <= greatest(1, least(99, coalesce(lvl, 1)))
    ),
    2
  );
$$;

create or replace function mythic.apply_xp(
  p_character_id uuid,
  p_amount int,
  p_reason text default 'combat',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
as $$
declare
  c mythic.characters%rowtype;
  gained int := greatest(0, coalesce(p_amount, 0));
  new_xp int;
  next_cap int;
  levels_gained int := 0;
  role_text text;
  off_delta int := 0;
  def_delta int := 0;
  ctl_delta int := 0;
  sup_delta int := 0;
  mob_delta int := 0;
  uti_delta int := 0;
  points_gain int := 0;
begin
  select * into c
  from mythic.characters
  where id = p_character_id
  for update;

  if not found then
    raise exception 'character not found: %', p_character_id;
  end if;

  if gained <= 0 then
    return jsonb_build_object(
      'character_id', c.id,
      'campaign_id', c.campaign_id,
      'level', c.level,
      'xp', c.xp,
      'xp_to_next', c.xp_to_next,
      'levels_gained', 0,
      'points_gained', 0
    );
  end if;

  next_cap := coalesce(nullif(c.xp_to_next, 0), mythic.xp_to_next_level(c.level));
  if next_cap <= 0 then
    next_cap := mythic.xp_to_next_level(c.level);
  end if;

  new_xp := c.xp + gained;

  while c.level < 99 and new_xp >= next_cap loop
    new_xp := new_xp - next_cap;
    c.level := c.level + 1;
    levels_gained := levels_gained + 1;
    points_gain := points_gain + 2;

    role_text := lower(coalesce(c.class_json->>'role', 'hybrid'));

    if role_text = 'tank' then
      def_delta := def_delta + 2;
      sup_delta := sup_delta + 1;
    elsif role_text = 'dps' then
      off_delta := off_delta + 2;
      mob_delta := mob_delta + 1;
    elsif role_text = 'support' then
      sup_delta := sup_delta + 2;
      uti_delta := uti_delta + 1;
    elsif role_text = 'controller' then
      ctl_delta := ctl_delta + 2;
      uti_delta := uti_delta + 1;
    elsif role_text = 'skirmisher' then
      mob_delta := mob_delta + 2;
      off_delta := off_delta + 1;
    else
      off_delta := off_delta + 1;
      def_delta := def_delta + 1;
      ctl_delta := ctl_delta + 1;
      sup_delta := sup_delta + 1;
      mob_delta := mob_delta + 1;
      uti_delta := uti_delta + 1;
    end if;

    next_cap := mythic.xp_to_next_level(c.level);
    if next_cap = 0 then
      new_xp := 0;
      exit;
    end if;
  end loop;

  update mythic.characters
  set
    level = c.level,
    xp = new_xp,
    xp_to_next = mythic.xp_to_next_level(c.level),
    unspent_points = unspent_points + points_gain,
    offense = least(100, offense + off_delta),
    defense = least(100, defense + def_delta),
    control = least(100, control + ctl_delta),
    support = least(100, support + sup_delta),
    mobility = least(100, mobility + mob_delta),
    utility = least(100, utility + uti_delta),
    progression_json = coalesce(progression_json, '{}'::jsonb)
      || jsonb_build_object(
        'last_xp_reason', coalesce(p_reason, 'combat'),
        'last_xp_gain', gained,
        'last_levels_gained', levels_gained,
        'last_points_gained', points_gain,
        'last_metadata', coalesce(p_metadata, '{}'::jsonb),
        'last_applied_at', now()
      ),
    last_level_up_at = case when levels_gained > 0 then now() else last_level_up_at end,
    updated_at = now()
  where id = c.id;

  insert into mythic.progression_events (campaign_id, character_id, event_type, payload)
  values (
    c.campaign_id,
    c.id,
    'xp_applied',
    jsonb_build_object(
      'reason', coalesce(p_reason, 'combat'),
      'xp_gain', gained,
      'levels_gained', levels_gained,
      'points_gained', points_gain,
      'level_after', c.level,
      'xp_after', new_xp,
      'xp_to_next_after', mythic.xp_to_next_level(c.level),
      'metadata', coalesce(p_metadata, '{}'::jsonb)
    )
  );

  if levels_gained > 0 then
    insert into mythic.progression_events (campaign_id, character_id, event_type, payload)
    values (
      c.campaign_id,
      c.id,
      'level_up',
      jsonb_build_object(
        'levels_gained', levels_gained,
        'points_gained', points_gain,
        'stat_deltas', jsonb_build_object(
          'offense', off_delta,
          'defense', def_delta,
          'control', ctl_delta,
          'support', sup_delta,
          'mobility', mob_delta,
          'utility', uti_delta
        ),
        'level_after', c.level
      )
    );
  end if;

  return jsonb_build_object(
    'character_id', c.id,
    'campaign_id', c.campaign_id,
    'level', c.level,
    'xp', new_xp,
    'xp_to_next', mythic.xp_to_next_level(c.level),
    'levels_gained', levels_gained,
    'points_gained', points_gain,
    'stat_deltas', jsonb_build_object(
      'offense', off_delta,
      'defense', def_delta,
      'control', ctl_delta,
      'support', sup_delta,
      'mobility', mob_delta,
      'utility', uti_delta
    )
  );
end;
$$;

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
  alive_after boolean;
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
  alive_after := case when next_hp > 0 then true else false end;

  update mythic.combatants
  set hp = next_hp,
      is_alive = case when is_alive and alive_after then true when not alive_after then false else is_alive end,
      statuses = next_statuses,
      updated_at = now()
  where id = c.id
    and combat_session_id = c.combat_session_id;

  if dot_damage > 0 or hot_heal > 0 then
    payload := jsonb_build_object(
      'target_combatant_id', c.id,
      'phase', p_phase,
      'dot_damage', dot_damage,
      'hot_heal', hot_heal,
      'hp_after', next_hp
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

  return jsonb_build_object(
    'combatant_id', c.id,
    'phase', p_phase,
    'hp_after', next_hp,
    'is_alive', alive_after,
    'dot_damage', dot_damage,
    'hot_heal', hot_heal,
    'expired_count', jsonb_array_length(expired)
  );
end;
$$;

-- ------------------------------------------------------------
-- Seed a default boss template and loadout for existing mythic characters.
-- ------------------------------------------------------------
insert into mythic.boss_templates (slug, name, rarity, base_stats, phases_json, skill_refs, reward_rules)
values (
  'steel-widow-prime',
  'Steel Widow Prime',
  'mythic',
  '{"lvl":12,"offense":72,"defense":66,"control":58,"support":44,"mobility":52,"utility":63,"hp_max":620,"power_max":180,"weapon_power":24,"armor_power":18}'::jsonb,
  '[
    {"phase":1,"hp_below_pct":1.0,"tags":["pressure"],"skill_pool":["boss_strike","boss_mark"],"summon_waves":0},
    {"phase":2,"hp_below_pct":0.65,"tags":["aggressive"],"skill_pool":["boss_cleave","boss_vuln"],"summon_waves":1},
    {"phase":3,"hp_below_pct":0.30,"tags":["enrage"],"skill_pool":["boss_execute","boss_cleave"],"summon_waves":2}
  ]'::jsonb,
  '["boss_strike","boss_mark","boss_cleave","boss_vuln","boss_execute"]'::jsonb,
  '{"xp":1200,"rarity_floor":"legendary","drops":3}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    rarity = excluded.rarity,
    base_stats = excluded.base_stats,
    phases_json = excluded.phases_json,
    skill_refs = excluded.skill_refs,
    reward_rules = excluded.reward_rules,
    updated_at = now();

insert into mythic.character_loadouts (character_id, campaign_id, name, is_active, slots_json)
select c.id, c.campaign_id, 'Default', true,
       coalesce(
         (
           select jsonb_agg(src.id order by src.created_at)
           from (
             select s.id, s.created_at
             from mythic.skills s
             where s.character_id = c.id
               and s.kind in ('active','ultimate')
             order by s.created_at
             limit 2
           ) as src
         ),
         '[]'::jsonb
       )
from mythic.characters c
where not exists (
  select 1 from mythic.character_loadouts l where l.character_id = c.id
);

-- ------------------------------------------------------------
-- Update canonical rules with progression and loot roll policy.
-- ------------------------------------------------------------
update mythic.game_rules
set
  version = greatest(version, 4),
  rules = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(rules, '{}'::jsonb),
        '{progression}',
        jsonb_build_object(
          'xp_to_next_function', 'mythic.xp_to_next_level(lvl)',
          'apply_xp_function', 'mythic.apply_xp(character_id, amount, reason, metadata)',
          'slot_rules_table', 'mythic.loadout_slot_rules',
          'loadout_table', 'mythic.character_loadouts',
          'unspent_points_field', 'mythic.characters.unspent_points'
        ),
        true
      ),
      '{loot_rolls}',
      jsonb_build_object(
        'generator_edge_function', 'mythic-generate-loot',
        'drop_table', 'mythic.loot_drops',
        'item_fields', jsonb_build_array('required_level','item_power','set_tag','drop_tier','bind_policy'),
        'rarity_budgets', jsonb_build_object(
          'common', 8,
          'magical', 16,
          'unique', 24,
          'legendary', 40,
          'mythic', 60,
          'unhinged', 70
        )
      ),
      true
    ),
    '{boss_runtime}',
    jsonb_build_object(
      'boss_templates_table', 'mythic.boss_templates',
      'boss_instances_table', 'mythic.boss_instances',
      'phase_transition_event', 'phase_shift',
      'status_tick_function', 'mythic.resolve_status_tick(combat_session_id, combatant_id, turn_index, phase)'
    ),
    true
  ),
  updated_at = now()
where name = 'mythic-weave-rules-v1';
