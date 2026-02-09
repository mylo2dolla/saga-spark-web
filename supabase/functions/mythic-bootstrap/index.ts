import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

    // Service role client for mythic schema writes (no RLS yet, but schema grants may still be restrictive).
    const svc = createClient(supabaseUrl, serviceRoleKey);

    // Ensure the campaign exists and the user is a member/owner.
    const { data: campaign, error: campaignError } = await svc
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", campaignId)
      .maybeSingle();

    if (campaignError) throw campaignError;
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: member, error: memberError } = await svc
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!member && campaign.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not authorized for this campaign" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ensure DM state rows exist.
    await svc.from("mythic.dm_campaign_state").upsert({ campaign_id: campaignId }, { onConflict: "campaign_id" });
    await svc.from("mythic.dm_world_tension").upsert({ campaign_id: campaignId }, { onConflict: "campaign_id" });

    // Ensure there is an active board.
    const { data: activeBoard, error: boardError } = await svc
      .from("mythic.boards")
      .select("id, board_type, status")
      .eq("campaign_id", campaignId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (boardError) throw boardError;

    if (!activeBoard) {
      const townState = {
        seed: 12345,
        vendors: [
          { id: "vendor_blacksmith", name: "Grinbolt the Anvil", services: ["repair", "craft"] },
          { id: "vendor_alchemist", name: 'Mira "Boom" Vell', services: ["potions", "bombs"] },
        ],
        services: ["inn", "healer", "notice_board"],
        gossip: ["A bounty poster has fresh ink.", "Something under the well keeps laughing."],
        factions_present: ["Town Watch", "Coin-Eaters Guild"],
        guard_alertness: 0.2,
        bounties: [],
        rumors: ["A caravan vanished on the south road."],
        consequence_flags: {},
      };

      const { error: insertBoardError } = await svc.from("mythic.boards").insert({
        campaign_id: campaignId,
        board_type: "town",
        status: "active",
        state_json: townState,
        ui_hints_json: { camera: { x: 0, y: 0, zoom: 1.0 } },
      });

      if (insertBoardError) throw insertBoardError;

      await svc.from("mythic.factions").upsert(
        {
          campaign_id: campaignId,
          name: "Town Watch",
          description: "Badge-polishers with a grudge and a surprisingly sharp memory.",
          tags: ["law", "order", "bribes"],
        },
        { onConflict: "campaign_id,name" },
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-bootstrap error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to bootstrap campaign" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
