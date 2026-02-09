create table if not exists public.dm_state (
  campaign_id text primary key,
  state_json jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists dm_state_updated_at_idx on public.dm_state (updated_at);
