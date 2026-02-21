#!/usr/bin/env bash
set -euo pipefail

VM_HOST="${MYTHIC_VM_HOST:-api.mythweaver.online}"
VM_USER="${MYTHIC_VM_USER:-root}"
REMOTE_ROOT="${MYTHIC_VM_ROOT:-/opt/saga-spark-web}"
SERVICE_DIR="${REMOTE_ROOT}/services/mythic-api"

ssh "${VM_USER}@${VM_HOST}" "set -euo pipefail
if [ ! -d '${REMOTE_ROOT}' ]; then
  echo 'missing checkout: ${REMOTE_ROOT}' >&2
  exit 1
fi
if [ ! -d '${SERVICE_DIR}' ]; then
  echo 'missing service dir: ${SERVICE_DIR}' >&2
  exit 1
fi
cd '${REMOTE_ROOT}'
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo 'not a git checkout: ${REMOTE_ROOT}' >&2
  exit 1
fi
if ! git remote get-url vault >/dev/null 2>&1; then
  echo 'missing vault remote in checkout' >&2
  exit 1
fi
if [ ! -f '${SERVICE_DIR}/.env' ]; then
  echo 'missing runtime env file: ${SERVICE_DIR}/.env' >&2
  exit 1
fi
if [ -f '${SERVICE_DIR}/docker-compose.yml' ] || [ -f '${SERVICE_DIR}/docker-compose.yaml' ] || [ -f '${SERVICE_DIR}/compose.yml' ] || [ -f '${SERVICE_DIR}/compose.yaml' ]; then
  cd '${SERVICE_DIR}'
  docker compose config >/dev/null
else
  echo 'missing docker compose file in service dir' >&2
  exit 1
fi
HEAD_SHA=\$(git -C '${REMOTE_ROOT}' rev-parse --short HEAD)
STATUS=\$(git -C '${REMOTE_ROOT}' status --short | wc -l | tr -d ' ')
echo \"VM_DEPLOY_GUARD_OK host=${VM_HOST} head=\${HEAD_SHA} dirty_lines=\${STATUS}\"
"
