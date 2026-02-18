# Saga Spark (Mythic Weave) - Quickstart

## Install deps
```bash
./scripts/install-deps.sh
```

## Bootstrap (newest version)
1. Ensure Supabase CLI is linked and logged in.
2. Apply DB migrations and deploy functions:
   ```bash
   supabase db push
   supabase functions deploy mythic-create-campaign mythic-bootstrap mythic-create-character mythic-dungeon-master mythic-board-transition mythic-combat-use-skill mythic-combat-start mythic-recompute-character mythic-dm-context world-generator world-content-writer generate-class
   ```
3. Build and run:
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
