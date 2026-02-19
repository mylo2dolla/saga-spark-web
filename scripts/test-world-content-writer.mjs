import process from "node:process";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const FUNCTIONS_BASE = process.env.VITE_MYTHIC_FUNCTIONS_BASE_URL ?? process.env.MYTHIC_FUNCTIONS_BASE_URL;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const CAMPAIGN_ID = process.env.SUPABASE_CAMPAIGN_ID;

if (!SUPABASE_URL || !ANON_KEY || !FUNCTIONS_BASE || !ACCESS_TOKEN || !CAMPAIGN_ID) {
  console.error("Missing required env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_MYTHIC_FUNCTIONS_BASE_URL (or MYTHIC_FUNCTIONS_BASE_URL), SUPABASE_ACCESS_TOKEN, SUPABASE_CAMPAIGN_ID");
  process.exit(1);
}
const normalizedBase = FUNCTIONS_BASE.replace(/\/+$/, "");
const functionsBase = normalizedBase.endsWith("/functions/v1")
  ? normalizedBase
  : `${normalizedBase}/functions/v1`;

const response = await fetch(`${functionsBase}/world-content-writer`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${ACCESS_TOKEN}`,
  },
  body: JSON.stringify({
    campaignId: CAMPAIGN_ID,
    content: [],
  }),
});

const body = await response.text();
console.log("status", response.status);
console.log("body", body);
