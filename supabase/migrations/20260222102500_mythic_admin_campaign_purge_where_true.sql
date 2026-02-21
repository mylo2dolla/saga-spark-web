create or replace function mythic.admin_purge_campaigns(target_campaign_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = mythic, public
as $$
declare
  deleted_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  perform set_config('mythic.allow_append_delete', '1', true);

  if target_campaign_ids is null or array_length(target_campaign_ids, 1) is null then
    with deleted as (
      delete from public.campaigns
      where true
      returning 1
    )
    select count(*) into deleted_count from deleted;
  else
    with deleted as (
      delete from public.campaigns
      where id = any(target_campaign_ids)
      returning 1
    )
    select count(*) into deleted_count from deleted;
  end if;

  return deleted_count;
end;
$$;
