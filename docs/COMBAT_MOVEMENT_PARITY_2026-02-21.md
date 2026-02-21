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

## Production Deployment Lock
- Frontend (Vercel prod):
  - URL: `https://mythweaver.online`
  - Deployment URL: `https://saga-spark-ijbis8bid-mylo2dollas-projects.vercel.app`
  - Deployment ID: `dpl_G6QZWx1KtQC6JzPY9D4rF354eqYy`
  - Created (local CLI output): `Fri Feb 20 2026 21:09:25 GMT-0700`
- VM runtime:
  - Host: `api.mythweaver.online`
  - Deploy method: `docker compose up -d --build --force-recreate`
  - Post-restart health: `GET /healthz` success

## Smoke Request IDs (Board Auth Smoke)
- `mythic-create-campaign`: `133973e6-2be2-4e46-ae25-c8552ca8e638`
- `mythic-create-character`: `ee8ef1f9-721c-4b05-9c8d-dbba05f3138f`
- `mythic-dm-context`: `66aac35b-34bf-40da-9daa-b864ccaba48f`
- `mythic-dungeon-master`: `97633756-9dbc-4339-b409-df6693258c6e`
- `mythic-runtime-transition:travel`: `45354dff-0f05-4c9e-962e-065a1f124d12`
- `mythic-runtime-transition:dungeon`: `b94551ba-6f30-42dc-b4c3-2d26268d8804`
- `mythic-runtime-transition:town`: `47188cc8-3ea3-4137-9d50-6a263aab513f`
- `mythic-combat-start`: `0f0f2735-abde-46d1-a5ef-aa78c893c934`
