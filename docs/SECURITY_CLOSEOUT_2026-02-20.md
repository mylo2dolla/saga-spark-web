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
- Removed temporary remote branches:
  - `origin/codex/sanitized-main-env-clean-20260220`
  - `vault/codex/sanitized-main-env-clean-20260220`
- Enabled GitHub Secret Scanning and Push Protection for `mylo2dolla/saga-spark-web`.
- Expired reflogs and ran aggressive local garbage collection.
- Verified tracked files and reachable history are clean for OpenAI key patterns.
- OpenAI key rotation completed (user-confirmed): old key revoked and replacement key created on 2026-02-20.
- Synced new `OPENAI_API_KEY` to local runtime file (`services/mythic-api/.env`) and VM runtime file (`/opt/mythic-api/.env`).
- Verified local/VM key parity by hash and restarted `mythic-api` container with `docker compose up -d --build` and `--force-recreate`.

## Remaining Manual Controls
- None.

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
- Authenticated production flow checks (2026-02-20T17:56:22Z):
  - `mythic-dm-context` -> `200` (request_id `e817d906-649f-4296-ae48-475a8ab8ecc3`)
  - `mythic-dungeon-master` -> `200` SSE (request_id `bdfab9c0-d663-4ad4-b192-73c4480567e9`)
  - `mythic-combat-start` -> `400 character_missing` (request_id `8135d41b-ec38-4a71-baad-0710c3d43798`, expected for campaign without a character)
