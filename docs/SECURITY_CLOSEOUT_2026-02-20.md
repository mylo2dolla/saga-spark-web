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
- Exact dashboard revoke/create timestamps were not recorded during incident response.
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

## Narrative Board Stabilization (2026-02-20)

### Automated board/runtime smoke
- `mythic-create-campaign` -> `200` (request_id `05e7795f-4af9-4927-a92a-06ff294da7e0`)
- `mythic-create-character` -> `200` (request_id `f92380bd-efcd-40d4-8349-53f51b09e904`)
- `mythic-dm-context` -> `200` (request_id `f453ab2d-52fa-4a4c-a061-fd71255ba2ab`)
- `mythic-dungeon-master` -> `200` SSE parseable JSON (request_id `510d2e26-a2b5-4462-ad8d-ca233bc3e787`)
- `mythic-runtime-transition:travel` -> `200` (request_id `1f645b33-7d5d-42db-a0db-f218b6ce1943`)
- `mythic-runtime-transition:dungeon` -> `200` (request_id `62a3bb6b-8df0-40c4-af16-2f3f9f0f8fa2`)
- `mythic-runtime-transition:town` -> `200` (request_id `52116a82-fd07-4881-aaff-733f2435bb1a`)
- `mythic-combat-start` -> `200` (request_id `7f2bfc52-0efb-41a7-85d4-be4842b7c862`)

### Manual UI board QA
- Town vendor hotspot -> inspect card opens first; explicit action triggers DM flow.
- Travel miss-click on board background -> probe inspect card opens; no auto-run on miss-click.
- Dungeon door hotspot inspect card includes room payload metadata (`from_room_id` / `to_room_id`); explicit action path available.
- Combat focus target + quick-cast both execute and reflect in recent combat events.
- Utility drawer remains reachable from right-panel menu and panel tabs remain functional.

### Stabilization fixes applied
- Added authenticated board smoke harness: `scripts/smoke-mythic-board-auth.sh`.
- Added npm runner: `npm run smoke:board`.
- Tightened action dedupe signature logic to reduce repeated action-chip spam in:
  - `src/ui/screens/MythicGameScreen.tsx`
  - `src/ui/components/mythic/board2/actionBuilders.ts`

### Residual issues observed
- Long-running DM narration requests can still surface `Operation timed out after 95000ms` / cancellation in UI during chained actions.
- No `turn_commit_failed` (`campaign_id is ambiguous`) regression observed in this stabilization pass.

## Narrative Board Hardening Follow-Up (2026-02-20)

### Fixes applied
- Serialized narrated DM actions behind a shared queue in `src/ui/screens/MythicGameScreen.tsx` so chained actions do not overlap and cancel one another.
- Routed campaign intro narration through the same queue and set `abortPrevious: false` for intro/action DM sends.
- Increased narrated-action DM timeout to `110000ms` (`DM_ACTION_TIMEOUT_MS`) to reduce false timeout noise on slow generations.
- Added cancellation-aware handling:
  - `src/hooks/useMythicDungeonMaster.ts` now supports `suppressErrorToast` and suppresses expected abort/cancel toasts.
  - `src/ui/screens/MythicGameScreen.tsx` now treats expected cancel/abort as non-fatal in narrated action handling.
- Added DM/queue guard to enemy auto-turn trigger so it does not fire while DM narration is active or a narrated action is already queued.

### Validation rerun
- `npm run typecheck` -> pass.
- `npm run build` -> pass.
- `npx playwright test tests/game-smoke.spec.ts` -> pass.
- `./scripts/smoke-vm-functions.sh` -> pass.
- `npm run smoke:board` -> pass with request IDs:
  - `mythic-create-campaign` `2d961f2b-33e7-46fb-8910-0f6a1f037b24`
  - `mythic-create-character` `ea153722-8cff-494d-a743-61e0b8e5d12f`
  - `mythic-dm-context` `2711c104-753b-4481-a244-100ca381c0a7`
  - `mythic-dungeon-master` `b0d4abab-a597-4c48-b624-c716a94381e0`
  - `mythic-runtime-transition:travel` `d1f5e5fc-2dd9-4a33-bc29-150f47507c71`
  - `mythic-runtime-transition:dungeon` `95fdfc79-d5a7-45d4-b312-29aebc4e8e91`
  - `mythic-runtime-transition:town` `cbcb80b0-63f0-4991-b8bb-381df56ec4c6`
  - `mythic-combat-start` `4acb97dc-16cb-4adc-bc93-d66c71375ace`
