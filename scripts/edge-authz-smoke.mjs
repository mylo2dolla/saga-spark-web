#!/usr/bin/env node
/**
 * Minimal auth/authz smoke against Supabase Edge Functions.
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 *
 * Optional env:
 * - SUPABASE_ACCESS_TOKEN (for authenticated checks)
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || null;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  process.exit(2);
}

const callFn = async (name, body, opts = {}) => {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
    ...(opts.auth === "required" ? { Authorization: `Bearer ${ACCESS_TOKEN || ""}` } : {}),
  };
  return await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
  });
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const main = async () => {
  // 1) Without auth: must 401.
  {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/mythic-list-campaigns`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert(res.status === 401, `Expected 401 without auth, got ${res.status}`);
  }

  if (!ACCESS_TOKEN) {
    console.log("✅ Unauthed 401 smoke passed. Set SUPABASE_ACCESS_TOKEN to run authz checks.");
    return;
  }

  // 2) With auth but campaign denied: must 403 on DM context.
  {
    const fakeCampaignId = "00000000-0000-0000-0000-000000000000";
    const res = await callFn("mythic-dm-context", { campaignId: fakeCampaignId }, { auth: "required" });
    assert([403, 404].includes(res.status), `Expected 403/404 for denied campaign, got ${res.status}`);
  }

  console.log("✅ Edge auth/authz smoke passed.");
};

main().catch((err) => {
  console.error("❌ Edge auth/authz smoke failed:", err?.message || err);
  process.exit(1);
});

