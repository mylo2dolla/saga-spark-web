#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <service> <account> <secret>" >&2
  exit 1
fi

SERVICE="$1"
ACCOUNT="$2"
SECRET="$3"

security add-generic-password -U -s "${SERVICE}" -a "${ACCOUNT}" -w "${SECRET}" >/dev/null

echo "Updated keychain secret for service='${SERVICE}' account='${ACCOUNT}'"
