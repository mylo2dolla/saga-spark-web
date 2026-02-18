# Saga Spark

Saga Spark is a fantasy RPG companion web app built with Vite, React, and Supabase functions.

## Local development

Install dependencies and start the dev server:

```bash
nvm use 20
npm install
npm run dev
```

If `nvm` is not installed, use Homebrew `node@20`:

```bash
brew install node@20
export PATH="$(brew --prefix node@20)/bin:$PATH"
```

## Vault source-of-truth sync

This repo is configured so `vault/main` is the canonical upstream.

One-command sync from vault:

```bash
scripts/vaultsync.sh
```

Sync and then mirror to GitHub `origin`:

```bash
scripts/vaultsync.sh --push-origin
```

What this script does:
- fetches/prunes all remotes
- ensures `main` tracks `vault/main`
- enforces `remote.pushDefault=vault`
- fast-forwards from vault when behind
- fails fast if local is ahead/diverged from vault (so vault stays canonical)

### Nightly auto-sync (macOS launchd)

Install nightly job (default 03:15 local time):

```bash
scripts/install-vaultsync-launchd.sh
```

Install with custom time:

```bash
VAULTSYNC_HOUR=2 VAULTSYNC_MINUTE=30 scripts/install-vaultsync-launchd.sh
```

Check status:

```bash
launchctl print "gui/$(id -u)/com.sagaspark.vaultsync" | rg "state =|last exit code =|path ="
```

Watch logs:

```bash
tail -f "$HOME/Library/Logs/saga-spark-vaultsync.log"
```

Remove job:

```bash
scripts/uninstall-vaultsync-launchd.sh
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
export SUPABASE_DB_PASSWORD="<your-db-password>"
supabase migration list
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

## Production hardening checks

Run the baseline production checks before shipping:

```bash
npm run lint
npm run typecheck
npm run build
```

Full manual checklist:
- `docs/PRODUCTION_SMOKE_TEST.md`

## Auth 522 incident runbook

If login/campaign create fails with `auth_gateway_timeout` or `Supabase auth gateway unreachable`, treat it as upstream auth connectivity:

1. Probe auth directly and capture request ids:

```bash
curl -i -X POST "https://othlyxwtigxzczeffzee.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<password>"}'
```

2. Record:
- HTTP status
- `sb-request-id`
- `cf-ray`
3. Check [Supabase Status](https://status.supabase.com/).
4. Retry from alternate network if 522 persists.

Campaign-create failures during auth 522 are expected infra-path failures, not schema mismatch bugs.

## Mythic backup and restore

Create a linked-project backup for the `mythic` schema:

```bash
./scripts/backup-mythic.sh
```

Restore from a backup file:

```bash
export SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
./scripts/restore-mythic.sh backups/mythic-backup-YYYYMMDD-HHMMSS.sql
```

## Verify OpenAI API access (Mythic)

Set your API key in the environment (or local `.env`/`.env.local`) for Mythic generation/runtime functions:

```bash
export OPENAI_API_KEY="your_api_key"
```

Mythic edge functions fail fast with:
- `openai_not_configured` when key/model is missing
- `openai_request_failed` when OpenAI request fails

## RLS smoke test (optional)

In the Supabase SQL editor, run `supabase/smoke-test.sql` after replacing `__USER_UUID__` with your user id.

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
