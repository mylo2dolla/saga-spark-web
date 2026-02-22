# Board Render Snapshot + Pixi Lock (2026-02-22)

## Scope
Pixi renderer cutover with deterministic snapshot/event pipeline, while keeping gameplay mechanics VM-authoritative and unchanged.

## Renderer Contract
- Source of truth: `RenderSnapshot` + `VisualEvent[]`
- Consumption flow:
  - `renderer.setSnapshot(snapshot)`
  - `renderer.enqueueEvents(events)`
  - `renderer.tick(dt)`
- Pointer contract preserved:
  - hotspot click -> inspect popup
  - miss click -> probe popup
  - no auto-exec

## Snapshot Schema
Defined in:
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/render/types.ts`

Key fields:
- `board`: type, dimensions, tile size, biome, lighting, deterministic seed
- `tiles[]`: walk/block flags, biome variants, overlays
- `entities[]`: player/enemy/npc/building/prop markers with hp/mp/barrier/status/intent
- `uiOverlays[]`: quest/hook/merchant/healer/danger markers
- `telegraphs[]`: line + AoE indicators
- `effectsQueue`: cursor + visual events

## Visual Event Queue
Builder:
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/render/events/buildVisualEventQueue.ts`

Implemented event types:
- `MoveTrail`, `AttackWindup`, `HitImpact`, `MissIndicator`, `HealImpact`
- `DamageNumber`, `HealNumber`
- `StatusApply`, `StatusApplyMulti`, `StatusTick`
- `BarrierGain`, `BarrierBreak`
- `DeathBurst`, `Downed`
- `TurnStart`, `TurnEnd`
- `BoardTransition`

Queue rules:
- dedupe duplicate signatures in same tick
- status merge to `StatusApplyMulti`
- grouped damage compression (same actor-target sequence)
- deterministic ordering by `tick`, `sequence`, timestamp/id

