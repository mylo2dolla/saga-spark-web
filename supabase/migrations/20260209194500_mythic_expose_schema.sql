-- Expose mythic schema to PostgREST so clients can read/write via supabase-js.
-- Idempotent: ALTER ROLE ... SET is safe to repeat.

alter role authenticator set pgrst.db_schemas = 'public,graphql_public,mythic';

-- Reload PostgREST schema cache (best-effort).
select pg_notify('pgrst', 'reload schema');

