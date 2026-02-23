# Mythic API (VM Functions Runtime)

This service hosts all game function endpoints at:

- `POST /functions/v1/<function-name>`
- `GET /healthz`

Supabase is used for Auth (JWT verification via JWKS) and Postgres only.

## Run locally

1. Copy `.env.example` to `.env` and fill required values.
2. Install deps:
   - `npm install`
3. Build:
   - `npm run build`
4. Start:
   - `npm run start`

## Deploy on VM

1. Build artifact on VM:
   - `npm install`
   - `npm run build`
2. Start with your process manager (systemd/pm2/docker).
3. Ensure reverse proxy forwards to this service and preserves `x-request-id`.

### Docker Compose (recommended)

```bash
cd /opt/saga-spark-web/services/mythic-api
cp .env.example .env
# fill .env
docker compose up -d --build
docker compose logs -f --tail=120
```

### Systemd (alternative)

Create `/etc/systemd/system/mythic-api.service`:

```ini
[Unit]
Description=Mythic API
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/saga-spark-web/services/mythic-api
EnvironmentFile=/opt/saga-spark-web/services/mythic-api/.env
ExecStart=/usr/bin/node /opt/saga-spark-web/services/mythic-api/dist/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mythic-api
sudo systemctl status mythic-api --no-pager
journalctl -u mythic-api -f
```

## Required env vars

- `SUPABASE_URL`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MYTHIC_ALLOWED_ORIGINS`
- `OPENAI_BASE_URL` (default `https://api.openai.com`)
- `OPENAI_API_KEY` (required for non-local hosts; optional for loopback local providers)
- `DM_NARRATOR_MODE` (`ai` | `procedural` | `hybrid`, default `hybrid`)
- `OPENAI_MODEL` (optional, defaults by route)

## DM narrator mode

- `DM_NARRATOR_MODE=ai`: always use the LLM narrator path.
- `DM_NARRATOR_MODE=procedural`: zero LLM calls; deterministic procedural narration only.
- `DM_NARRATOR_MODE=hybrid`: try AI first, then procedural fallback on AI failure.

Per-request overrides:
- Header: `X-DM-Narrator-Mode: ai|procedural|hybrid`
- Query param (dev only): `?dmNarrator=procedural`

Mode precedence:
1) query `dmNarrator` (dev only)
2) header `X-DM-Narrator-Mode`
3) request body `narratorMode`
4) legacy `actionContext.narrator_mode`
5) env `DM_NARRATOR_MODE`
6) default `hybrid`

Development harness:
- UI route: `/dev/narrator-test`
- API endpoint: `POST /functions/v1/mythic-narrator-test`
- Smoke test: `npm run test:narrator-smoke`

Local LM Studio / Studio Light example:

```bash
DM_NARRATOR_MODE=hybrid
OPENAI_BASE_URL=http://127.0.0.1:1234        # also accepts http://127.0.0.1:1234/v1
OPENAI_MODEL=<your-local-model>
```

## Notes

- All handlers validate JWT from `Authorization: Bearer <supabase access token>`.
- Responses include `x-request-id`.
- DM responses expose `x-dm-narrator-mode` and `x-dm-narrator-source`.
- Keep endpoint names stable; clients expect `/functions/v1/<name>`.
- Supabase Edge Functions are rollback-only; active runtime is this VM API.
