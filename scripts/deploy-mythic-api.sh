#!/usr/bin/env bash
set -euo pipefail

# Deploy the self-hosted Supabase Edge Functions compatibility layer (services/mythic-api)
# to a VPS via SSH + rsync, without ever embedding secrets in this repo.
#
# Usage:
#   MYTHIC_VPS_HOST=5.78.189.122 ./scripts/deploy-mythic-api.sh
#
# Optional:
#   MYTHIC_VPS_USER=root
#   MYTHIC_VPS_DIR=/opt/mythic-api
#   MYTHIC_API_DOMAIN=api.yourdomain.com

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/services/mythic-api"

HOST="${MYTHIC_VPS_HOST:-}"
USER="${MYTHIC_VPS_USER:-root}"
DEST_DIR="${MYTHIC_VPS_DIR:-/opt/mythic-api}"
API_DOMAIN="${MYTHIC_API_DOMAIN:-$HOST}"

if [[ -z "$HOST" ]]; then
  echo "ERROR: set MYTHIC_VPS_HOST (example: MYTHIC_VPS_HOST=5.78.189.122)" >&2
  exit 1
fi

if [[ ! -d "$SRC_DIR" ]]; then
  echo "ERROR: missing $SRC_DIR" >&2
  exit 1
fi

echo "==> Checking SSH connectivity ($USER@$HOST)..."
ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new "$USER@$HOST" "echo ok" >/dev/null

echo "==> Installing Docker (if missing)..."
ssh "$USER@$HOST" "set -euo pipefail;
  if command -v docker >/dev/null 2>&1; then
    echo \"docker already installed\";
    exit 0;
  fi;
  export DEBIAN_FRONTEND=noninteractive;
  apt-get update -y;
  apt-get install -y docker.io docker-compose-v2 ca-certificates curl jq;
  systemctl enable --now docker;
  docker --version;
  docker compose version;
"

echo "==> Syncing $SRC_DIR -> $USER@$HOST:$DEST_DIR ..."
ssh "$USER@$HOST" "mkdir -p '$DEST_DIR'"
rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .env \
  "$SRC_DIR/" "$USER@$HOST:$DEST_DIR/"
ssh "$USER@$HOST" "chown -R root:root '$DEST_DIR'"

echo "==> Ensuring $DEST_DIR/.env exists (secrets left blank)..."
ssh "$USER@$HOST" "set -euo pipefail;
  cd '$DEST_DIR';
  if [ -f .env ]; then
    echo \".env already exists (not modifying)\";
    exit 0;
  fi
  umask 077;
  SALT=\"\$(openssl rand -hex 32)\";
  cat > .env <<EOF
MYTHIC_API_DOMAIN=$API_DOMAIN
CADDY_EMAIL=

SUPABASE_URL=https://othlyxwtigxzczeffzee.supabase.co
SUPABASE_PROJECT_REF=othlyxwtigxzczeffzee
SUPABASE_SERVICE_ROLE_KEY=

MYTHIC_ALLOWED_ORIGINS=

OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com
OPENAI_MODEL=gpt-4o-mini
OPENAI_TTS_MODEL=tts-1

MYTHIC_TURN_SALT=\$SALT

LOG_LEVEL=info
GLOBAL_RATE_LIMIT_MAX=240
GLOBAL_RATE_LIMIT_WINDOW_MS=60000
EOF
  chmod 600 .env;
  echo \"wrote .env (SUPABASE_SERVICE_ROLE_KEY/OPENAI_API_KEY still blank)\";
"

cat <<EOF

Next steps (manual, secrets):
1) SSH to the VPS and edit: $DEST_DIR/.env
   - set SUPABASE_SERVICE_ROLE_KEY (Supabase Dashboard -> Project Settings -> API -> service_role key)
   - set OPENAI_API_KEY

2) Start the stack:
   ssh $USER@$HOST 'cd $DEST_DIR && docker compose up -d --build'

3) Verify health:
   curl -sS http://$HOST/healthz

4) Cutover the frontend by setting (local .env.local):
   VITE_MYTHIC_FUNCTIONS_BASE_URL=http://$HOST/functions/v1

Security note:
- Use a real domain + TLS before sending Bearer tokens over the public internet.
EOF

