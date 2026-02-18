# Production Smoke Test

This checklist validates the production Mythic runtime without debug/test harnesses.

## 1) Build and start

```bash
./scripts/install-deps.sh
npm run lint
npm run typecheck
npm run build
npm run preview
```

Open `http://localhost:4173`.

## 2) Core flow

1. Login with a valid account.
2. Open `Dashboard`.
3. Create a campaign with name and description.
4. Confirm navigation to `/mythic/:campaignId/create-character` or `/mythic/:campaignId`.
5. Confirm campaign appears in campaign list with a health badge.
6. Join a campaign by invite code and confirm terminal state (success or actionable error).

## 3) Mythic board flow

1. Open a campaign in `/mythic/:campaignId`.
2. Verify book layout:
   - left page: narrative and DM interaction
   - right page: active board renderer
3. Send a DM message and confirm either response text or actionable error.
4. Start combat and use a skill.
5. Confirm HP/turn/action log update.
6. Open control panel tabs (Character, Gear, Skills, Loadouts, Progression, Quests) and verify they are scrollable and interactive.

## 4) Failure flow

1. Temporarily disconnect network and trigger:
   - login
   - campaign create
   - DM send
2. Confirm each action exits loading state and shows actionable error text.
3. Reconnect and retry from the same controls.

## 5) Auth gateway incident triage (522)

If auth fails with `auth_gateway_timeout` or `Supabase auth gateway unreachable`:

```bash
curl -i -X POST "https://othlyxwtigxzczeffzee.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<password>"}'
```

Capture:
- HTTP status
- `sb-request-id`
- `cf-ray`

Then check [Supabase Status](https://status.supabase.com/) and retry from an alternate network if 522 persists.
