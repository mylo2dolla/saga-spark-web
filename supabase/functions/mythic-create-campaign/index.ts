import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase env is not configured (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY)");
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { name, description } = parsed.data;
    const inviteCodeValue = Math.random().toString(36).substring(2, 8).toUpperCase();
    const svc = createClient(supabaseUrl, serviceRoleKey);

    const { data: campaign, error: insertErr } = await svc
      .from("campaigns")
      .insert({
        name,
        description,
        owner_id: user.id,
        invite_code: inviteCodeValue,
        is_active: true,
      })
      .select("id, name, description, invite_code, owner_id, is_active, updated_at")
      .single();

    if (insertErr || !campaign) {
      throw insertErr ?? new Error("Failed to create campaign");
    }

    const { error: memberErr } = await svc.from("campaign_members").insert({
      campaign_id: campaign.id,
      user_id: user.id,
      is_dm: true,
    });
    if (memberErr) throw memberErr;

    const { error: combatErr } = await svc.from("combat_state").insert({ campaign_id: campaign.id });
    if (combatErr) throw combatErr;

    return new Response(JSON.stringify({ ok: true, campaign }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-create-campaign error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to create campaign" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

