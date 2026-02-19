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
- `OPENAI_API_KEY`

## Notes

- All handlers validate JWT from `Authorization: Bearer <supabase access token>`.
- Responses include `x-request-id`.
- Keep endpoint names stable; clients expect `/functions/v1/<name>`.
- Supabase Edge Functions are rollback-only; active runtime is this VM API.
