# Saga Spark (Mythic Weave) - Quickstart

## Install deps
```bash
./scripts/install-deps.sh
```

## Bootstrap (newest version)
1. Ensure Supabase CLI is linked and logged in.
2. Apply DB migrations:
   ```bash
   supabase db push
   ```
3. Deploy Mythic API to the Hetzner VM:
   - See `services/mythic-api/README.md`
   - Ensure the client has `VITE_MYTHIC_FUNCTIONS_BASE_URL` set to the VM base (`.../functions/v1`)
4. Build and run:
   ```bash
   npm run build
   npm run dev
   ```

## Run tests
```bash
npm run test:e2e
```

## Production smoke
```bash
npm run lint
npm run typecheck
npm run build
npm run smoke:prod
```

Manual checklist:
- `docs/PRODUCTION_SMOKE_TEST.md`

## Env
Fill in `.env` with keys (see `docs/REQUIREMENTS.md`).
