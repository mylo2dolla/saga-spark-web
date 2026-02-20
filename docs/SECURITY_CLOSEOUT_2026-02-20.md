# Security Closeout - 2026-02-20

This record captures closeout work after rewriting history to remove a leaked API key from git history.

## Scope
- Repo: `/Users/dev/dev-setup/repos/saga-spark-web`
- Incident: OpenAI API key was present in historical commit content.
- Goal: remove key from active history, harden prevention, and verify runtime safety.

## Actions Completed
- Rewrote git history to remove `services/mythic-api/.env` from reachable commits.
- Updated `.gitignore` to keep `services/mythic-api/.env` untracked.
- Aligned remotes on sanitized history (`origin/main` and `vault/main` at `0bd5621`).
- Added pre-commit guardrail hook at `.githooks/pre-commit`.
- Added secret scan script at `scripts/secret-scan.sh`.
- Added CI secret scan workflow at `.github/workflows/secret-scan.yml`.
- Added local hook installer script at `scripts/install-git-hooks.sh`.
- Removed local rewrite anchor tag `pre-filter-env-removal-20260220-1019`.
- Expired reflogs and ran aggressive local garbage collection.
- Verified tracked files and reachable history are clean for OpenAI key patterns.

## External Controls (Manual Dashboard Access Required)
- OpenAI dashboard key rotation:
  - Rotate exposed key.
  - Revoke old key.
  - Create new least-privilege key.
- GitHub repository settings:
  - Enable Secret Scanning.
  - Enable Push Protection.
- Remote sanitized branch cleanup:
  - Delete `origin/codex/sanitized-main-env-clean-20260220`.
  - Delete `vault/codex/sanitized-main-env-clean-20260220`.

## Runtime Secret Sync + Restart
- VM API host: `api.mythweaver.online`
- Runtime env file path: `/opt/mythic-api/.env`
- Service reload path:
  - Prefer `docker compose up -d --build` in `/opt/mythic-api`
  - Fallback `systemctl restart mythic-api`

## Verification
- Secret scans:
  - `bash scripts/secret-scan.sh --tracked`
  - `bash scripts/secret-scan.sh --history`
- Functional checks:
  - `npm run typecheck`
  - `npm run build`
  - `npx playwright test tests/game-smoke.spec.ts`
- VM auth smoke:
  - `./scripts/smoke-vm-functions.sh`
- Production flow checks:
  - `mythic-dungeon-master`
  - `mythic-dm-context`
  - `mythic-combat-start`
