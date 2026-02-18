#!/usr/bin/env node
/**
 * Verify Mythic turn engine end-to-end:
 * - calls mythic-dungeon-master (SSE)
 * - optionally queries mythic.turns using service role to confirm commit
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_ANON_KEY
 * - SUPABASE_ACCESS_TOKEN
 * - CAMPAIGN_ID
 *
 * Optional env:
 * - SUPABASE_SERVICE_ROLE_KEY (enables DB verification)
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const CAMPAIGN_ID = process.env.CAMPAIGN_ID;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ACCESS_TOKEN || !CAMPAIGN_ID) {
  console.error("Missing required env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_ACCESS_TOKEN, CAMPAIGN_ID");
  process.exit(2);
}

const extractDeltaContentFromSse = (sseText) => {
  let content = "";
  for (const rawLine of sseText.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data: ")) continue;
    const jsonStr = line.slice(6).trim();
    if (jsonStr === "[DONE]") break;
    try {
      const parsed = JSON.parse(jsonStr);
      const delta = parsed?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") content += delta;
    } catch {
      // ignore incomplete chunks
    }
  }
  return content;
};

const main = async () => {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mythic-dungeon-master`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "x-idempotency-key": `verify-turn-${Date.now()}`,
    },
    body: JSON.stringify({
      campaignId: CAMPAIGN_ID,
      messages: [{ role: "user", content: "Test turn: describe the scene briefly." }],
      actionContext: { source: "scripts/verify-turn-engine.mjs" },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`mythic-dungeon-master failed: ${res.status} ${text.slice(0, 500)}`);
  }

  const sseText = await res.text();
  const content = extractDeltaContentFromSse(sseText);
  if (!content.trim()) {
    throw new Error("SSE produced no delta content");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("DM content was not JSON. Turn engine expects JSON object output.");
  }
  if (!parsed?.narration || typeof parsed.narration !== "string") {
    throw new Error("DM JSON missing narration");
  }

  console.log("✅ DM narration received:", parsed.narration.slice(0, 120).replaceAll("\n", " "), "...");

  if (!SERVICE_ROLE_KEY) {
    console.log("ℹ️  SUPABASE_SERVICE_ROLE_KEY not set; skipping DB turn commit verification.");
    return;
  }

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: turns, error } = await svc
    .schema("mythic")
    .from("turns")
    .select("id, turn_index, turn_seed, created_at")
    .eq("campaign_id", CAMPAIGN_ID)
    .order("turn_index", { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!turns || turns.length === 0) throw new Error("No turns found in DB after DM call");

  console.log("✅ Latest turn committed:", {
    id: turns[0].id,
    turn_index: turns[0].turn_index,
    turn_seed: turns[0].turn_seed,
    created_at: turns[0].created_at,
  });
};

main().catch((err) => {
  console.error("❌ Turn engine verification failed:", err?.message || err);
  process.exit(1);
});

