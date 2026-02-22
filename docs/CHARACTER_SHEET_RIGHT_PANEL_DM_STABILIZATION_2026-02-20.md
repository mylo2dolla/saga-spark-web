# Character Sheet + Right Panel + DM Stabilization (2026-02-20)

## Scope
One-pass delivery focused on:
1. Character-sheet UX upgrade (mini HUD + full sheet + inline autosave).
2. Right-panel readability cleanup (board-first split with explicit inspect/actions dock).
3. DM responsiveness hardening (stale stream guard, duplicate prompt suppression, clearer diagnostics).

Supabase remains auth/db only. Gameplay runtime calls remain VM-hosted.

## What Changed

### Character Sheet
- Added modular character UI under `src/ui/components/mythic/character2/`:
  - `CharacterMiniHud.tsx`
  - `CharacterSheetSurface.tsx`
  - `CharacterSheetSections.tsx`
  - `adapters.ts`
  - `types.ts`
- Mini HUD is always visible in active gameplay on the right page.
- Full character sheet opens from mini HUD and supports sections:
  - `overview`, `combat`, `skills`, `companions`, `quests`
- Added autosave profile editing for:
  - `mythic.characters.name`
  - `mythic.characters.class_json.profile.callsign`
  - `mythic.characters.class_json.profile.pronouns`
  - `mythic.characters.class_json.profile.origin_note`
- Added rollback-on-failure behavior with toast feedback.

### Right Panel
- Updated `NarrativeBoardPage` to a cleaner 3-zone structure:
  - compact top status/metrics strip
  - large middle viewport
  - bottom explicit dock for inspect + actions
- Only one warning banner is shown at a time; remaining details stay in diagnostics.
- Inspect-first behavior remains unchanged.

### DM Reliability
- Frontend hook `useMythicDungeonMaster` now includes:
  - request sequence stale-stream guard
  - request-id-aware error propagation
  - structured `lastError` + `lastResponseMeta` diagnostics
- Screen action queue now suppresses duplicate low-signal queued prompts (`refresh` and repeated `dm_prompt` payloads).
- Backend `mythic-dungeon-master` now fast-fails to deterministic recovery earlier on repeated validation failures to reduce retry churn.

## Compatibility Mapping
Legacy intents remain accepted and remapped without breaking contracts.

| Legacy input | New UX destination |
|---|---|
| `open_panel:character` | Full Character Sheet (`overview`) |
| `open_panel:status` | Full Character Sheet (`overview`) |
| `open_panel:progression` | Full Character Sheet (`overview`) |
| `open_panel:loadout` / `open_panel:loadouts` / `open_panel:gear` | Full Character Sheet (`skills`) |
| `loadout_action` | Full Character Sheet (`skills`) |
| `open_panel:combat` | Utility Drawer `combat` panel |
| `open_panel:quests` | Utility Drawer `quests` panel |
| `open_panel:companions` | Utility Drawer `companions` panel |

## Validation Matrix

### Automated checks
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npx playwright test tests/game-smoke.spec.ts`: PASS (2/2)
- `npm run smoke:prod`: PASS (2/2)
- `./scripts/smoke-vm-functions.sh`: PASS
- `npm run smoke:board`: PASS

### Key VM request IDs (authenticated smoke)
- `mythic-create-campaign`: `fd9b5450-b9f9-48c7-a782-3d134c800db7`
- `mythic-create-character`: `1f46000a-67e8-4f75-9e7c-d38acf114c97`
- `mythic-dm-context`: `1af2f5cf-3299-4c1c-991c-d2eecc1bce65`
- `mythic-dungeon-master`: `a9fb782c-8a7b-49c5-8a3d-5d1b0f83e744`
- `mythic-runtime-transition:travel`: `fe7617f0-1b42-4ed6-ad34-c4ff89370dc0`
- `mythic-runtime-transition:dungeon`: `372f4dad-b460-4ce0-8213-0c30d485b21e`
- `mythic-runtime-transition:town`: `b86a22b5-39c9-4d42-bc4f-8bca0a24bb22`
- `mythic-combat-start`: `65fd1633-7578-47e0-9798-702d73f50c15`

## Production Lock-In (Direct Prod / Full)

### Frontend deployment
- Production alias: `https://mythweaver.online`
- Active deployment URL: `https://saga-spark-kaxwfktkd-mylo2dollas-projects.vercel.app`
- Active deployment ID: `dpl_H5ueh8JgaFhwdwkV8c5443JCPB9M`
- Active deployment created: `2026-02-20 16:50:27 -0700` (from Vercel inspect)

### VM runtime deployment
- Runtime host: `api.mythweaver.online`
- Deploy mode: rsync source to `/opt/saga-spark-web/services/mythic-api` + `docker compose up -d --build --force-recreate`
- Deploy completed (UTC): `2026-02-20T23:53:09Z`
- Runtime marker hash (`mythic-dungeon-master.ts` on host): `d62d1a6aa2a911b07aa259a5af563cf224812f07bd1620de9636347209883f94`
- Runtime env presence verified: `SUPABASE_*`, `OPENAI_API_KEY`, `MYTHIC_ALLOWED_ORIGINS`

### Fresh authenticated board smoke IDs (post-deploy lock run)
- `mythic-create-campaign`: `1cd6d334-c0a4-488b-b909-cf0d33bc2019`
- `mythic-create-character`: `fe4b4499-a27e-41d1-8ec0-5a61afd582ec`
- `mythic-dm-context`: `1071acbd-c927-436c-aa4c-54b4fd42eece`
- `mythic-dungeon-master`: `1de6445b-d621-4829-9e79-c23804c98809`
- `mythic-runtime-transition:travel`: `f49ed6de-16c6-4653-acd6-fd8030e84582`
- `mythic-runtime-transition:dungeon`: `e67349de-dc6f-4487-9f18-0d6d0f7a4937`
- `mythic-runtime-transition:town`: `22a53523-98ad-4bf5-9525-d909cc21ad24`
- `mythic-combat-start`: `620df33c-87a7-4c21-8a94-e105a88461af`

### Rollback anchors
- Release tag: `release-2026-02-20-character-board-dm-lock`
- Release commit: `3173c5efea0eec8e802d67119e2a5c7f73703049`
- Previous frontend deployment ID: `dpl_FdkznprxLjzrFm7vR25vEtqUeWtt`
- Previous frontend deployment URL: `https://saga-spark-3yqlutjry-mylo2dollas-projects.vercel.app`
- Previous known-good code SHA: `70a45f45a793ad8e04d520132a2dc4fc3a3e5579`

### Hygiene guardrails
- `bash scripts/secret-scan.sh --tracked`: PASS
- `bash scripts/secret-scan.sh --history`: PASS
- `bash scripts/install-git-hooks.sh`: PASS (`.githooks` installed, pre-commit scan active)

### Baseline freeze note
- Lock-in complete on `2026-02-20`.
- No additional feature merges should land until manual production QA pass is recorded against one disposable campaign and one real campaign.

## Residual Notes
- Loadout backend endpoints remain intact for compatibility; loadout is no longer a promoted player-facing surface.
- Diagnostics now expose last DM error/recovery metadata and request IDs to speed production triage.
