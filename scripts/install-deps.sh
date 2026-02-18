#!/usr/bin/env bash
set -euo pipefail

# Repo-local dependency installer. Uses dev-setup if present, else falls back to npm install.
DEV_SETUP="/Users/dev/dev-setup/scripts/install-deps.sh"

prefer_node20() {
  local current_version=""
  local current_major=""
  if command -v node >/dev/null 2>&1; then
    current_version="$(node -v 2>/dev/null || true)"
    current_major="${current_version#v}"
    current_major="${current_major%%.*}"
  fi

  if [[ "$current_major" == "20" ]]; then
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    local brew_node20=""
    brew_node20="$(brew --prefix node@20 2>/dev/null || true)"
    if [[ -n "$brew_node20" && -x "$brew_node20/bin/node" ]]; then
      export PATH="$brew_node20/bin:$PATH"
      hash -r
      current_version="$(node -v 2>/dev/null || true)"
      current_major="${current_version#v}"
      current_major="${current_major%%.*}"
      if [[ "$current_major" == "20" ]]; then
        echo "Using Node $current_version from Homebrew node@20."
        return 0
      fi
    fi
  fi

  echo "⚠️  Warning: Saga Spark expects Node 20. Current Node: ${current_version:-missing}"
  echo "   Recommended: nvm install 20 && nvm use 20"
}

prefer_node20

if [[ -f "$DEV_SETUP" ]]; then
  bash "$DEV_SETUP"
else
  echo "dev-setup not found; running npm install only."
fi

npm install
