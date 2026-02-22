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
