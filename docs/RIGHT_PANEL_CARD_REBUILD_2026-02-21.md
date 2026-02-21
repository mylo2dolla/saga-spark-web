# Right Panel Card/Popup Rebuild (2026-02-21)

## Scope
This pass rebuilt the right side into a stable 3-zone board-first layout:
1. Dynamic top hero.
2. Always-visible board viewport.
3. Minimal card dock with tap/click detail surfaces.

Supabase remains auth/db only. Gameplay runtime stays VM-hosted.

## Old vs New

### Old structure (problem)
- Top banner + metrics strip.
- Scene-level stacks (legend, summaries, combat control cards) inside viewport.
- Bottom inspect/actions split.
- Result: visual chunking and overlap pressure, especially in combat.

### New structure
- Top: `RightPanelHero` with mode/status/objective, HP/MP, sync/context, and one primary warning.
- Middle: viewport-only board scene with inspect-first interactions preserved.
- Bottom: `BoardCardDock` with 4 core cards (`Inspect`, `Actions`, `Scene`, `Feed`) plus optional `More`.
- Details: desktop popover, mobile drawer (`BoardCardDetailSurface`).

## Components Added
- `src/ui/components/mythic/board2/RightPanelHero.tsx`
- `src/ui/components/mythic/board2/BoardCardDock.tsx`
- `src/ui/components/mythic/board2/BoardCardDetailSurface.tsx`

## Core Wiring Changes
- `src/ui/components/mythic/board2/NarrativeBoardPage.tsx`
  - Replaced old top metrics/banner + bottom split with hero + card dock.
  - Kept inspect-first board flow and explicit confirm actions.
  - Added single-open-card behavior.
- `src/ui/screens/MythicGameScreen.tsx`
  - Removed standalone `CharacterMiniHud` from right page.
  - Passes character/combat snapshot data into `NarrativeBoardPage` hero.
  - Hero opens existing `CharacterSheetSurface`.

## Scene Simplification
Reduced scene visual density so the board remains primary:
- `src/ui/components/mythic/board2/scenes/TownScene.tsx`
- `src/ui/components/mythic/board2/scenes/TravelScene.tsx`
- `src/ui/components/mythic/board2/scenes/DungeonScene.tsx`
- `src/ui/components/mythic/board2/scenes/CombatScene.tsx`

Highlights:
- Removed stacked summary/legend sections from scene viewport surfaces.
- Kept tactical overlays (travel route, dungeon edges, combat impact markers).
- Combat token labels compacted to prevent spill/overlap.

## Adapter + Type Additions (Non-Breaking)
- `src/ui/components/mythic/board2/types.ts`
  - Added `NarrativeHeroModel`.
  - Added `NarrativeDockCardModel`.
  - Added `NarrativeFeedItem`.
  - Added scene model fields: `hero`, `cards`, `feed`.
- `src/ui/components/mythic/board2/adapters.ts`
  - Maps runtime/context metrics into hero chips.
  - Builds mode-specific `Scene` card summaries.
  - Builds feed rows from combat deltas or ambient scene state.
  - Builds `More` card from metrics/legend/warnings/context-source.

## Interaction Contract Guarantees
- Hotspot click opens inspect state first.
- Miss-click opens probe inspect state only.
- No board click auto-executes actions.
- Action precedence unchanged:
  - inspect actions
  - assistant `ui_actions`
  - unresolved runtime `action_chips`
  - companion follow-up
  - fallback actions

## Card Behavior
- Desktop: anchored popover.
- Mobile: bottom drawer.
- Only one detail surface open at a time.
- Core cards always visible: `Inspect`, `Actions`, `Scene`, `Feed`.
- `More` card appears when extra detail payload is present.

## Post-Fix Interaction Status
- Quick-card click dead-state regression resolved.
- Root cause: dock trigger component did not forward trigger props/ref required by `PopoverTrigger`/`DrawerTrigger` with `asChild`.
- Fix: trigger now uses `forwardRef` and spreads injected trigger props onto native `button`.
- Added stable card trigger test IDs: `board-card-trigger-inspect|actions|scene|feed`.

## Dev-Surface Gating Summary
- Added feature flag gate: `VITE_MYTHIC_DEV_SURFACES`.
- Default behavior is player-facing:
  - logs/diagnostics tabs hidden
  - technical warning fragments hidden
  - inspect/source/meta internals hidden
- When env allows and user toggles developer surfaces on, technical detail is visible again without changing runtime behavior.

## QA Matrix

### Automated
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npx playwright test tests/game-smoke.spec.ts`: PASS (2/2)
- `npm run smoke:board`: PASS

### Authenticated board smoke request IDs
- `mythic-create-campaign`: `a62c6d65-a4f6-4f28-b607-fb5f56cc9ca0`
- `mythic-create-character`: `cad51ad7-7d6b-4993-8ad3-9d7c81621c0d`
- `mythic-dm-context`: `a02f7689-299a-47dd-9e5a-6277121e6d8c`
- `mythic-dungeon-master`: `9021ab86-b0b3-4da9-8373-ef56ccc3ea2a`
- `mythic-runtime-transition:travel`: `1add4629-d386-4ee4-a624-c94088087b2e`
- `mythic-runtime-transition:dungeon`: `87f738b2-9905-48da-8740-3654580cf591`
- `mythic-runtime-transition:town`: `fdce16ac-34f7-4cb3-aa40-f1dfca846d3d`
- `mythic-combat-start`: `a0fdbff8-59b3-4f53-86be-ef6aa3cef6de`

## Residual Notes
- DM/runtime contracts were not modified.
- Legacy panel/action compatibility remains intact.
- Additional visual polish can be layered later without changing board action semantics.

## Superseded By Board-Only Pass
Later on 2026-02-21, player mode switched to a stricter board-only right panel:
- card dock is no longer the default player render path,
- inspect detail remains popup-first on top of the board,
- combat actions are delivered via combat rail overlay.

Reference: `docs/BOARD_PLAYER_SHEET_LATENCY_PASS_2026-02-21.md`.
