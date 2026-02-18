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

## Web app env
Fill these in `/Users/dev/saga-spark-web/.env` (or `.env.local`):
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
# Required for routing `/functions/v1/*` to your Hetzner VM.
# Example: http://5.78.189.122/functions/v1
VITE_MYTHIC_FUNCTIONS_BASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

## Server env (Hetzner VM / Mythic API)
These live on the VM only (do not put service role or OpenAI keys in the browser):
- `SUPABASE_URL`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `MYTHIC_TURN_SALT`
- `MYTHIC_ALLOWED_ORIGINS` (optional CORS allowlist)

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