## Pixi Modules
Added under:
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/render/`

Core modules:
- `BoardRenderer.ts`
- `AssetManager.ts`
- `BiomeSkinRegistry.ts`
- `CameraDirector.ts`
- `TransitionDirector.ts`
- `EntityRenderer.ts`
- `TelegraphRenderer.ts`
- `DevOverlay.ts`
- `Particles/ParticleSystem.ts`
- `FloatingText/FloatingTextSystem.ts`
- `snapshot/buildRenderSnapshot.ts`
- `events/buildVisualEventQueue.ts`
- `index.ts`

## Biome Skins
Implemented:
- `town_cobble_lantern`
- `forest_green_fireflies`
- `dungeon_stone_torch`
- `plains_road_dust`
- `snow_frost_mist`
- `desert_heat_shimmer`

Each skin includes tile palette, ring colors, prop templates, ambient presets, lighting profile, and SFX hooks.

## VFX/Performance Caps
- pooled particles with hard cap (`MAX_PARTICLES=220`)
- pooled floating text (`MAX_FLOATING_TEXT=48`)
- fast mode support for reduced effect cadence and camera intensity
- reduced-motion support in renderer settings

## Fallback Behavior
- missing sprite IDs render deterministic fallback textures from `AssetManager`
- renderer never blocks on missing atlas assets
- board remains interactive with fallback visuals

## Harness + Tests
Harness route:
- `/mythic-render-harness`
- component: `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/screens/MythicRenderHarnessScreen.tsx`

Added tests:
- `/Users/dev/dev-setup/repos/saga-spark-web/tests/board-render-snapshot.spec.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/tests/combat-visual-events.spec.ts`

## Validation
- `npm run typecheck` ✅
- `npm run build` ✅
- `npx playwright test tests/board-render-snapshot.spec.ts tests/combat-visual-events.spec.ts` ✅
- broader playwright suite (core + presentation + harness) ✅ (env-gated skips unchanged)
- `./scripts/smoke-vm-functions.sh` ✅
- `npm run smoke:board` ✅
- `npm run smoke:prod` ✅

### Latest Auth Board Smoke Request IDs
- `mythic-create-campaign`: `1a24224a-841f-4ee2-8592-e6f794b7ae6a`
- `mythic-create-character`: `3264928d-f931-4fdc-a095-72cb3c4eac5e`
- `mythic-dm-context`: `89551851-56db-4828-8121-72c18e5f50fa`
- `mythic-dungeon-master`: `db5d937e-dff6-4731-87aa-82ace0dadbd1`
- `mythic-runtime-transition:travel`: `7d4b86b5-38a3-4478-81ba-4a3be4955e60`
- `mythic-runtime-transition:dungeon`: `a3784916-617c-44dc-8f93-70c63868654c`
- `mythic-runtime-transition:town`: `a484f977-6bbe-4cc1-8361-ade539fb160f`
- `mythic-combat-start`: `89d790a1-f51d-4923-ab92-53f38f44c429`

### Post-Deploy Auth Board Smoke Request IDs (2026-02-22T11:33:23Z)
- `mythic-create-campaign`: `50aac798-bdfb-4008-8371-4cd89eb9f03a`
- `mythic-create-character`: `139bd1f7-d9c2-4d56-8810-8268a3ffbff8`
- `mythic-dm-context`: `e4171d32-1b0b-4ad8-8480-47c4f45dd67c`
- `mythic-dungeon-master`: `ae243d6a-007c-4a7b-b53c-d2eaacec2c81`
- `mythic-runtime-transition:travel`: `ea476775-86d4-4c31-8176-f6e13a02c243`
- `mythic-runtime-transition:dungeon`: `8db69fd3-ad41-4ed4-b39f-f78cfe3f1607`
- `mythic-runtime-transition:town`: `2b3071bd-d71d-4e4e-a230-4ac651a3fb40`
- `mythic-combat-start`: `0a874837-edd6-4580-aaf4-5942b42b110b`

### Lock-In Verification Update (2026-02-22)
- Renderer default flip completed: fallback renderer now defaults to Pixi while preserving env/canary/local override controls.
- Full validation rerun after flip:
  - `npm run typecheck` ✅
  - `npm run build` ✅
  - Playwright matrix in plan scope ✅
  - `./scripts/smoke-vm-functions.sh` ✅
  - `npm run smoke:board` ✅
  - `npm run smoke:prod` ✅
- Latest auth board smoke request IDs:
  - `mythic-create-campaign`: `80b48289-1e5a-4df2-a599-f8c64237b2be`
  - `mythic-create-character`: `f4223898-c1cb-4d5e-8fe5-5e4a1a01b8a7`
  - `mythic-dm-context`: `43bbc5c0-33d9-4164-898a-c207ccbd460f`
  - `mythic-dungeon-master`: `2934a239-dc89-4566-a425-91b14462d4af`
  - `mythic-runtime-transition:travel`: `9343518e-f49b-47ec-bc28-a90028650275`
  - `mythic-runtime-transition:dungeon`: `d277ed8c-d5f2-4938-b3d7-fc48b98a826b`
  - `mythic-runtime-transition:town`: `6dbeeb44-c127-4efe-9e1b-65d624c07728`
  - `mythic-combat-start`: `a8856eec-ed79-4c39-a3bf-e8fabfab1967`

### Final Production Rollout Update (2026-02-22, commit `a1d8758`)
- Pixi default fallback remains active with override/canary controls intact.
- Production alias: `https://mythweaver.online`
- Post-rollout auth board smoke request IDs:
  - `mythic-create-campaign`: `266ab98f-1e50-4f98-95cc-22ad77e0f71a`
  - `mythic-create-character`: `38a4024d-0345-4a56-aed7-e12ac21bcf60`
  - `mythic-dm-context`: `80d511e5-597d-47a8-9d47-f7440b457cfc`
  - `mythic-dungeon-master`: `8ba858ad-bb46-4331-870a-f2d8dedde790`
  - `mythic-runtime-transition:travel`: `e5a05286-0025-453d-a75a-12a6c94d1946`
  - `mythic-runtime-transition:dungeon`: `293cc64b-c22a-4726-bf40-0e8d35c92e68`
  - `mythic-runtime-transition:town`: `558bc567-4737-4999-a7e6-6d91dda430a1`
  - `mythic-combat-start`: `11a33535-fc20-48bb-89a1-ebdd0b8ebe0e`

## One-Panel UX Lock-In Update (2026-02-22)
- Mythic gameplay shell moved from split-book layout to one-panel board-first layout.
- Added compact top DM overlay (latest line only) + expandable transcript drawer.
- Added sticky bottom command bar (typed-first path unchanged, slash support unchanged).
- Renderer fit/camera now uses adaptive contain with safe top/bottom insets and themed backdrop fill.
- Validation:
  - `npm run typecheck` ✅
  - `npm run build` ✅
  - `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts tests/combat-visual-parity.spec.ts tests/mythic-one-panel-layout.spec.ts` ✅
  - `./scripts/smoke-vm-functions.sh` ✅
  - `npm run smoke:board` ✅
  - `npm run smoke:prod` ✅
- Latest auth board smoke request IDs:
  - `mythic-create-campaign`: `32663d13-94f9-4285-a833-82a59fb54002`
  - `mythic-create-character`: `18ca2b72-ead4-49f2-952a-94aecc7241b1`
  - `mythic-dm-context`: `044ae600-af98-4b92-8cb1-01923beb8748`
  - `mythic-dungeon-master`: `abaf07b1-84b3-4035-a661-971db16dcfc5`
  - `mythic-runtime-transition:travel`: `467bb3e0-12d3-4c44-b102-30e9f256a909`
  - `mythic-runtime-transition:dungeon`: `3080fc4b-8968-4dfe-8181-272331b2ad21`
  - `mythic-runtime-transition:town`: `b56afde7-825d-46f3-af78-4e8859f8e05f`
  - `mythic-combat-start`: `2585ed46-ccee-4865-acd9-380387134797`
