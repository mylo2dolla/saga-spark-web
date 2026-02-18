-- Mythic Weave Core: tables + indexes (no RLS in mythic schema yet)
-- Idempotent by design: CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, DO-block guarded constraints.

create schema if not exists mythic;

-- -----------------------------
-- Types (soft-locked enumerations)
-- -----------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='mythic' and t.typname='board_type') then
    create type mythic.board_type as enum ('town','dungeon','travel','combat');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='mythic' and t.typname='rarity') then
    create type mythic.rarity as enum ('common','magical','unique','legendary','mythic','unhinged');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='mythic' and t.typname='weapon_family') then
    create type mythic.weapon_family as enum ('blades','axes','blunt','polearms','ranged','focus','body','absurd');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='mythic' and t.typname='item_slot') then
    create type mythic.item_slot as enum ('weapon','offhand','armor','helm','gloves','boots','belt','amulet','ring','trinket','consumable','material','quest','other');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='mythic' and t.typname='skill_targeting') then
    create type mythic.skill_targeting as enum ('self','single','tile','area');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='mythic' and t.typname='skill_kind') then
    create type mythic.skill_kind as enum ('active','passive','ultimate','crafting','life');
  end if;
end $$;

-- -----------------------------
-- Canonical scripts + rules (authoritative)
-- -----------------------------
create table if not exists mythic.generator_scripts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version int not null default 1,
  is_active boolean not null default true,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_mythic_generator_scripts_name on mythic.generator_scripts(name);

create table if not exists mythic.game_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version int not null default 1,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_mythic_game_rules_name on mythic.game_rules(name);

create table if not exists mythic.ui_turn_flow_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version int not null default 1,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_mythic_ui_turn_flow_rules_name on mythic.ui_turn_flow_rules(name);

-- -----------------------------
-- DM Entity System
-- -----------------------------
create table if not exists mythic.dm_campaign_state (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  cruelty double precision not null default 0.55,
  honesty double precision not null default 0.55,
  playfulness double precision not null default 0.65,
  intervention double precision not null default 0.40,
  favoritism double precision not null default 0.50,
  irritation double precision not null default 0.20,
  amusement double precision not null default 0.40,
  menace double precision not null default 0.35,
  respect double precision not null default 0.25,
  boredom double precision not null default 0.20,
  updated_at timestamptz not null default now(),
  check (cruelty between 0 and 1),
  check (honesty between 0 and 1),
  check (playfulness between 0 and 1),
  check (intervention between 0 and 1),
  check (favoritism between 0 and 1),
  check (irritation between 0 and 1),
  check (amusement between 0 and 1),
  check (menace between 0 and 1),
  check (respect between 0 and 1),
  check (boredom between 0 and 1)
);

create table if not exists mythic.dm_memory_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  player_id uuid,
  category text not null,
  severity int not null default 1,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (severity between 1 and 5)
);

create table if not exists mythic.dm_player_model (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  player_id uuid not null,
  cruelty_score numeric not null default 0,
  heroism_score numeric not null default 0,
  cunning_score numeric not null default 0,
  chaos_score numeric not null default 0,
  honor_score numeric not null default 0,
  greed_score numeric not null default 0,
  boredom_signals int not null default 0,
  exploit_signals int not null default 0,
  preferred_tactics jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, player_id)
);

create table if not exists mythic.dm_world_tension (
  campaign_id uuid primary key references public.campaigns(id) on delete cascade,
  tension double precision not null default 0.15,
  doom double precision not null default 0.05,
  spectacle double precision not null default 0.25,
  updated_at timestamptz not null default now(),
  check (tension between 0 and 1),
  check (doom between 0 and 1),
  check (spectacle between 0 and 1)
);

-- -----------------------------
-- Factions + Reputation + Revenge Arcs
-- -----------------------------
create table if not exists mythic.factions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  description text,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  unique (campaign_id, name)
);

