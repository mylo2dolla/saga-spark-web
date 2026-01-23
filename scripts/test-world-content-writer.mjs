import process from "node:process";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const CAMPAIGN_ID = process.env.SUPABASE_CAMPAIGN_ID;

if (!SUPABASE_URL || !ANON_KEY || !ACCESS_TOKEN || !CAMPAIGN_ID) {
  console.error("Missing required env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_ACCESS_TOKEN, SUPABASE_CAMPAIGN_ID");
  process.exit(1);
}

const response = await fetch(`${SUPABASE_URL}/functions/v1/world-content-writer`, {
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
