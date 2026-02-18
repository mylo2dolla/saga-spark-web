#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.sagaspark.vaultsync"
USER_ID="$(id -u)"
AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$AGENTS_DIR/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/saga-spark-vaultsync.log"
HOUR="${VAULTSYNC_HOUR:-3}"
MINUTE="${VAULTSYNC_MINUTE:-15}"

mkdir -p "$AGENTS_DIR" "$LOG_DIR"
touch "$LOG_FILE"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>WorkingDirectory</key>
    <string>$ROOT_DIR</string>

    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>$ROOT_DIR/scripts/vaultsync-nightly.sh</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>$HOUR</integer>
      <key>Minute</key>
      <integer>$MINUTE</integer>
    </dict>

    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>
  </dict>
</plist>
EOF

launchctl bootout "gui/$USER_ID" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$USER_ID" "$PLIST_PATH"
launchctl enable "gui/$USER_ID/$LABEL"
launchctl kickstart -k "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true

echo "Installed $LABEL"
echo "Plist: $PLIST_PATH"
echo "Log:   $LOG_FILE"
launchctl print "gui/$USER_ID/$LABEL" | awk '/state =/ || /last exit code =/ || /path =/'
