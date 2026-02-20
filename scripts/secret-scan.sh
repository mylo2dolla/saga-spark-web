#!/usr/bin/env bash
set -euo pipefail

MODE="${1:---tracked}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

# Target likely live API tokens, not placeholder variable names.
TOKEN_REGEX='(sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY[[:space:]]*=[[:space:]]*["'\'']?[A-Za-z0-9_-]{20,})'

print_header() {
  printf '\n[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$1"
}

scan_staged() {
  print_header "Scanning staged additions for high-risk secrets"
  local staged_additions
  staged_additions="$(
    git diff --cached --no-color --unified=0 --diff-filter=AM \
      | awk '/^\+/ && $0 !~ /^\+\+\+/ { print substr($0, 2) }'
  )"

  if [[ -z "${staged_additions}" ]]; then
    echo "No staged additions to scan."
    return 0
  fi

  if printf '%s\n' "${staged_additions}" | rg -n --pcre2 "${TOKEN_REGEX}" >/tmp/secret-scan-staged-hit.txt; then
    echo "Secret-like token found in staged content:"
    cat /tmp/secret-scan-staged-hit.txt
    return 1
  fi

  echo "Staged additions are clean."
}

scan_tracked() {
  print_header "Scanning tracked files in HEAD"
  local tracked_hits
  tracked_hits="$(mktemp)"
  if git grep -nI -E "${TOKEN_REGEX}" HEAD -- >"${tracked_hits}" 2>/dev/null; then
    echo "Secret-like token found in tracked files:"
    cat "${tracked_hits}"
    rm -f "${tracked_hits}"
    return 1
  fi
  rm -f "${tracked_hits}"
  echo "Tracked files are clean."
}

scan_history() {
  print_header "Scanning reachable git history"
  local history_hits
  history_hits="$(mktemp)"
  local rev

  while IFS= read -r rev; do
    git grep -nI -E "${TOKEN_REGEX}" "${rev}" -- >>"${history_hits}" 2>/dev/null || true
  done < <(git rev-list --all)

  if [[ -s "${history_hits}" ]]; then
    echo "Secret-like token found in git history:"
    cat "${history_hits}"
    rm -f "${history_hits}"
    return 1
  fi

  rm -f "${history_hits}"
  echo "Reachable git history is clean."
}

case "${MODE}" in
  --staged)
    scan_staged
    ;;
  --tracked)
    scan_tracked
    ;;
  --history)
    scan_history
    ;;
  --all)
    scan_tracked
    scan_history
    ;;
  *)
    echo "Usage: $0 [--staged|--tracked|--history|--all]"
    exit 2
    ;;
esac
