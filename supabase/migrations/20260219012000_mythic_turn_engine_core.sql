-- Mythic turn engine core persistence.
-- Additive, idempotent migration that unblocks mythic-dungeon-master turn commits.

create schema if not exists mythic;

create table if not exists mythic.turns (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  board_id uuid not null references mythic.boards(id) on delete cascade,
  board_type text not null,
  turn_index int not null,
  turn_seed text not null,
  dm_request_json jsonb not null default '{}'::jsonb,
  dm_response_json jsonb not null default '{}'::jsonb,
  patches_json jsonb not null default '[]'::jsonb,
  roll_log_json jsonb not null default '[]'::jsonb,
  status text not null default 'committed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists turns_campaign_turn_unique on mythic.turns(campaign_id, turn_index);
create index if not exists turns_campaign_created_idx on mythic.turns(campaign_id, created_at desc);
create index if not exists turns_player_created_idx on mythic.turns(player_id, created_at desc);

create or replace function mythic.touch_turns_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_turns_updated_at on mythic.turns;
create trigger trg_turns_updated_at
before update on mythic.turns
for each row execute function mythic.touch_turns_updated_at();

create or replace function mythic.mythic_commit_turn(
  campaign_id uuid,
  player_id uuid,
  board_id uuid,
  board_type text,
  turn_seed text,
  dm_request_json jsonb,
  dm_response_json jsonb,
  patches_json jsonb,
  roll_log_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = mythic, public
as $$
declare
  expected_turn_index int;
  next_turn_index int;
  inserted_turn_id uuid;
begin
  expected_turn_index := nullif(dm_request_json->>'expected_turn_index', '')::int;

  select coalesce(max(t.turn_index), -1) + 1
    into next_turn_index
    from mythic.turns t
   where t.campaign_id = mythic_commit_turn.campaign_id;

  if expected_turn_index is not null and expected_turn_index <> next_turn_index then
    raise exception 'expected_turn_index_mismatch expected=% got=%', expected_turn_index, next_turn_index
      using errcode = '40001';
  end if;

  insert into mythic.turns (
    campaign_id,
    player_id,
    board_id,
    board_type,
    turn_index,
    turn_seed,
    dm_request_json,
    dm_response_json,
    patches_json,
    roll_log_json,
    status
  ) values (
    mythic_commit_turn.campaign_id,
    mythic_commit_turn.player_id,
    mythic_commit_turn.board_id,
    coalesce(nullif(mythic_commit_turn.board_type, ''), 'town'),
    next_turn_index,
    coalesce(nullif(mythic_commit_turn.turn_seed, ''), md5(random()::text)),
    coalesce(mythic_commit_turn.dm_request_json, '{}'::jsonb),
    coalesce(mythic_commit_turn.dm_response_json, '{}'::jsonb),
    coalesce(mythic_commit_turn.patches_json, '[]'::jsonb),
    coalesce(mythic_commit_turn.roll_log_json, '[]'::jsonb),
    'committed'
  )
  returning id into inserted_turn_id;

  return jsonb_build_object(
    'ok', true,
    'turn_id', inserted_turn_id,
    'turn_index', next_turn_index,
    'world_time', null,
    'heat', null
  );
exception
  when unique_violation then
    raise exception 'expected_turn_index_conflict:%', next_turn_index using errcode = '40001';
end;
$$;

grant execute on function mythic.mythic_commit_turn(
  uuid, uuid, uuid, text, text, jsonb, jsonb, jsonb, jsonb
) to anon, authenticated, service_role;

