#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-${1:-}}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOOTSTRAP_SQL="$ROOT_DIR/supabase/bootstrap.sql"

if [[ -z "${PROJECT_REF}" ]]; then
  echo "Missing Supabase project ref."
  echo "Usage: SUPABASE_PROJECT_REF=<project-ref> $0"
  echo "   or: $0 <project-ref>"
  exit 1
fi

echo "Bootstrapping Supabase project: ${PROJECT_REF}"

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI not found."
  echo "Option A (recommended): install via 'brew install supabase/tap/supabase' and rerun."
  echo "Option B: paste migrations into the Supabase SQL editor."
  echo "---- SQL BEGIN ----"
  cat "${BOOTSTRAP_SQL}"
  echo "---- SQL END ----"
  exit 1
fi

supabase link --project-ref "${PROJECT_REF}"
supabase db push

echo "Bootstrap complete."
