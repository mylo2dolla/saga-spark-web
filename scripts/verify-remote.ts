import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("VITE_SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  ?? Deno.env.get("SUPABASE_ANON_KEY")
  ?? Deno.env.get("VITE_SUPABASE_ANON_KEY")
  ?? "";

if (!url || !key) {
  console.error("Missing SUPABASE_URL and key in env.");
  Deno.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const results: Record<string, unknown> = {};

const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
results.session = { ok: !sessionErr, error: sessionErr?.message ?? null, hasSession: Boolean(sessionData?.session) };

const { data: campaigns, error: campaignsErr } = await supabase
  .from("campaigns")
  .select("id, owner_id, name")
  .limit(3);
results.campaigns = { ok: !campaignsErr, error: campaignsErr?.message ?? null, count: campaigns?.length ?? 0 };

const { data: members, error: membersErr } = await supabase
  .from("campaign_members")
  .select("id")
  .limit(3);
results.campaign_members = { ok: !membersErr, error: membersErr?.message ?? null, count: members?.length ?? 0 };

const { data: combat, error: combatErr } = await supabase
  .from("combat_state")
  .select("id")
  .limit(3);
results.combat_state = { ok: !combatErr, error: combatErr?.message ?? null, count: combat?.length ?? 0 };

const { data: profiles, error: profilesErr } = await supabase
  .from("profiles")
  .select("id")
  .limit(3);
results.profiles = { ok: !profilesErr, error: profilesErr?.message ?? null, count: profiles?.length ?? 0 };

console.log(JSON.stringify(results, null, 2));
