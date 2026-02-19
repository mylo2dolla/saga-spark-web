# Saga Spark (Mythic Weave) - Quickstart

## Install deps
```bash
./scripts/install-deps.sh
```

## Bootstrap (Supabase Auth + DB)
1. Ensure Supabase CLI is logged in.
2. Link and push DB migrations:
   ```bash
   supabase link --project-ref <project-ref>
   supabase db push
   ```
3. Build and run frontend:
   ```bash
   npm run build
   npm run dev
   ```

## Functions Runtime (Hetzner VM)
All `/functions/v1/*` requests are served by the VM API, not Supabase Edge.

```bash
cd services/mythic-api
npm install
npm run build
npm run start
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
