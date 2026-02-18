#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/backups"
STAMP="$(date +"%Y%m%d-%H%M%S")"
OUT_FILE="${OUT_DIR}/mythic-backup-${STAMP}.sql"

mkdir -p "${OUT_DIR}"

echo "Creating mythic schema backup: ${OUT_FILE}"
supabase db dump --linked --schema mythic --file "${OUT_FILE}"
echo "Backup complete: ${OUT_FILE}"

