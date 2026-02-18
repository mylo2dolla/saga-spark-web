#!/usr/bin/env bash
set -euo pipefail

# Repo-local dependency installer. Uses dev-setup if present, else falls back to npm install.
DEV_SETUP="/Users/dev/dev-setup/scripts/install-deps.sh"

if [[ -f "$DEV_SETUP" ]]; then
  bash "$DEV_SETUP"
else
  echo "dev-setup not found; running npm install only."
fi

npm install
