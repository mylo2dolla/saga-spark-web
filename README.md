# Saga Spark

Saga Spark is a fantasy RPG companion web app built with Vite, React, and Supabase functions.

## Local development

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

## Supabase bootstrap (new project)

1) Update `.env` with the new project URL and publishable key.
2) Run `scripts/bootstrap-supabase.sh` to apply migrations to the remote project.
3) In Supabase Dashboard: Authentication → Providers → Email → set “Confirm email” to OFF for local dev.
4) Deploy edge functions: `supabase functions deploy world-generator` and `supabase functions deploy world-content-writer`.

## Build

```bash
npm run build
```
