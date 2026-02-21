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

## Production Deploy
- Commit: `78a6199`
- Frontend (Vercel):
  - URL: `https://saga-spark-7yng5r35d-mylo2dollas-projects.vercel.app`
  - Alias: `https://mythweaver.online`
  - Deployment ID: `dpl_6TfSMqEDSAqb5ds8hbn82d58EbQh`
  - Created: `Sat Feb 21 2026 07:09:28 GMT-0700 (MST)`
- VM runtime:
  - Host: `api.mythweaver.online`
  - Path: `/opt/mythic-api`
  - Deploy method: `docker compose up -d --build --force-recreate`
  - Health check: `GET /healthz` success

## Smoke Request IDs (Post-Deploy)
- `mythic-create-campaign`: `cbeff8dc-0e91-46ea-8ce7-04c97d787ea8`
- `mythic-create-character`: `0df1fcea-4c98-461b-bd83-dee1fdfc3609`
- `mythic-dm-context`: `b7600973-90ca-4ca9-876a-45cdb919a6df`
- `mythic-dungeon-master`: `f82856c7-2fe4-4c6f-bf31-05385fae7f6e`
- `mythic-runtime-transition:travel`: `8df93c5a-50a6-410f-956f-7a8255e42d08`
- `mythic-runtime-transition:dungeon`: `6219f0d7-4925-433c-a16a-0eec5a032606`
- `mythic-runtime-transition:town`: `1257de5e-01cd-483d-957d-f6b1137602b2`
- `mythic-combat-start`: `b0a5efe8-791a-4913-bc85-dccb0108ca0a`
