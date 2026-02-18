# Mythic API (Self-Hosted Supabase Functions Compatibility Layer)

This service replaces Supabase Edge Functions with a self-hosted API while preserving the function path contract:

`POST /functions/v1/<function-name>`

## Requirements
- Node 20 (local dev) or Docker (VPS)
- Supabase project (Auth + Postgres)
- `SUPABASE_SERVICE_ROLE_KEY` available on the server
- OpenAI configured for Mythic DM + TTS endpoints (`OPENAI_API_KEY`)
- Deterministic turn salt configured (`MYTHIC_TURN_SALT`) for replay-safe turn resolution

## Local Dev
```bash
cd services/mythic-api
cp .env.example .env
# Fill SUPABASE_URL / SUPABASE_PROJECT_REF / SUPABASE_SERVICE_ROLE_KEY (+ OPENAI_API_KEY + MYTHIC_TURN_SALT)
npm install
npm run dev
```

Health check:
```bash
curl -sS http://localhost:3001/healthz
```

## VPS Deploy (Docker Compose + Caddy)
```bash
cd services/mythic-api
cp .env.example .env
# Fill values (MYTHIC_API_SITE + supabase + openai)
docker compose up -d --build
```

## Frontend Cutover
Set:
- `VITE_MYTHIC_FUNCTIONS_BASE_URL=http://<vps-ip>/functions/v1` (IP-only, no TLS)
- or `VITE_MYTHIC_FUNCTIONS_BASE_URL=https://<your-domain>/functions/v1` (TLS/domain)

The client will keep sending `Authorization: Bearer <Supabase access token>`.

## Smoke
See `./scripts/README.md` and run:
```bash
bash ./scripts/smoke-all.sh
```

