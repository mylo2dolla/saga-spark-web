# Forge Seed + Companion Quality Upgrade (2026-02-22)

## Scope
This pass upgraded campaign/class forge quality and companion setup:

- `mythic-create-campaign` now accepts optional `companion_blueprint`.
- Dashboard campaign creation UI now includes optional companion setup rows:
  - companion name
  - archetype (`scout`, `tactician`, `support`, `vanguard`, `hunter`, `mystic`)
- Campaign seeding now prefers user-provided companion blueprints and falls back to deterministic seed names with uniqueness guards.
- Replaced repetitive companion seed pools (removed recurring `Vex`/`Rune` defaults).
- Character forge no longer auto-compacts class concept text in create flow.
- Class concept expand flow in `mythic-field-generate` no longer runs compaction-style rewrite; it keeps short complete output and trims safely.
- Skill effect metadata now includes additive presentation data:
  - `effects_json.style_tags`
  - `effects_json.presentation`

## Runtime/API Compatibility
- No endpoint removals/renames.
- `mythic-create-campaign` request extension is additive and optional.
- Existing campaign creation calls without `companion_blueprint` remain valid.

## Naming/Theme Updates
- Updated deterministic word banks for class refinement to reduce generic/repetitive naming.
- Updated combat enemy naming pools in `mythic-combat-start` to fantasy-forward names with deterministic uniqueness.

## Verification
- `npm run typecheck` ✅
- `npm run build` ✅
- `npm run smoke:board` ✅
- `npm run smoke:prod` ✅

## Rollback Anchors
- Changes are isolated to UI inputs + additive request schema + deterministic naming/presentation metadata.
- Rollback can be done by reverting:
  - `src/ui/screens/DashboardScreen.tsx`
  - `services/mythic-api/src/functions/mythic-create-campaign.ts`
  - `services/mythic-api/src/functions/mythic-create-character.ts`
  - `services/mythic-api/src/functions/mythic-field-generate.ts`
  - `services/mythic-api/src/functions/mythic-combat-start.ts`

## Latest Validation Run (2026-02-22, Post-Integration)
- `npm run typecheck` ✅
- `npm run build` ✅
- `npx playwright test tests/prod-smoke.spec.ts` ✅
- `npm run smoke:board` ✅
  - `mythic-create-campaign`: `39fbd2ba-673a-4f3f-9160-3f3cfe646326`
  - `mythic-create-character`: `1c9af930-c92f-47ad-839c-90110edc9667`
  - `mythic-dm-context`: `656e24ea-07e8-412e-ac4b-0e1794bfb1e9`
  - `mythic-dungeon-master`: `ee437449-910f-4b45-9a22-6913d3bbc5eb`
  - `mythic-combat-start`: `da9d5f91-5f98-4346-a651-e312ef4498c2`

## Post-Deploy Verification (2026-02-22)
- `npm run smoke:prod` ✅
- `npm run smoke:board` ✅
  - `mythic-create-campaign`: `245b719d-6822-4d67-957c-d6223b72954c`
  - `mythic-create-character`: `b118c863-e84d-4e16-9964-22383c46f6dd`
  - `mythic-dm-context`: `e95614ad-87a6-4764-9b09-fc54c6ced525`
  - `mythic-dungeon-master`: `c016054e-b9da-4bd5-a6ff-b26ffb4d4624`
  - `mythic-combat-start`: `21e01a2f-cd0a-4d2f-8655-86b82952c3af`

## Reset/Backfill Runbook (User-Scoped)
### Scripts
- Reset owned campaigns:
  - `npx tsx scripts/reset-mythic-user-campaigns.ts --email=<owner-email> --dry-run`
  - `npx tsx scripts/reset-mythic-user-campaigns.ts --email=<owner-email> --yes`
- Backfill presentation/naming metadata:
  - `npx tsx scripts/backfill-mythic-presentation-wordbank.ts --email=<owner-email> --yes`
- Compatibility wrapper (legacy script entrypoint):
  - `npx tsx scripts/backfill-mythic-naming-cutover.ts --email=<owner-email> --yes`

### Latest User-Scoped Reset Execution
- Owner: `strange-ops@cyber-wizard.com`
- User ID: `76aeebff-aa12-417d-a5d8-e6b56c241080`
- Purged campaigns:
  - `932c0f21-55af-4c68-9fa2-098528ef727d`
  - `ce637462-6600-48f1-9817-5400750f991f`
  - `b24e8abf-0a46-404e-ad3a-4c3889fa8239`
- Backfill result after reset: `No campaigns matched scope.` (expected after purge).

### Post-Reset Seed Verification Smoke
- Executed `bash scripts/smoke-mythic-board-auth.sh --post-reset-seed` ✅
- Request IDs:
  - `mythic-create-campaign`: `0c041707-f091-4b90-b198-852f2d1d27e2`
  - `mythic-create-character`: `3a162af6-96e3-4cf5-891a-08321ac9367a`
  - `mythic-dm-context`: `e59279e5-43c2-4b83-a113-42f70fa6d077`
  - `mythic-dungeon-master`: `97bede89-96a7-4e8d-910f-64222afdd3de`
  - `mythic-runtime-transition:travel`: `802f365b-c6e3-4ac8-9a55-64ece1b366c0`
  - `mythic-runtime-transition:dungeon`: `f94a08c3-8a50-4b42-bc36-46bb6233c2a5`
  - `mythic-runtime-transition:town`: `6045c477-7a35-4895-b082-2cee09c5f13d`
  - `mythic-combat-start`: `40d8a942-4713-42a6-907f-5ba5c0961c99`

