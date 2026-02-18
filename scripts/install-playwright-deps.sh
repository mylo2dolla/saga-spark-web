#!/usr/bin/env bash
set -euo pipefail

if ! command -v sudo >/dev/null 2>&1; then
  echo "sudo is required to install system dependencies."
  exit 1
fi

YARN_LIST="/etc/apt/sources.list.d/yarn.list"
if [ -f "$YARN_LIST" ]; then
  echo "Removing $YARN_LIST to avoid expired Yarn repo signature."
  sudo rm -f "$YARN_LIST"
fi

echo "Updating apt package lists..."
sudo apt-get update

echo "Installing Playwright system dependencies..."
sudo apt-get install -y \
  libx11-xcb1 \
  libxrandr2 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxfixes3 \
  libxi6 \
  libgtk-3-0t64 \
  libatk1.0-0t64 \
  libcairo-gobject2 \
  libgdk-pixbuf-2.0-0 \
  libasound2t64

echo "Done. You can now run: npm run test:e2e"
