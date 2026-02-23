# Saga Spark iPad Integration Verification

## Required Runtime Values
- `SUPABASE_URL` (project URL, `https://<project>.supabase.co`)
- `SUPABASE_ANON_KEY` (public anon key only; never service-role in app)
- `MYTHIC_FUNCTIONS_BASE_URL` (VM host root or `/functions/v1` base, not `*.supabase.co`)
- `SUPABASE_REDIRECT_URL` (default: `sagasparkpad://auth/callback`)
- `APP_ENV` (`dev`, `staging`, `prod`)
- Optional:
  - `DEFAULT_CAMPAIGN_ID`
  - `LEVELUPKIT_ENABLE_DEV_QUICKSTART`
  - `LEVELUPKIT_FORCE_DEV_QUICKSTART`
  - `LEVELUPKIT_ENABLE_ANONYMOUS_AUTH`

## Local Config Workflow
1. Ensure `/Users/dev/dev-setup/repos/saga-spark-web/.env.local` contains:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_MYTHIC_FUNCTIONS_BASE_URL`
   - Optional `VITE_SAGASPARK_APP_ENV`
2. Generate iOS runtime config:
   - `bash /Users/dev/dev-setup/repos/saga-spark-web/scripts/sync-ios-runtime-env.sh`
3. Confirm generated file exists:
   - `/Users/dev/dev-setup/repos/saga-spark-web/apps/SagaSparkPad/Config/SagaSparkPad.local.xcconfig`

## Build Verification
1. Package compile:
   - `swift build --package-path /Users/dev/dev-setup/repos/levelupkit/lvlupkit.package --target LvlUpKitSagaSparkPad`
2. Simulator compile (no signing):
   - `xcodebuild -project /Users/dev/dev-setup/repos/saga-spark-web/apps/SagaSparkPad/SagaSparkPad.xcodeproj -scheme SagaSparkPad -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build`
3. Device compile (no signing):
   - `xcodebuild -project /Users/dev/dev-setup/repos/saga-spark-web/apps/SagaSparkPad/SagaSparkPad.xcodeproj -scheme SagaSparkPad -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build`

## Backend Path Verification
1. VM function availability:
   - `bash /Users/dev/dev-setup/repos/saga-spark-web/scripts/smoke-vm-functions.sh`
2. Auth + campaign + forge + DM path:
   - `bash /Users/dev/dev-setup/repos/saga-spark-web/scripts/smoke-mythic-board-auth.sh`

## In-App Acceptance Flow
1. Launch app.
2. Confirm AuthGate behavior:
   - If no session, login/auth screen appears.
   - If valid stored session exists, campaign view opens automatically.
3. Execute one-tap path:
   - Tap `Play Online`.
   - Confirm campaign resolves/creates and forge succeeds.
   - Enter tome.
4. Run Diagnostics screen:
   - Validate environment, auth user id, network event list, connectivity checks.

## Test User Creation
- Password auth can be created directly in app (`Sign Up`) or via Supabase Auth dashboard.
- For CLI smoke users, `scripts/smoke-mythic-board-auth.sh` creates and cleans temporary users.

## Expected API Surfaces and Responses
- `mythic-list-campaigns`:
  - Request: `{}` (POST, auth required)
  - Response: `{ ok: true, campaigns: [{ id, invite_code, owner_id, is_active, updated_at, member_count, ... }] }`
- `mythic-create-campaign`:
  - Request includes `template_key` (snake_case)
  - Response: `{ ok: true, campaign: { ... }, warnings?: [] }`
- `mythic-join-campaign`:
  - Request: `{ inviteCode }`
  - Response: `{ ok: true, campaign: { ... }, already_member: boolean }`
- `mythic-create-character`:
  - Invalid campaign should return HTTP `400`, `code=invalid_request`, `details.fieldErrors.campaignId`.
- `mythic-dungeon-master`:
  - Request: `{ campaignId, messages, actionContext?, narratorMode? }`
  - Response: SSE stream (`text/event-stream`).

## Failure Modes and Debug Actions
- `400 invalid_request` on forge:
  - Usually invalid/non-UUID `campaignId`.
  - App auto-recovers by refreshing campaign selection and retrying once.
  - Check diagnostics for `lastForgeRequestID` and `lastForgeErrorCode`.
- `401 auth_required`:
  - Session missing/expired.
  - Re-login and confirm `Authorization: Bearer <token>` is attached by runtime.
- `403` RLS failures:
  - Capture exact table/query and policy scope.
  - Typical query surfaces:
    - `public.profiles` via `/rest/v1/profiles?...`
    - `public.chat_messages` via `/rest/v1/chat_messages?...`
    - `public.world_events` via `/rest/v1/world_events?...`
    - `mythic.runtime_events` via `/rest/v1/runtime_events?...` with `Accept-Profile: mythic`
  - Suggested policy checks (do not mutate backend from app):
    - `profiles`: auth user must satisfy insert/update policy on `user_id`.
    - `chat_messages/world_events`: auth user must satisfy campaign membership policy.
    - `runtime_events`: schema/table grants and profile header must match exposed schema.
- VM unreachable / DNS / TLS:
  - Diagnostics `VM Functions Reachability` fails.
  - Re-check `MYTHIC_FUNCTIONS_BASE_URL` and VM deployment health.

## Unit Tests Added
- Campaign snake_case payload decode path.
- DM SSE narration parse path.
- Edge/network invalid_request mapping with field error + request id.
