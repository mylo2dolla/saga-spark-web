Original prompt: Side Quest + Next Features: Character Forge Unblock, Then OpenAI Voice + Action Chips + Map Tap Shop

## 2026-02-17
- Fixed Mythic town board tap -> inspect -> shop wiring (frontend + edge functions were added earlier; this pass finished MythicGameScreen integration).
- Build gates: `npm run lint`, `npm run typecheck`, `npm run build` are green.

### Remaining TODOs
- Deploy edge functions to Supabase: DONE (2026-02-17)
  - `mythic-dungeon-master`
  - `mythic-create-character`
  - `mythic-field-generate`
  - `mythic-tts`
  - `mythic-shop-stock`
  - `mythic-shop-buy`
- Manual smoke:
  - Tap vendor in Town scene -> Inspect dialog -> Shop -> Buy -> verify coins decrement + inventory insert + persistence after reload.
  - DM action chips with `intent:"shop"` open the shop and do not crash when vendorId is missing.
