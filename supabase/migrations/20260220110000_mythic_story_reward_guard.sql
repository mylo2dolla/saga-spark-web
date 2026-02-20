create schema if not exists mythic;

create table if not exists mythic.turn_reward_grants (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references mythic.turns(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  character_id uuid not null references mythic.characters(id) on delete cascade,
  reward_key text not null,
  xp_amount int not null default 0,
  loot_item_id uuid references mythic.items(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (turn_id, character_id, reward_key),
  check (xp_amount >= 0),
  check (jsonb_typeof(payload) = 'object')
);

create index if not exists idx_mythic_turn_reward_grants_turn
  on mythic.turn_reward_grants(turn_id, created_at);

create index if not exists idx_mythic_turn_reward_grants_character
  on mythic.turn_reward_grants(character_id, created_at desc);

create or replace function mythic.touch_turn_reward_grants_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_turn_reward_grants_updated_at on mythic.turn_reward_grants;
create trigger trg_turn_reward_grants_updated_at
before update on mythic.turn_reward_grants
for each row execute function mythic.touch_turn_reward_grants_updated_at();

create or replace function mythic.turn_reward_guard(
  p_turn_id uuid,
  p_campaign_id uuid,
  p_character_id uuid,
  p_reward_key text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = mythic, public
as $$
declare
  inserted_id uuid;
begin
  insert into mythic.turn_reward_grants (
    turn_id,
    campaign_id,
    character_id,
    reward_key,
    payload
  )
  values (
    p_turn_id,
    p_campaign_id,
    p_character_id,
    coalesce(nullif(trim(p_reward_key), ''), 'story_reward_v1'),
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (turn_id, character_id, reward_key) do nothing
  returning id into inserted_id;

  return inserted_id;
end;
$$;

grant execute on function mythic.turn_reward_guard(uuid, uuid, uuid, text, jsonb) to service_role;
