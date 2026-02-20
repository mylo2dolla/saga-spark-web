# Board Combat Dial-In 2026-02-20

## Scope
- Added guaranteed basic combat actions: `Attack`, `Defend`, `Recover MP`.
- Added ally-team companion turns and team-aware enemy targeting.
- Added HP/MP combat HUD + board delta feedback in board2 combat scene.
- Removed player-facing Loadout entry point (legacy intents still compatible).
- Kept Supabase usage to auth/db; gameplay runtime calls remain VM function calls.

## Pass/Fail Matrix
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npx playwright test tests/game-smoke.spec.ts`: PASS (2/2)
- `./scripts/smoke-vm-functions.sh`: PASS
- `npm run smoke:board`: PASS

## Key VM Request IDs
### smoke-vm-functions (auth-required checks)
- `mythic-combat-start`: `45164889-973f-4481-92b9-b4311c5fd54b`
- `mythic-combat-tick`: `e8d5cda5-fbef-416a-ba5e-01ea7eebe0e7`
- `mythic-combat-use-skill`: `6a194c70-3cd5-4584-9453-9ca2d1b107af`
- `mythic-dm-context`: `0930d330-a9ee-4556-acfb-554846e102ba`
- `mythic-dungeon-master`: `dde3e838-3d6c-4cbd-984f-8e6ab744007f`

### authenticated board smoke
- `mythic-create-campaign`: `fa5eeed5-7058-45e7-98ce-bd6815522dba`
- `mythic-create-character`: `b04892d9-62af-498f-b5ca-600254ae1249`
- `mythic-dm-context`: `1cf35795-60c2-492a-8a63-cf56d2eac215`
- `mythic-dungeon-master`: `2c9eb30c-d412-49e5-9f6a-40a95a2b44f0`
- `mythic-runtime-transition:travel`: `e8f8b863-06f6-44ea-b24b-0c9c8b7ad2bb`
- `mythic-runtime-transition:dungeon`: `5e1f9c9b-4bb6-4119-8992-d87452011bcf`
- `mythic-runtime-transition:town`: `6665c26c-a742-443e-92e5-0ed7c5ec7614`
- `mythic-combat-start`: `a959bd8e-9e7f-47f1-b05e-1551d6da2a4f`

## Companion/Enemy Turn Validation Notes
- Companion combatants are now spawned into combat with ally allegiance (`player_id` set).
- Turn tick logic now runs autonomous turns for companions (`entity_type: summon`) and enemies.
- Targeting is team-aware using allegiance (`player_id` null vs non-null), so enemies can hit companions and companions retaliate.
- Player turn gating remains: player must act on their own turn.

## Known Residuals
- Manual visual QA on a real campaign is still recommended for tuning pacing/target heuristics and board readability polish.
- Core actions are implemented with deterministic baseline math; further per-class balancing can be layered later.
