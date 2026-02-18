create schema if not exists mythic;

-- Ensure runtime roles can access mythic schema while RLS remains off.
grant usage on schema mythic to anon, authenticated, service_role;
grant all on all tables in schema mythic to anon, authenticated, service_role;
grant all on all sequences in schema mythic to anon, authenticated, service_role;

alter default privileges in schema mythic
  grant all on tables to anon, authenticated, service_role;

alter default privileges in schema mythic
  grant all on sequences to anon, authenticated, service_role;
