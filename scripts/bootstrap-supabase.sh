#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="othlyxwtigxzczeffzee"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT_DIR/supabase/migrations"

echo "Bootstrapping Supabase project: ${PROJECT_REF}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI not found."
  echo "Option A (recommended): install via 'brew install supabase/tap/supabase' and rerun."
  echo "Option B: paste migrations into the Supabase SQL editor."
  echo "---- SQL BEGIN ----"
  cat "${MIGRATIONS_DIR}"/*.sql
  echo "---- SQL END ----"
  exit 1
fi

supabase link --project-ref "${PROJECT_REF}"
supabase db push

echo "Bootstrap complete."
