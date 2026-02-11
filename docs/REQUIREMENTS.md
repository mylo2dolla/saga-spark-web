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

## Supabase project
- Linked project: `othlyxwtigxzczeffzee`
- Use `supabase db push` for migrations
