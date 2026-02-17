# Requirements

## System
- macOS
- Git
- Homebrew

## Tools
- Node.js 20
- npm
- Supabase CLI
- Deno
- Docker Desktop (optional, for local Supabase)

## Install deps script
```bash
./scripts/install-deps.sh
```

## API keys
Fill these in `/Users/dev/saga-spark-web/.env`:
```
OPENAI_API_KEY=
GROQ_API_KEY=
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Security requirements:
- Never commit `.env` values.
- Do not log raw keys/tokens in browser or edge function logs.
- Keep Supabase auth/session handling in managed storage (no manual token dumps).

## Supabase project
- Linked project: `othlyxwtigxzczeffzee`
- Use `supabase db push` for migrations

## Verification commands
```bash
npm run lint
npm run typecheck
npm run build
npm run smoke:prod
```

Manual smoke checklist:
- `docs/PRODUCTION_SMOKE_TEST.md`
