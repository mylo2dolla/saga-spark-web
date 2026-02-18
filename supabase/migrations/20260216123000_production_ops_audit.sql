-- Production fine-tune: operation audit spine.
-- Forward-only and idempotent.

create schema if not exists mythic;

create table if not exists mythic.operation_audit (
  id uuid primary key default gen_random_uuid(),
  operation_name text not null,
  status text not null check (status in ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED')),
  source text not null default 'app',
  campaign_id uuid null references public.campaigns(id) on delete set null,
  player_id uuid null references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  attempt int not null default 1,
  max_retries int not null default 0,
  error_code text null,
  error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_mythic_operation_audit_operation_name
  on mythic.operation_audit(operation_name);

create index if not exists idx_mythic_operation_audit_status_started
  on mythic.operation_audit(status, started_at desc);

create index if not exists idx_mythic_operation_audit_campaign
  on mythic.operation_audit(campaign_id, created_at desc);

create index if not exists idx_mythic_operation_audit_player
  on mythic.operation_audit(player_id, created_at desc);

grant usage on schema mythic to anon, authenticated, service_role;
grant select, insert on mythic.operation_audit to authenticated, service_role;
grant select on mythic.operation_audit to anon;