create table if not exists mythic.faction_reputation (
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  faction_id uuid not null references mythic.factions(id) on delete cascade,
  player_id uuid not null,
  rep int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (campaign_id, faction_id, player_id),
  check (rep between -1000 and 1000)
);

create table if not exists mythic.reputation_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  faction_id uuid not null references mythic.factions(id) on delete cascade,
  player_id uuid,
  severity int not null default 1,
  delta int not null,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  check (severity between 1 and 5)
);

create table if not exists mythic.revenge_arcs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  faction_id uuid not null references mythic.factions(id) on delete cascade,
  player_id uuid not null,
  nemesis_json jsonb not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  next_strike_at timestamptz
);

create table if not exists mythic.nemesis_memory (
  id uuid primary key default gen_random_uuid(),
  arc_id uuid not null references mythic.revenge_arcs(id) on delete cascade,
  observation jsonb not null,
  created_at timestamptz not null default now()
);

-- -----------------------------
-- Characters / Skills / Items / Inventory
-- -----------------------------
create table if not exists mythic.characters (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  player_id uuid,
  name text not null,
  level int not null default 1,
  offense int not null default 10,
  defense int not null default 10,
  control int not null default 10,
  support int not null default 10,
  mobility int not null default 10,
  utility int not null default 10,
  class_json jsonb not null default '{}'::jsonb,
  derived_json jsonb not null default '{}'::jsonb,
  resources jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (level between 1 and 99),
  check (offense between 0 and 100),
  check (defense between 0 and 100),
  check (control between 0 and 100),
  check (support between 0 and 100),
  check (mobility between 0 and 100),
  check (utility between 0 and 100)
);

create table if not exists mythic.skills (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  character_id uuid not null references mythic.characters(id) on delete cascade,
  kind mythic.skill_kind not null default 'active',
  targeting mythic.skill_targeting not null default 'single',
  name text not null,
  description text not null,
  -- Structured requirements:
  -- damage/healing/range/cost/cooldown are stored in typed + JSON forms for flexibility.
  range_tiles int not null default 1,
  cooldown_turns int not null default 0,
  cost_json jsonb not null default '{}'::jsonb,
  effects_json jsonb not null default '{}'::jsonb,
  scaling_json jsonb not null default '{}'::jsonb,
  counterplay jsonb not null default '{}'::jsonb,
  narration_style text not null default 'comic-brutal',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (range_tiles between 0 and 999),
  check (cooldown_turns between 0 and 999)
);

create table if not exists mythic.items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  owner_character_id uuid references mythic.characters(id) on delete set null,
  rarity mythic.rarity not null default 'common',
  item_type text not null default 'gear',
  slot mythic.item_slot not null default 'other',
  weapon_family mythic.weapon_family,
  weapon_profile jsonb not null default '{}'::jsonb,
  affixes jsonb not null default '[]'::jsonb,
  stat_mods jsonb not null default '{}'::jsonb,
  effects_json jsonb not null default '{}'::jsonb,
  drawback_json jsonb not null default '{}'::jsonb,
  narrative_hook text,
  durability_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mythic.inventory (
  id uuid primary key default gen_random_uuid(),
  character_id uuid not null references mythic.characters(id) on delete cascade,
  item_id uuid not null references mythic.items(id) on delete cascade,
  container text not null, -- backpack | equipment
  equip_slot text,         -- free-form; rings/trinkets unlimited by design
  quantity int not null default 1,
  equipped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (container in ('backpack','equipment')),
  check (quantity >= 1)
);

-- -----------------------------
-- Combat System (append-only playback contract)
-- -----------------------------
create table if not exists mythic.combat_sessions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  seed int not null default 0,
  status text not null default 'active',
  scene_json jsonb not null default '{}'::jsonb,
  dm_state jsonb not null default '{}'::jsonb,
  current_turn_index int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_turn_index >= 0)
);

