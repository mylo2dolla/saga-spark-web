import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.SUPABASE_TEST_EMAIL ?? process.env.SUPABASE_EMAIL;
const PASSWORD = process.env.SUPABASE_TEST_PASSWORD ?? process.env.SUPABASE_PASSWORD;

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY || !EMAIL || !PASSWORD) {
  console.error(
    "Missing env vars: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_TEST_EMAIL (or SUPABASE_EMAIL), SUPABASE_TEST_PASSWORD (or SUPABASE_PASSWORD)."
  );
  process.exit(1);
}

const anonClient = createClient(SUPABASE_URL, ANON_KEY);
const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const signIn = await anonClient.auth.signInWithPassword({
  email: EMAIL,
  password: PASSWORD,
});

if (signIn.error || !signIn.data.session || !signIn.data.user) {
  console.error("Sign-in failed", signIn.error?.message ?? "missing session");
  process.exit(1);
}

const accessToken = signIn.data.session.access_token;
const userId = signIn.data.user.id;

const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
const campaignInsert = await serviceClient
  .from("campaigns")
  .insert({
    name: "Smoke Test Campaign",
    description: "Smoke test for create campaign + world generation",
    owner_id: userId,
    invite_code: inviteCode,
    is_active: true,
  })
  .select("id")
  .single();

if (campaignInsert.error || !campaignInsert.data) {
  console.error("Campaign insert failed", campaignInsert.error?.message ?? "unknown");
  process.exit(1);
}

const campaignId = campaignInsert.data.id;

try {
  const memberInsert = await serviceClient
    .from("campaign_members")
    .insert({
      campaign_id: campaignId,
      user_id: userId,
      is_dm: true,
    });

  if (memberInsert.error) {
    console.error("Campaign member insert failed", memberInsert.error.message);
    process.exit(1);
  }

  console.log("Calling world-generator...");
  const worldResponse = await fetch(`${SUPABASE_URL}/functions/v1/world-generator`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      type: "initial_world",
      campaignSeed: {
        title: "Smoke Test",
        description: "World generation smoke test",
        themes: ["frontier", "mystic"],
      },
      context: { campaignId },
    }),
  });

  const worldBody = await worldResponse.text();
  console.log("world-generator status", worldResponse.status);
  console.log("world-generator body", worldBody);

  console.log("Calling world-content-writer...");
  const writerResponse = await fetch(`${SUPABASE_URL}/functions/v1/world-content-writer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      campaignId,
      content: [],
    }),
  });

  const writerBody = await writerResponse.text();
  console.log("world-content-writer status", writerResponse.status);
  console.log("world-content-writer body", writerBody);
} finally {
  await serviceClient.from("campaign_members").delete().eq("campaign_id", campaignId);
  await serviceClient.from("campaigns").delete().eq("id", campaignId);
}
