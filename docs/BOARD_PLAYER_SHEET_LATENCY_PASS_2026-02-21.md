# Board + Player Sheet + DM Latency Pass (2026-02-21)

## Scope
This pass shipped three linked outcomes without breaking runtime contracts:

1. Right panel is now board-first player UI (inspect popup + combat rail), with no stacked hero/card-feed as the default render path.
2. Menu-centered character sheet now presents six sections: `Overview`, `Combat`, `Skills`, `Equipment`, `Party`, `Quests`.
3. DM call path uses compact prompt context and streaming parse, with earlier deterministic recovery on validation churn.

Supabase remains auth/db only. Gameplay calls stay VM-hosted.

## Right Panel Contract (Before -> After)
- Before: right-side hero + card dock + detail stack competing with viewport.
- After: board-only strict surface:
  - board viewport always visible,
  - hotspot/miss-click opens inspect popup,
  - explicit action click required to execute,
  - combat-only rail overlays `Attack`, `Defend`, `Recover MP` and expandable skill cast list.

## Character Surface Contract
- Character controls are menu-centered via unified sheet overlay.
- Sections available:
  - `Overview`
  - `Combat`
  - `Skills`
  - `Equipment` (equip/unequip + stat delta indicators)
  - `Party` (inspect + stance/directive command submit)
  - `Quests`
- Skill availability is no longer loadout-gated in player UX.
- Backend loadout compatibility remains intact.

## Legacy Compatibility Mappings
- `loadout_action` remains accepted and routes to `skills`.
- Legacy panels remap as follows:
  - `open_panel:character` -> sheet `overview`
  - `open_panel:gear` -> sheet `equipment`
  - `open_panel:loadout|loadouts` -> sheet `skills`
  - `open_panel:companions` -> sheet `party`
- Additive runtime transition payload now accepted:
  - `payload.companion_command = { companion_id, stance, directive, target_hint? }`

## DM Latency Guardrails
- Prompt payload compaction added (bounded inline JSON slices + bounded message history).
- Internal OpenAI stream path now used for completion read/parse.
- Validation retry ceiling tightened for earlier deterministic recovery (`maxAttempts=2`).
- Existing stale-stream/ordering protections remain active in client hook.

## Validation Matrix
- `npm run typecheck` -> PASS
- `npm run build` -> PASS
- `npx playwright test tests/game-smoke.spec.ts tests/right-panel-cards.spec.ts` -> PASS (`right-panel-cards` skipped without `PLAYWRIGHT_MYTHIC_CAMPAIGN_ID`)
- `./scripts/smoke-vm-functions.sh` -> PASS
- `npm run smoke:board` -> PASS
- `npm run smoke:prod` -> PASS

## Smoke Request IDs (Authenticated Board Run)
- `mythic-create-campaign` -> `81fac1ca-0733-42fa-8394-21ffcc4db0e9`
- `mythic-create-character` -> `b20560ea-24aa-4edb-97f0-29d3a9d5deb0`
- `mythic-dm-context` -> `37dbabdb-5e0a-4edd-892f-839f6508782a`
- `mythic-dungeon-master` -> `5189f41e-da78-47bc-bb83-889ba3de2ca9`
- `mythic-runtime-transition:travel` -> `9179745f-72fe-4671-9e47-825550f99f60`
- `mythic-runtime-transition:dungeon` -> `556e7a07-9dcb-4478-b5a1-1c69219d124f`
- `mythic-runtime-transition:town` -> `b9325a31-a488-4923-bb7f-210e99ee24cb`
- `mythic-combat-start` -> `126d5e4e-6276-457c-8394-b2e18fca4ecc`

## Residual Notes
- The right-panel Playwright popup test is campaign-dependent and skips unless `PLAYWRIGHT_MYTHIC_CAMPAIGN_ID` is set.
- Existing backend endpoint names and response envelopes remain unchanged.

## Deploy Lock
- Git commit: `67c9365`
- Frontend (Vercel prod):
  - Inspect ID: `GDjawQMewp4GBSzN2ELU1hwnX982`
  - Production URL: `https://saga-spark-l1j25ibna-mylo2dollas-projects.vercel.app`
  - Alias: `https://mythweaver.online`
  - Deploy time (UTC): `2026-02-21T02:25:48Z`
- VM runtime:
  - Host: `api.mythweaver.online`
  - Path: `/opt/saga-spark-web/services/mythic-api`
  - Deploy mode: rsync sync + `docker compose up -d --build --force-recreate`
  - Health check: `http://127.0.0.1/healthz` pass after recreate
