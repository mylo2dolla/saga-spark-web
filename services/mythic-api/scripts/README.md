# Mythic API Curl Smoke (VPS)

These scripts hit the self-hosted Mythic API using a **real Supabase access token**.

## 1) Get a Supabase access token (no code changes required)

From the browser where you are logged into the app:
1. Open DevTools
2. Go to **Application** -> **Local Storage**
3. Find the key that looks like `sb-<project-ref>-auth-token`
4. The value is JSON. Copy `access_token`.

Do **not** paste the token into git or logs.

## 2) Run the smoke script

```bash
export MYTHIC_API_BASE_URL="http://localhost:3001/functions/v1"
export SUPABASE_ACCESS_TOKEN="...copy from Local Storage..."

# Optional overrides for the created campaign/character:
export MYTHIC_SMOKE_CAMPAIGN_NAME="VPS Smoke"
export MYTHIC_SMOKE_CAMPAIGN_DESCRIPTION="Quick smoke run for VPS function compatibility."
export MYTHIC_SMOKE_CLASS="werewolf ninja pyromancer"
export MYTHIC_SMOKE_CHARACTER_NAME="Smoke Test"

bash ./services/mythic-api/scripts/smoke-all.sh
```

For a deployed VPS behind Caddy:
```bash
export MYTHIC_API_BASE_URL="https://api.yourdomain.com/functions/v1"
export SUPABASE_ACCESS_TOKEN="..."
bash ./services/mythic-api/scripts/smoke-all.sh
```

## What It Does
- Creates a new campaign
- Bootstraps Mythic state
- Lists campaigns
- Creates a character (requires OpenAI configured server-side)
- Fetches DM context
- Performs a board transition (town -> travel)
- Starts combat and ticks once
- Generates loot
- Fetches shop stock (and attempts a buy if possible)
- Calls world-generator / world-content-writer

