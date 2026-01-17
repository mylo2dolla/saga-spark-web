# Saga Spark

Saga Spark is a fantasy RPG companion web app built with Vite, React, and Supabase functions.

## Local development

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

## Supabase bootstrap (new project)

1) Update `.env` with the new project URL and anon key (`VITE_SUPABASE_ANON_KEY`).
2) Run `scripts/bootstrap-supabase.sh` to apply migrations to the remote project (or paste `supabase/bootstrap.sql` into the SQL editor).
3) Supabase Dashboard auth settings (dev-friendly):
   - Authentication → Providers → Email → set “Confirm email” to OFF.
   - Authentication → Providers → Email → set “Allowed email domains” to empty (no restrictions).
4) Supabase Dashboard SQL editor: SQL Editor → New query → paste `supabase/bootstrap.sql` → Run.
5) Deploy edge functions: `supabase functions deploy world-generator` and `supabase functions deploy world-content-writer`.

## Build

```bash
npm run build
```

## RLS smoke test (optional)

In the Supabase SQL editor, run `supabase/smoke-test.sql` after replacing `__USER_UUID__` with your user id.
