import process from "node:process";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const FUNCTIONS_BASE_URL_OVERRIDE = (process.env.VITE_MYTHIC_FUNCTIONS_BASE_URL ?? "").trim();
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const CAMPAIGN_ID = process.env.SUPABASE_CAMPAIGN_ID;

const FUNCTIONS_BASE_URL = (() => {
  if (FUNCTIONS_BASE_URL_OVERRIDE) return FUNCTIONS_BASE_URL_OVERRIDE.replace(/\/+$/, "");
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1`;
})();

if (!FUNCTIONS_BASE_URL || !ANON_KEY || !ACCESS_TOKEN || !CAMPAIGN_ID) {
  console.error(
    "Missing required env vars: (VITE_MYTHIC_FUNCTIONS_BASE_URL or VITE_SUPABASE_URL), VITE_SUPABASE_ANON_KEY, SUPABASE_ACCESS_TOKEN, SUPABASE_CAMPAIGN_ID"
  );
  process.exit(1);
}

const response = await fetch(`${FUNCTIONS_BASE_URL}/world-content-writer`, {
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
