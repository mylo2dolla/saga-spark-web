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
