# Saga Spark

Saga Spark is a fantasy RPG companion web app built with Vite, React, and Supabase (Auth + Postgres).

Runtime API architecture:
- Supabase: Auth + Postgres (canonical DB)
- Hetzner VM: Mythic API (Supabase Edge Functions-compatible routes at `/functions/v1/*`)

## Local development

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Required env for the web app (local dev):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MYTHIC_FUNCTIONS_BASE_URL` (points to Hetzner Mythic API, includes `/functions/v1`)

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
5) Deploy Mythic API to your VM (recommended) and cut over the web client:
   - See `services/mythic-api/README.md`
   - Set `VITE_MYTHIC_FUNCTIONS_BASE_URL=http://<vps-ip>/functions/v1` for IP-only dev cutover.

Note: Supabase Edge Functions can remain deployed as rollback, but primary traffic should go to the VM.

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

## Production hardening checks

Run the baseline production checks before shipping:

```bash
npm run lint
npm run typecheck
npm run build
npm run smoke:prod
```

Full manual checklist:
- `docs/PRODUCTION_SMOKE_TEST.md`

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

## Debug bundle and redaction

`Servers/Admin` includes `Export Debug Bundle`, which downloads a redacted JSON bundle with:
- build metadata
- health checks
- operation history
- recent surfaced errors

Redaction covers auth headers, JWT-like tokens, and API keys.

## Verify Groq API access

Set your API key in the environment (or a local `.env.local` file) and run the verification script:

```bash
export GROQ_API_KEY="your_api_key"
npm run verify:groq
```

## Mythic API (Hetzner VM) deploy

The Mythic API is in `services/mythic-api/` and provides `/functions/v1/<function-name>` endpoints compatible with the existing client.

Quick deploy (from the VM, Docker required):
1. `cd /opt/mythic-api` (or your chosen path)
2. `cp .env.example .env` and fill:
   - `SUPABASE_URL`, `SUPABASE_PROJECT_REF`, `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`, `MYTHIC_TURN_SALT`
   - `MYTHIC_ALLOWED_ORIGINS` (comma-separated) or leave empty for dev
   - For IP-only: set `MYTHIC_API_SITE=http://:80` (prevents CORS-preflight https redirects)
3. `docker compose up -d --build`

Security note: IP-only HTTP is fine for local/dev. For production, use a real domain + TLS so Supabase access tokens are not sent over plaintext HTTP.

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
- You can also run `npm run test:e2e:deps` to apply the workaround automatically.

CI:
- The Playwright HTML report is uploaded as a workflow artifact named `playwright-report`.

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
