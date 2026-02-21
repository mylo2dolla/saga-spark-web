# Combat Visual Parity Stage 1 + Stage 2 (2026-02-21)

## Locked Decisions Applied
- Focus: combat visual parity first.
- Visual style: tactical high-contrast.
- Delivery: two-stage lock-in.
- Board model: board-first surface with popup inspect details.
- Motion profile: responsive tactical with strict caps.

## Stage 1 Changes (Combat + Shared Shell)
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/NarrativeBoardPage.tsx`
  - Added a persistent compact top strip with mode, sync, turn owner, pace, and move state.
  - Kept one concise player warning line only.
  - Kept combat rail pinned to board bottom in combat only.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/scenes/CombatScene.tsx`
  - Stronger active-turn and focus readability.
  - Collision-safe tile stack offsets for crowded tiles.
  - HP/MP micro bars + numeric values remain always visible.
  - Compact on-board impact feed (last 5 high-signal entries).
  - Floating delta queue and movement trails now capped and timed.
  - Added pace badge and move state labels for turn clarity.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/BoardInspectCard.tsx`
  - Combat action ordering: `Move Here` -> `Advance` -> attack/cast options -> other actions.
  - Disabled actions now display reason text (for out-of-turn and blocked states).
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/actionBuilders.ts`
  - Added disabled state metadata for combat inspect actions.
  - Enforced combat inspect ordering for miss-click probes.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/types.ts`
  - Added additive `modeStrip` model for shared board shell state.

## Stage 2 Changes (Town / Travel / Dungeon Parity)
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/scenes/TownScene.tsx`
  - Added visible landmark tiles for vendor, notice board, and gate.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/scenes/TravelScene.tsx`
  - Strengthened primary route stroke.
  - Added dashed probe links and segment danger markers.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/scenes/DungeonScene.tsx`
  - Strengthened room/door relation lines.
  - Added distinct feature cue chips for trap/loot/altar/puzzle.
- `/Users/dev/dev-setup/repos/saga-spark-web/src/ui/components/mythic/board2/adapters.ts`
  - Added mode strip data mapping and combat action disable hints.
  - Set combat feed to compact high-signal window.

## Motion / Performance Limits Enforced
- Max simultaneous floating deltas: 8.
- Max floating deltas per token: 2.
- Max movement trails: 6.
- Delta animation lifetime: 650ms-900ms.
- Movement trail fade lifetime: 900ms.
- Turn pulse cycle: 2.2s.
- Reduced-motion preference disables non-essential motion overlays.

## Stage 1 + Stage 2 Validation Matrix
- `npm run typecheck`: pass
- `npm run build`: pass
- `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts tests/combat-visual-parity.spec.ts`: pass (`2 passed`, `3 skipped` gated by campaign env)
- `./scripts/smoke-vm-functions.sh`: pass (auth guard + endpoint reachability checks)
- `npm run smoke:board`: pass
- `npm run smoke:prod`: pass (`2 passed`)

## Smoke Request IDs
- `mythic-create-campaign`: `6261464e-8c0d-4d38-ba41-2d714b75b972`
- `mythic-create-character`: `5eac80a7-8392-497c-bf87-8126bef8eb18`
- `mythic-dm-context`: `5ac5fdae-3255-4dd8-8b7c-fb840264211a`
- `mythic-dungeon-master`: `b7945692-1c01-4652-948b-7c20642187ef`
- `mythic-runtime-transition:travel`: `5d25886c-d0a0-489a-997f-3f0e434b6fe6`
- `mythic-runtime-transition:dungeon`: `36c5c486-afb0-4780-a348-6cb7b77f1036`
- `mythic-runtime-transition:town`: `98f2e9dc-0fdb-4b2d-b4c9-9bc948548aef`
- `mythic-combat-start`: `1c2dae79-e1ed-4776-984b-6d0d4c765f7a`

## Rollback Anchors
- Use current commit before merge as rollback point.
- Right-panel shell remains board-first; no endpoint or VM contract changes in this pass.
