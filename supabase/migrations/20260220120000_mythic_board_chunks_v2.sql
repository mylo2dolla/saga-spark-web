create schema if not exists mythic;

create table if not exists mythic.board_chunks (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  board_type mythic.board_type not null,
  coord_x int not null,
  coord_y int not null,
  biome text not null,
  seed int not null,
  state_json jsonb not null default '{}'::jsonb,
  runtime_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, board_type, coord_x, coord_y),
  check (biome in ('town', 'plains', 'forest', 'wetlands', 'desert', 'badlands', 'mountain', 'ruins', 'cavern', 'crypt', 'void')),
  check (seed > 0)
);

create index if not exists idx_mythic_board_chunks_campaign_type_coord
  on mythic.board_chunks(campaign_id, board_type, coord_x, coord_y);
create index if not exists idx_mythic_board_chunks_campaign_updated
  on mythic.board_chunks(campaign_id, updated_at desc);
create index if not exists idx_mythic_board_chunks_biome
  on mythic.board_chunks(campaign_id, biome, updated_at desc);

alter table mythic.board_chunks enable row level security;

drop policy if exists board_chunks_select_members on mythic.board_chunks;
create policy board_chunks_select_members
  on mythic.board_chunks
  for select
  using (
    auth.uid() is not null
    and (
      public.is_campaign_member(campaign_id, auth.uid())
      or public.is_campaign_owner(campaign_id, auth.uid())
    )
  );

drop policy if exists board_chunks_service_write on mythic.board_chunks;
create policy board_chunks_service_write
  on mythic.board_chunks
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function mythic.touch_board_chunks_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_board_chunks_touch_updated_at on mythic.board_chunks;
create trigger trg_board_chunks_touch_updated_at
before update on mythic.board_chunks
for each row execute procedure mythic.touch_board_chunks_updated_at();
