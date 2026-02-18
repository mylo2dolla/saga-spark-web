# Supabase Edge Functions (Rollback Only)

Primary production traffic should run through the Hetzner VM Mythic API (`services/mythic-api/`) while Supabase remains Auth + Postgres.

This folder is kept for rollback/compatibility: you can still deploy Supabase Edge Functions if you need an emergency fallback, but the web client should normally point at the VM base URL (`VITE_MYTHIC_FUNCTIONS_BASE_URL`).

These functions call AI providers from the server. No AI keys are ever sent to the client.

Required secrets:

```
npx supabase secrets set GROQ_API_KEY="your_groq_key"
```

Optional base URL override (defaults to `https://api.groq.com/openai`):

```
npx supabase secrets set GROQ_BASE_URL="https://api.groq.com/openai"
```

Deploy functions after updating secrets:

```
npx supabase functions deploy generate-class
npx supabase functions deploy world-generator
npx supabase functions deploy dungeon-master
```
