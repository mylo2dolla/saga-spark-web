#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <backup-file.sql>"
  exit 1
fi

BACKUP_FILE="$1"
if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}"
  exit 1
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is required to restore."
  echo "Example: export SUPABASE_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'"
  exit 1
fi

echo "Restoring mythic backup from ${BACKUP_FILE}"
psql "${SUPABASE_DB_URL}" -v ON_ERROR_STOP=1 -f "${BACKUP_FILE}"
echo "Restore complete."

