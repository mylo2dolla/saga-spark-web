Original prompt: PLEASE IMPLEMENT THIS PLAN: Mythic 16-Bit Board Overhaul Plan (SNES-Style, PixiJS, Phased)

## Progress Log
- Added Pixi renderer foundation, board V2 types/parser, board viewport, chunk migration, board step/interact edge functions, and Mythic screen integration.
- Current focus: finish combat move + rewards loop, isometric combat UX, and full validation gates.

## TODO (Active)
- Add `mythic-combat-move` edge function and wire to UI.
- Add `mythic-combat-rewards` edge function and wire post-combat rewards page-flip.
- Extend combat events with animation hints.
- Overhaul `MythicCombatPanel` to isometric tactics flow with action picker.
- Run lint/tsc/build/e2e and fix regressions.

## Notes
- `tsc` currently fails on Pixi text style typing in `src/rendering/mythic/UiOverlayLayer.tsx` and is being fixed now.

## Completed This Pass
- Added edge function `supabase/functions/mythic-combat-move/index.ts` with movement budget validation, pathing, blocked/occupied tile checks, append-only movement/wait events, and deterministic turn advance.
- Added edge function `supabase/functions/mythic-combat-rewards/index.ts` with idempotent reward claims, XP/level progression update, deterministic loot grants into `mythic.items` + `mythic.inventory`, reward event logging, and story beat append.
- Extended `supabase/functions/mythic-combat-use-skill/index.ts` event payloads with animation hints and explicit `rewards_ready` + end animation hint on combat termination.
- Replaced `src/hooks/useMythicCombat.ts` with typed skill/move/wait/reward APIs and busy-state handling.
- Rebuilt `src/components/mythic/MythicCombatPanel.tsx` as isometric tactics UI with action picker (Move/Skill/Item/Wait), timeline strip, movement highlights, and animation-hint surface.
- Wired combat move/wait/reward loop in `src/ui/screens/MythicGameScreen.tsx` and added a page-flip rewards panel.
- Hardened dev fetch URL extraction in `src/main.tsx`.
- Added combat/isometric/reward-flip styling in `src/index.css`.

## Validation
- `npm run lint --silent` passed.
- `npx tsc --noEmit -p tsconfig.app.json` passed.
- `npm run build --silent` passed.
- `npm run test:e2e --silent` passed (6/6).

## Remaining TODO
- Hook Item action to an actual consumable-use combat API (currently inventory-guided messaging only).
- Add dedicated e2e assertions for move/wait/reward page-flip flow.
- Add Supabase migration/SQL-level tests for reward idempotency if running database CI.
- Ran `web_game_playwright_client.js` against `/mythic/e2e...` with `VITE_E2E_BYPASS_AUTH=true`; captured `output/web-game/shot-0.png` and verified board canvas renders without runtime crash.
- Visual observation: board interaction loop works, but art density is still minimal/flat and needs richer tile/sprite packs in the next content pass.
