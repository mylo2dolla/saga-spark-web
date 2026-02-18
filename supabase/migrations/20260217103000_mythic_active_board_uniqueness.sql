-- Campaign create/join reliability hardening:
-- enforce exactly one active board per campaign for DM/context readers.
-- Forward-only and idempotent.

create schema if not exists mythic;

do $$
begin
  if to_regclass('mythic.boards') is null then
    return;
  end if;

  with ranked as (
    select
      id,
      row_number() over (
        partition by campaign_id
        order by updated_at desc nulls last, created_at desc nulls last, id desc
      ) as rn
    from mythic.boards
    where status = 'active'
  )
  update mythic.boards b
  set
    status = 'archived',
    updated_at = now()
  from ranked r
  where b.id = r.id
    and r.rn > 1
    and b.status = 'active';
end $$;

create unique index if not exists idx_mythic_boards_one_active_per_campaign
  on mythic.boards(campaign_id)
  where status = 'active';