## Naming/Forge Polish Lock-In (2026-02-22)
- Deterministic fallback naming pools were tuned to reduce low-signal/repetitive lexicon:
  - reduced `sigil/rune` style overuse in controller/hybrid banks,
  - improved ultimate label pool variety (`sunburst/moonflare/heavenfall` tiering),
  - class description fallback copy shifted to player-facing mythic language.
- LLM refinement style guard updated from dark-only bias to mixed mythic + whimsical tactical tone.
- Validation after polish:
  - `npm run typecheck` ✅
  - `npm run build` ✅
  - `cd services/mythic-api && npm run check` ✅
  - `cd services/mythic-api && npm run test:worldforge` ✅
  - `cd services/mythic-api && npm run test:worldforge:contracts` ✅
  - `npm run test:balance:gate` ✅

## Production Verification (2026-02-22, commit `a1d8758`)
- Deployment synced to `https://mythweaver.online`.
- Post-rollout forge/runtime smoke request IDs:
  - `mythic-create-campaign`: `266ab98f-1e50-4f98-95cc-22ad77e0f71a`
  - `mythic-create-character`: `38a4024d-0345-4a56-aed7-e12ac21bcf60`
  - `mythic-dm-context`: `80d511e5-597d-47a8-9d47-f7440b457cfc`
  - `mythic-dungeon-master`: `8ba858ad-bb46-4331-870a-f2d8dedde790`
  - `mythic-combat-start`: `11a33535-fc20-48bb-89a1-ebdd0b8ebe0e`

## User-Scoped Backfill Execution (2026-02-22)
- Presentation/naming backfill:
  - Dry run: `npx tsx scripts/backfill-mythic-presentation-wordbank.ts --email=strange-ops@cyber-wizard.com --dry-run`
    - campaigns scoped: `1`
    - skills tagged: `8`
  - Apply: `npx tsx scripts/backfill-mythic-presentation-wordbank.ts --email=strange-ops@cyber-wizard.com --yes`
    - campaigns scoped: `1`
    - skills tagged: `8`
- Worldforge profile backfill:
  - Dry run: `npx tsx scripts/backfill-worldforge-profiles.ts --campaign-id=a5f06ec5-a7e7-40dd-bf1a-a012820d79e1 --dry-run`
  - Apply: `npx tsx scripts/backfill-worldforge-profiles.ts --campaign-id=a5f06ec5-a7e7-40dd-bf1a-a012820d79e1 --yes`
    - updated profiles: `1`
    - patched runtime rows: `1`
- Destructive reset not executed in this pass (dry-run only):
  - `npx tsx scripts/reset-mythic-user-campaigns.ts --email=strange-ops@cyber-wizard.com --dry-run`
    - scoped campaign: `a5f06ec5-a7e7-40dd-bf1a-a012820d79e1`

## Post-Backfill Smoke (2026-02-22)
- `npm run smoke:prod` ✅
- `npm run smoke:board` ✅
  - `mythic-create-campaign`: `b2da5de5-bc8d-43d3-b662-4a3d7d22cdc9`
  - `mythic-create-character`: `59d813fd-b4c6-4fe0-91ea-ec96c4fc9cc6`
  - `mythic-dm-context`: `58a94dc4-a491-48fa-80f9-af7a96ed1154`
  - `mythic-dungeon-master`: `4b90397f-823f-43fa-a55e-ff145c4c8ffc`
  - `mythic-runtime-transition:travel`: `3d644f7c-e0c1-43e6-8922-7fc23c23cc71`
  - `mythic-runtime-transition:dungeon`: `cb0afeb5-c226-45db-8bc7-f23914cbc099`
  - `mythic-runtime-transition:town`: `1b439ef5-944a-4d2b-963d-38ec9d489554`
  - `mythic-combat-start`: `4502b303-5560-406e-9979-6c1cc4c696d2`

## Post-Reset Seed Re-Run (After Local Disk Cleanup, 2026-02-22)
- Issue encountered before re-run: local temp-space exhaustion during `mktemp` in post-reset seed smoke.
- Local remediation applied: cleared stale temp/cache artifacts and restored working space.
- Re-ran: `bash scripts/smoke-mythic-board-auth.sh --post-reset-seed` ✅
- Request IDs:
  - `mythic-create-campaign`: `9110d66b-5c74-4410-a014-c26cf1233a7f`
  - `mythic-create-character`: `f791ce51-2801-48db-96f1-79081cb7b8d4`
  - `mythic-dm-context`: `08ee7fa2-193e-45c6-af9e-5e35a46643c6`
  - `mythic-dungeon-master`: `503cf6f5-a8dc-493f-a7dc-d250f09fc99f`
  - `mythic-runtime-transition:travel`: `e7c15746-eec9-4508-8d28-05dd6921ec49`
  - `mythic-runtime-transition:dungeon`: `fbb70f15-0bb3-4653-9518-01748f422dd9`
  - `mythic-runtime-transition:town`: `0e41c56e-7c7e-443a-ae7a-a06a12a23d39`
  - `mythic-combat-start`: `a8538308-6102-473d-a578-ab6ee3263de9`
