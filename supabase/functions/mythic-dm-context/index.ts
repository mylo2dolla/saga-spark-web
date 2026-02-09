import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
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

    const { campaignId } = parsed.data;

    const svc = createClient(supabaseUrl, serviceRoleKey);

    // Authoritative board payload (active board + last 20 transitions).
    const { data: board, error: boardError } = await svc
      .schema("mythic")
      .from("v_board_state_for_dm")
      .select("*")
      .eq("campaign_id", campaignId)
      .maybeSingle();

    if (boardError) throw boardError;

    // Most recent mythic character for this player in this campaign.
    const { data: char, error: charError } = await svc
      .schema("mythic")
      .from("v_character_state_for_dm")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("player_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (charError) throw charError;

    // Combat payload if the active board is combat.
    let combat: unknown = null;
    const combatSessionId = (board as { combat_session_id?: string | null } | null)?.combat_session_id ?? null;
    if (combatSessionId) {
      const { data: cs, error: csError } = await svc
        .schema("mythic")
        .from("v_combat_state_for_dm")
        .select("combat_session_id, campaign_id, status, seed, scene_json, current_turn_index, dm_payload")
        .eq("combat_session_id", combatSessionId)
        .maybeSingle();
      if (csError) throw csError;
      combat = cs;
    }

    // Canonical rules/script for the DM.
    const { data: rulesRow, error: rulesError } = await svc
      .schema("mythic")
      .from("game_rules")
      .select("name, version, rules")
      .eq("name", "mythic-weave-rules-v1")
      .maybeSingle();
    if (rulesError) throw rulesError;

    const { data: scriptRow, error: scriptError } = await svc
      .schema("mythic")
      .from("generator_scripts")
      .select("name, version, is_active, content")
      .eq("name", "mythic-weave-core")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (scriptError) throw scriptError;

    const dmState = await svc
      .schema("mythic")
      .from("dm_campaign_state")
      .select("*")
      .eq("campaign_id", campaignId)
      .maybeSingle();

    const tension = await svc
      .schema("mythic")
      .from("dm_world_tension")
      .select("*")
      .eq("campaign_id", campaignId)
      .maybeSingle();

    return new Response(
      JSON.stringify({
        ok: true,
        campaign_id: campaignId,
        player_id: user.id,
        board,
        character: char,
        combat,
        rules: rulesRow,
        script: scriptRow,
        dm_campaign_state: dmState.data ?? null,
        dm_world_tension: tension.data ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("mythic-dm-context error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to load mythic DM context" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
