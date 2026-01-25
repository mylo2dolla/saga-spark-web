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

## Supabase migrations (local + remote)

Apply migrations locally:

```bash
supabase db reset
```

Push migrations to remote:

```bash
supabase db push
```

Verification SQL (FKs, indexes, policies from `20260120000000_add_missing_fks_indexes_policies.sql`):

```sql
SELECT conname
FROM pg_constraint
WHERE conname IN ('game_saves_user_id_fkey', 'server_nodes_user_id_fkey');

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_abilities_character_id',
    'idx_campaign_members_campaign_id',
    'idx_campaign_members_user_id',
    'idx_campaigns_owner_id',
    'idx_characters_campaign_id',
    'idx_characters_user_id',
    'idx_chat_messages_campaign_id',
    'idx_chat_messages_user_id',
    'idx_combat_state_campaign_id',
    'idx_grid_state_campaign_id',
    'idx_server_nodes_campaign_id',
    'idx_server_nodes_user_id',
    'idx_game_saves_user_id'
  );

SELECT polname
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'chat_messages'
  AND polname IN (
    'Users can update their own chat messages',
    'Users can delete their own chat messages'
  );
```

## Build

```bash
npm run build
```

## Verify Groq API access

Set your API key in the environment (or a local `.env.local` file) and run the verification script:

```bash
export GROQ_API_KEY="your_api_key"
npm run verify:groq
```

## RLS smoke test (optional)

In the Supabase SQL editor, run `supabase/smoke-test.sql` after replacing `__USER_UUID__` with your user id.

## Playwright smoke test (optional)

Run once to install browsers:

```bash
npm run test:e2e:install
```

Then run the smoke test:

```bash
npm run test:e2e
```

Notes for Codespaces:
- If `playwright install --with-deps` fails due to the Yarn apt repo signature, remove `/etc/apt/sources.list.d/yarn.list` and run `sudo npx playwright install-deps`.
- Alternatively install the missing libs listed by Playwright (e.g. `libatk1.0-0t64`, `libgtk-3-0t64`) and rerun `npm run test:e2e`.

## generate-class curl checks

```bash
curl -i -X OPTIONS https://othlyxwtigxzczeffzee.supabase.co/functions/v1/generate-class
```

```bash
curl -i -X POST https://othlyxwtigxzczeffzee.supabase.co/functions/v1/generate-class \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"classDescription":"Arcane duelist"}'
```

```bash
curl -i -X POST https://othlyxwtigxzczeffzee.supabase.co/functions/v1/generate-class \
  -H "apikey: <anon-key>" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"classDescription":"Arcane duelist"}'
```

## generate-class curl (local/dev)

```bash
curl -i -X OPTIONS http://127.0.0.1:54321/functions/v1/generate-class
```

```bash
curl -i -X POST http://127.0.0.1:54321/functions/v1/generate-class \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"classDescription":"Arcane duelist"}'
```

```bash
curl -i -X POST http://127.0.0.1:54321/functions/v1/generate-class \
  -H "Content-Type: application/json" \
  -d '{"classDescription":"Arcane duelist"}'
```
