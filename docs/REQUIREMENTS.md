# Requirements

## System
- macOS
- Git
- Homebrew

## Tools
- Node.js 20
- npm
- Supabase CLI
- Docker Desktop (optional)

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
VITE_MYTHIC_FUNCTIONS_BASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Security requirements:
- Never commit `.env` values.
- Do not log raw keys/tokens in browser or edge function logs.
- Keep Supabase auth/session handling in managed storage (no manual token dumps).

## Supabase project
- Use Supabase for Auth + Postgres only.
- Runtime function execution is VM-hosted at `VITE_MYTHIC_FUNCTIONS_BASE_URL`.
- Link your active project ref and run:
  - `supabase link --project-ref <project-ref>`
  - `supabase db push`

## VM API runtime env (Hetzner)
Set these on the VM process:

```
SUPABASE_URL=
SUPABASE_PROJECT_REF=
SUPABASE_SERVICE_ROLE_KEY=
MYTHIC_ALLOWED_ORIGINS=
OPENAI_API_KEY=
OPENAI_MODEL=
OPENAI_TTS_MODEL=
OPENAI_TTS_VOICE=
```

## Verification commands
```bash
npm run lint
npm run typecheck
npm run build
npm run smoke:prod
```

Manual smoke checklist:
- `docs/PRODUCTION_SMOKE_TEST.md`
