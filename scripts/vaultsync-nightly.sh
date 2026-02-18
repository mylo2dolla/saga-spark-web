#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# launchd sessions can have a minimal PATH; include common Homebrew/system bins.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$ROOT_DIR"
exec "$ROOT_DIR/scripts/vaultsync.sh" --push-origin
