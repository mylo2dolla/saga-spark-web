# Production Smoke Test

This checklist validates the production hardening pass without changing product scope.

## 1) Install and run

```bash
./scripts/install-deps.sh
npm run lint
npm run typecheck
npm run build
npm run dev
```

Open `http://localhost:8080`.

## 2) Core flow

1. Login with a valid account.
2. Open `Dashboard`.
3. Create a campaign with name + description.
4. Confirm UI reaches `/mythic/:campaignId` (or `/mythic/:campaignId/create-character`).
5. Confirm campaign appears in list and no spinner is stuck.
6. Open `Servers/Admin` and run:
   - `Test DB`
   - `Export Debug Bundle`

## 3) Failure flow

1. Disconnect network temporarily (or block Supabase hostname) and attempt:
   - login
   - campaign create
   - DM send
2. Verify each operation exits loading state and shows an actionable error.
3. Reconnect network and retry from the same UI controls.

## 4) Debug bundle export

1. In `Servers/Admin`, click `Export Debug Bundle`.
2. Confirm JSON includes:
   - app build metadata
   - health checks
   - operation history
   - error history

## 5) Secrets redaction verification

1. Search downloaded bundle for any raw secrets:

```bash
rg -n "Bearer |eyJ|sk-|sb_publishable_|authorization|apikey|token|password" ~/Downloads/mythic-debug-bundle-*.json
```

2. Expected result:
   - no raw token/key values
   - values appear as `[REDACTED]`, `[REDACTED_KEY]`, or `[REDACTED_JWT]`

## 6) Automated smoke

```bash
npm run smoke:prod
```

This runs Playwright production smoke assertions for dashboard/campaign/mythic routes and diagnostics export.
