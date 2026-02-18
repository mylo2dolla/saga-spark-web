-- Grant access to mythic schema for client roles.
-- No RLS changes; just schema/table/function grants.

grant usage on schema mythic to anon, authenticated;

grant select on all tables in schema mythic to anon, authenticated;
grant insert, update, delete on all tables in schema mythic to authenticated;

grant usage, select on all sequences in schema mythic to authenticated;

grant execute on all functions in schema mythic to anon, authenticated;

-- Ensure future objects keep the same grants.
alter default privileges in schema mythic grant select on tables to anon, authenticated;
alter default privileges in schema mythic grant insert, update, delete on tables to authenticated;
alter default privileges in schema mythic grant usage, select on sequences to authenticated;
alter default privileges in schema mythic grant execute on functions to anon, authenticated;

