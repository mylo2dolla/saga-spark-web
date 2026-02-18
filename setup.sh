#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f package.json ]]; then
  echo "package.json not found in $(pwd)"
  exit 1
fi

npm install

# Supabase CLI: ensure project is linked (remote-only)
if command -v supabase >/dev/null 2>&1; then
  supabase projects list >/dev/null 2>&1 || true
  if [[ -f supabase/config.toml ]]; then
    echo "Supabase config present: $(grep project_id supabase/config.toml || true)"
  fi
fi