create table if not exists mythic.combatants (
  id uuid primary key default gen_random_uuid(),
  combat_session_id uuid not null references mythic.combat_sessions(id) on delete cascade,
  entity_type text not null, -- player | npc | summon
  player_id uuid,
  character_id uuid references mythic.characters(id) on delete set null,
  name text not null,
  x int not null default 0,
  y int not null default 0,
  lvl int not null default 1,
  offense int not null default 10,
  defense int not null default 10,
  control int not null default 10,
  support int not null default 10,
  mobility int not null default 10,
  utility int not null default 10,
  weapon_power numeric not null default 0,
  armor_power numeric not null default 0,
  hp numeric not null default 100,
  hp_max numeric not null default 100,
  power numeric not null default 50,
  power_max numeric not null default 50,
  armor numeric not null default 0,
  resist numeric not null default 0,
  statuses jsonb not null default '[]'::jsonb,
  initiative int not null default 0,
  is_alive boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (entity_type in ('player','npc','summon')),
  check (lvl between 1 and 99),
  check (offense between 0 and 100),
  check (defense between 0 and 100),
  check (control between 0 and 100),
  check (support between 0 and 100),
  check (mobility between 0 and 100),
  check (utility between 0 and 100)
);

create table if not exists mythic.turn_order (
  combat_session_id uuid not null references mythic.combat_sessions(id) on delete cascade,
  turn_index int not null,
  combatant_id uuid not null references mythic.combatants(id) on delete cascade,
  primary key (combat_session_id, turn_index),
  check (turn_index >= 0)
);

create table if not exists mythic.action_events (
  id uuid primary key default gen_random_uuid(),
  combat_session_id uuid not null references mythic.combat_sessions(id) on delete cascade,
  turn_index int not null default 0,
  actor_combatant_id uuid references mythic.combatants(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (turn_index >= 0)
);

-- -----------------------------
-- Board System (Town/Dungeon/Travel/Combat) + transitions
-- -----------------------------
create table if not exists mythic.boards (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  board_type mythic.board_type not null,
  status text not null default 'active',
  state_json jsonb not null default '{}'::jsonb,
  ui_hints_json jsonb not null default '{}'::jsonb,
  active_scene_id uuid,
  combat_session_id uuid references mythic.combat_sessions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('active','archived','paused'))
);

create table if not exists mythic.board_transitions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  from_board_type mythic.board_type,
  to_board_type mythic.board_type not null,
  reason text not null,
  animation text not null default 'page_turn',
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------
-- Indexes (performance)
-- -----------------------------
create index if not exists idx_campaigns_created_at on public.campaigns(created_at);

create index if not exists idx_mythic_factions_campaign_id on mythic.factions(campaign_id);
create index if not exists idx_mythic_faction_rep on mythic.faction_reputation(campaign_id, faction_id, player_id);
create index if not exists idx_mythic_rep_events on mythic.reputation_events(campaign_id, faction_id, player_id, occurred_at);
create index if not exists idx_mythic_dm_memory on mythic.dm_memory_events(campaign_id, player_id, created_at);
create index if not exists idx_mythic_dm_player_model on mythic.dm_player_model(campaign_id, player_id);
create index if not exists idx_mythic_boards on mythic.boards(campaign_id, board_type, status);
create index if not exists idx_mythic_board_transitions on mythic.board_transitions(campaign_id, created_at);
create index if not exists idx_mythic_characters on mythic.characters(campaign_id, player_id);
create index if not exists idx_mythic_skills on mythic.skills(campaign_id, character_id);
create index if not exists idx_mythic_items on mythic.items(campaign_id, owner_character_id);
create index if not exists idx_mythic_inventory_character on mythic.inventory(character_id);
create index if not exists idx_mythic_combat_sessions on mythic.combat_sessions(campaign_id, status);
create index if not exists idx_mythic_combatants on mythic.combatants(combat_session_id, initiative, is_alive);
create index if not exists idx_mythic_turn_order on mythic.turn_order(combat_session_id, turn_index);
create index if not exists idx_mythic_action_events on mythic.action_events(combat_session_id, turn_index, created_at);

