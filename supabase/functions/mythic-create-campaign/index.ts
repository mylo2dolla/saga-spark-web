import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { rngInt, rngPick } from "../_shared/mythic_rng.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().min(2).max(2000),
});

const syllableA = [
  "Ash", "Iron", "Dus", "Grim", "Stone", "Glen", "Oath", "Hex", "Rift", "Wolf", "Black", "Silver",
];
const syllableB = [
  "hold", "bridge", "hollow", "reach", "mark", "port", "spire", "vale", "cross", "ford", "fall", "gate",
];

const hashSeed = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 2_147_483_647;
};

const makeName = (seed: number, label: string): string => {
  const a = rngPick(seed, `${label}:a`, syllableA);
  const b = rngPick(seed, `${label}:b`, syllableB);
  return `${a}${b}`;
};

const makeTownState = (seed: number) => {
  const vendorCount = rngInt(seed, "town:vendors", 1, 3);
  const vendors = Array.from({ length: vendorCount }).map((_, idx) => ({
    id: `vendor_${idx + 1}`,
    name: makeName(seed, `town:vendor:${idx}`),
    services: rngPick(seed, `town:vendor:svc:${idx}`, [
      ["repair", "craft"],
      ["potions", "bombs"],
      ["trade", "bank"],
      ["heal", "enchant"],
    ]),
  }));

  return {
    seed,
    vendors,
    services: ["inn", "healer", "notice_board"],
    gossip: [],
    factions_present: [],
    guard_alertness: rngInt(seed, "town:guard", 10, 60) / 100,
    bounties: [],
    rumors: [],
    consequence_flags: {},
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase env is not configured (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY)");
    }

    const body = await req.json().catch(() => null);
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authToken = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(authToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid or expired authentication token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(supabaseUrl, serviceRoleKey);
    const { data: campaign, error: campaignError } = await svc
      .from("campaigns")
      .insert({
        name: parsed.data.name.trim(),
        description: parsed.data.description.trim(),
        owner_id: user.id,
        is_active: true,
      })
      .select("id,name,description,invite_code,owner_id,is_active,updated_at")
      .single();

    if (campaignError || !campaign) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Campaign insert failed",
        details: campaignError ?? null,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const campaignId = campaign.id;

    const { error: memberError } = await svc
      .from("campaign_members")
      .insert({ campaign_id: campaignId, user_id: user.id, is_dm: true });
    if (memberError) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Campaign member insert failed",
        details: memberError,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: combatError } = await svc.from("combat_state").insert({ campaign_id: campaignId });
    if (combatError) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Combat state insert failed",
        details: combatError,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const seedBase = hashSeed(`${campaignId}:${user.id}`);
    const { error: dmStateError } = await svc
      .schema("mythic")
      .from("dm_campaign_state")
      .upsert({ campaign_id: campaignId }, { onConflict: "campaign_id" });
    if (dmStateError) {
      return new Response(JSON.stringify({
        ok: false,
        error: "DM campaign state upsert failed",
        details: dmStateError,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: dmTensionError } = await svc
      .schema("mythic")
      .from("dm_world_tension")
      .upsert({ campaign_id: campaignId }, { onConflict: "campaign_id" });
    if (dmTensionError) {
      return new Response(JSON.stringify({
        ok: false,
        error: "DM world tension upsert failed",
        details: dmTensionError,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: activeBoard, error: boardError } = await svc
      .schema("mythic")
      .from("boards")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (boardError) {
      return new Response(JSON.stringify({
        ok: false,
        error: "Board lookup failed",
        details: boardError,
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!activeBoard) {
      const townState = makeTownState(seedBase);
      const { error: boardInsertError } = await svc.schema("mythic").from("boards").insert({
        campaign_id: campaignId,
        board_type: "town",
        status: "active",
        state_json: townState,
        ui_hints_json: { camera: { x: 0, y: 0, zoom: 1.0 } },
      });
      if (boardInsertError) {
        return new Response(JSON.stringify({
          ok: false,
          error: "Board insert failed",
          details: boardInsertError,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ ok: true, campaign }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-create-campaign error:", error);
    const message = error instanceof Error ? error.message : "Failed to create campaign";
    const details = error instanceof Error ? { name: error.name, message: error.message } : error;
    return new Response(
      JSON.stringify({ ok: false, error: message, details }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
