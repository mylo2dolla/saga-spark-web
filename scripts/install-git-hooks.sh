#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit scripts/secret-scan.sh

echo "Installed git hooks path: ${REPO_ROOT}/.githooks"
echo "Pre-commit secret scan is now active."
