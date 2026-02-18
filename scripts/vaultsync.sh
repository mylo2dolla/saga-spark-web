#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BRANCH="main"
SYNC_ORIGIN="${SYNC_ORIGIN:-0}"
BRANCH_SET=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push-origin)
      SYNC_ORIGIN=1
      shift
      ;;
    -h|--help)
      echo "Usage: scripts/vaultsync.sh [branch] [--push-origin]"
      exit 0
      ;;
    *)
      if [[ "$BRANCH_SET" -eq 1 ]]; then
        echo "Unexpected argument: $1"
        echo "Usage: scripts/vaultsync.sh [branch] [--push-origin]"
        exit 1
      fi
      BRANCH="$1"
      BRANCH_SET=1
      shift
      ;;
  esac
done

git fetch --all --prune

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  git checkout "$BRANCH"
fi

git config branch."$BRANCH".remote vault
git config branch."$BRANCH".merge refs/heads/"$BRANCH"
git config remote.pushDefault vault
git config push.default simple

read -r ahead behind < <(git rev-list --left-right --count "$BRANCH"...vault/"$BRANCH")

if [[ "$ahead" -gt 0 && "$behind" -eq 0 ]]; then
  echo "Local branch '$BRANCH' is ahead of vault/$BRANCH by $ahead commit(s)."
  echo "Vault is configured as source. Push first with: git push vault $BRANCH"
  exit 2
fi

if [[ "$ahead" -gt 0 && "$behind" -gt 0 ]]; then
  echo "Local '$BRANCH' diverged from vault/$BRANCH ($ahead ahead, $behind behind)."
  echo "Resolve manually before vaultsync."
  exit 3
fi

if [[ "$behind" -gt 0 ]]; then
  git merge --ff-only vault/"$BRANCH"
fi

if [[ "$SYNC_ORIGIN" == "1" ]]; then
  git push origin "$BRANCH"
fi

git status --short --branch
git rev-list --left-right --count "$BRANCH"...origin/"$BRANCH" || true
git rev-list --left-right --count "$BRANCH"...vault/"$BRANCH"

echo "vaultsync complete for '$BRANCH'."
