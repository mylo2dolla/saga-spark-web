# Typed-Primary DM + Opening Cleanup + Voice + Town Readability Lock (2026-02-22)

## Summary
This pass locks four user-facing corrections together:

1. Opening/recovery narration now stays player-facing and strips engine/system phrasing.
2. Typed input is now the primary path for non-slash text (`dm_prompt`), with chips as optional suggestions.
3. DM voice default is now male (`alloy`) with a visible in-game selector.
4. Town board readability is de-cluttered via sparse NPC token labeling and occupancy-aware placement.
5. Combat narration parity now uses mutation-cursor event batches so stale/dead-actor events do not get re-narrated.

## Before/After

### Narration
- Before:
  - Recovery could emit system-like lines (for example: hard-state/pressure boilerplate).
  - Internal command/action tokens could leak into narration.
- After:
  - Final narration is sanitized with a non-player phrase blocklist.
  - Intro/recovery fallback uses player-facing tactical prose and context hooks.

### Typed Input Contract
- Before:
  - Non-slash text passed through parser intents and could surface `command:unknown` traces.
- After:
  - Non-slash text is always freeform `dm_prompt`.
  - Action id for freeform is canonical `typed-freeform`.
  - Slash commands remain the explicit mechanical path.

### Voice
- Before:
  - Default DM voice preference was `nova`.
  - No selector in Mythic settings panel.
- After:
  - Default DM voice preference is `alloy` (male).
  - Selector exposed in settings: `alloy`, `verse`, `nova`, `aria`.
  - Browser fallback tries to choose a male/female voice family matching selected profile.

### Town Board Readability
- Before:
  - NPC token content was dense and collided with major hotspot labels.
  - Vendor subtitle text could expose internal service identifiers.
- After:
  - NPC tokens render short-name only on board; detail is inspect-first.
  - Occupancy-aware placement avoids landmark collisions.
  - Vendor subtitles are humanized and stripped of internal identifiers.

## Narration Sanitization Blocklist
The player-facing narration sanitization removes or suppresses patterns including:

- `command:unknown`
- `opening move`
- `board answers with hard state`
- `committed pressure lines`
- `commit one decisive move and keep pressure on the nearest fault line`

## Request IDs (Smoke)
- `smoke:board`:
  - `mythic-create-campaign`: `ea047fbe-edd5-471d-8fea-20d5546e88c9`
  - `mythic-create-character`: `6c980b3d-9c7b-4b49-91d2-94360d3cb656`
  - `mythic-dm-context`: `8ded9e51-cf1d-430f-b16b-0a2324e30d48`
  - `mythic-dungeon-master`: `5b8a5dbd-af92-4ea9-b35b-1d47160aa600`
  - `mythic-runtime-transition:travel`: `f14a2d52-52d3-462c-8b65-f79c109a0413`
  - `mythic-runtime-transition:dungeon`: `302c0c8b-3dbc-4fbe-b2e3-388eee9fad75`
  - `mythic-runtime-transition:town`: `ba54de78-190e-4083-b5b9-3cbd305b6122`
  - `mythic-combat-start`: `be6070a0-3b76-46de-97fc-3a17bf595e97`

- `smoke-vm-functions`:
  - `mythic-combat-use-skill`: `299c8e47-359b-43e9-835b-6784b910c410`
  - `mythic-combat-tick`: `37b31c02-3abc-40c1-b3e8-83a5b449feb3`
  - `mythic-dungeon-master`: `8bbb5285-e7a6-4b3f-8d0c-72651dad4021`
  - `mythic-runtime-transition`: `f747fb17-dcff-461f-96ff-05c26f8a24d4`

- `smoke:prod`:
  - `tests/prod-smoke.spec.ts`: both tests passed on 2026-02-22 local run

## Notes
- No API endpoint names were changed.
- No DB schema migration was required for this specific pass.
- Supabase remains auth/db; gameplay runtime remains VM functions.

## 2026-02-22 Addendum
- Slash-command fallback no longer emits `command:unknown`; unknown slash text routes to `dm_prompt`.
- `useMythicDmVoice` edge-TTS fallback now defaults to `alloy` instead of `nova`.
- Town board clutter pass tightened:
  - Town hotspot subtitles hidden in the board overlay.
  - Landmark reserve padding increased to reduce NPC/landmark overlap collisions.
- Character forge review surface no longer shows concept compaction messaging.
