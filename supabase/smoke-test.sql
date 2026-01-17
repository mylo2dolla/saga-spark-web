-- Replace __USER_UUID__ with your auth.users id before running.
select set_config('request.jwt.claim.sub', '__USER_UUID__', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

insert into public.campaigns (name, owner_id)
values ('Smoke Test Campaign', auth.uid())
returning id, owner_id;

insert into public.campaign_members (campaign_id, user_id, is_dm)
select id, auth.uid(), true
from public.campaigns
where owner_id = auth.uid()
order by created_at desc
limit 1;

select id, name, owner_id
from public.campaigns
where owner_id = auth.uid()
order by created_at desc
limit 1;
