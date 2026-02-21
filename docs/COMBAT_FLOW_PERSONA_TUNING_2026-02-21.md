# Combat Flow + DM Persona Tuning (2026-02-21)

## Scope
This pass delivered both workstreams together:
1. Combat flow rhythm/readability tuning.
2. DM personality/voice tightening on top of existing latency safeguards.

Supabase remains auth/db only. Gameplay runtime remains VM-hosted.

## Combat Flow Changes

### UI rhythm/readability
- `src/ui/components/mythic/board2/scenes/CombatScene.tsx`
  - Added active-turn cue strip (`Your Turn` / `Ally Turn` / `Enemy Turn`) with pulsing progress bar.
  - Added movement trail rendering from recent `moved` events (line + destination marker).
  - Added stacked-token positional offsets when multiple units share a tile to reduce overlap.
  - Kept compact HP/MP token bars and recent delta indicators, with improved immediate readability.

### Turn flow pacing
- `src/ui/screens/MythicGameScreen.tsx`
  - Non-player turn automation now batches up to `3` steps per auto tick (`AUTO_TICK_MAX_STEPS = 3`) instead of single-step churn.
  - Auto-tick narration prompt now focuses on concise movement/damage/status pressure summary.
  - Added context fields for batch tick metadata (`auto_tick_batch`, `max_steps`, `turn_advance`, `requires_player_action`).

## DM Persona Changes
- `services/mythic-api/src/functions/mythic-dungeon-master.ts`
  - Expanded style directives for stronger second-person pressure voice and tactical closing hooks.
  - Strengthened action-label contract language (verb + concrete board object).
  - Added explicit rule to avoid generic prompt shells (`continue/proceed/advance`).
  - Improved deterministic recovery narration with board anchor + companion check-in integration.
  - Refined recovery action labels to be sharper/more concrete (`Breach The Next Door`, `Pressure Priority Target`, etc.).

## Validation
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `services/mythic-api`: `npm run check`, `npm run build`: PASS
- `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts`: PASS (`right-panel-cards` skipped without campaign env)
- `./scripts/smoke-vm-functions.sh`: PASS
- `npm run smoke:board`: PASS
- `npm run smoke:prod`: PASS

## Smoke Request IDs
- `mythic-create-campaign`: `10d2fc5f-0b18-4bcc-b5d6-e813643be4ff`
- `mythic-create-character`: `21115c86-e19f-40d5-8284-0e3a04e26cd0`
- `mythic-dm-context`: `a588f02a-1b77-4d53-b617-6f6b16211da5`
- `mythic-dungeon-master`: `7c851f9c-202c-4cfb-b49a-7d236daa54f1`
- `mythic-runtime-transition:travel`: `5c29a9fc-eb39-4d72-8d62-4ac466cb7162`
- `mythic-runtime-transition:dungeon`: `d0f0e660-cf2e-4467-92fc-43f0ef30e698`
- `mythic-runtime-transition:town`: `abf41aea-a24f-4afb-b808-d442e719fbed`
- `mythic-combat-start`: `569ba792-32e0-4cc2-a2ef-d86bb02d63b4`
