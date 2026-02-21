# Combat Movement Parity (2026-02-21)

## Scope Shipped
- Added authoritative combat movement action support with built-in `basic_move`.
- Added move event contract support by extending `mythic.action_events` constraint with `moved`.
- Added AI move-before-attack behavior for companions/enemies when out of range.
- Wired companion command bias (`focus`, `protect`, `harry`, `hold`) into combat tick target/skill choice.
- Removed hardcoded enemy naming and normalized unique naming for player/companions/enemies.
- Added board inspect movement actions (`Move Here`, `Advance on Target`) routed through combat use-skill.
- Added combat delta parsing/visual feedback for movement events.
- Cut over canonical DM/UI intent routing to `open_panel` (legacy `loadout_action` normalized on ingress only).
- Removed dead player-facing loadout UI paths from `MythicGameScreen`.

## API / Contract Changes
- Additive API:
  - `/functions/v1/mythic-combat-use-skill` accepts built-in `skillId: "basic_move"`.
- Additive DB contract:
  - `moved` now allowed in `mythic.action_events` event type constraint.
- Canonical intent contract:
  - `open_panel` is canonical.
  - Legacy `loadout_action|loadout|gear` is accepted as ingress alias and normalized to `open_panel`.

## Companion Command Bias (Combat Tick)
- `focus`: prefers hinted or low-HP focus target.
- `protect`: prioritizes nearby threats and defensive posture.
- `harry`: aggressive chase/pressure behavior.
- `hold`: lower chase and defensive preference.

## Legacy Mapping Cutover
- `open_panel:loadout|loadouts -> skills`
- `open_panel:gear -> equipment`
- `loadout_action` ingress -> `open_panel` (canonicalized before render/execution)
- No player-facing loadout panel remains in utility/menu controls.

## Validation Results
- `npm run typecheck`: pass
- `npm run build`: pass
- `npx playwright test tests/game-smoke.spec.ts`: pass
- `npx playwright test tests/right-panel-cards.spec.ts`: skipped (requires `PLAYWRIGHT_MYTHIC_CAMPAIGN_ID`)
- `./scripts/smoke-vm-functions.sh`: pass (auth gate checks all expected `401 auth_required`)
- `npm run smoke:board`: pass
- `npm run smoke:prod`: pass

## Smoke Request IDs (Board Auth Smoke)
- `mythic-create-campaign`: `d8aa483f-6620-4cb1-be15-9d3bbfd4cd80`
- `mythic-create-character`: `6493b98f-5b57-4dbf-8552-9be515453dc0`
- `mythic-dm-context`: `17faa624-0ff6-4df3-a649-3c607e2789f9`
- `mythic-dungeon-master`: `e118340a-24f1-49dd-92f9-02d1ce286fbe`
- `mythic-runtime-transition:travel`: `8087660d-908b-4059-b861-ff542c59a264`
- `mythic-runtime-transition:dungeon`: `0812dc6f-f755-4c28-b570-4121144ee200`
- `mythic-runtime-transition:town`: `652658a7-6b41-426a-8362-cb0da7d247d8`
- `mythic-combat-start`: `0b88603e-500d-4788-aabe-57fc1ad85422`
