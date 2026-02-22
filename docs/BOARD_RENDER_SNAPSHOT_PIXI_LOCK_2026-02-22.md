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
