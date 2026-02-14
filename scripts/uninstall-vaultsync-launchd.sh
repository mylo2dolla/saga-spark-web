#!/usr/bin/env bash
set -euo pipefail

LABEL="com.sagaspark.vaultsync"
USER_ID="$(id -u)"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$USER_ID" "$PLIST_PATH" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "Removed $LABEL"
echo "Deleted: $PLIST_PATH"
