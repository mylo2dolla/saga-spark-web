import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { rngInt, rngPick } from "../_shared/mythic_rng.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  toBoardType: z.enum(["town", "travel", "dungeon", "combat"]),
  reason: z.string().max(200).optional(),
  payload: z.record(z.unknown()).optional(),
});

type MythicBoardType = "town" | "travel" | "dungeon" | "combat";

type ActiveBoardRow = {
  id: string;
  board_type: MythicBoardType;
  state_json: Record<string, unknown> | null;
};

type InsertedBoardRow = {
  id: string;
};

function nowIso() {
  return new Date().toISOString();
}

const syllableA = [
  "Ash", "Iron", "Dus", "Grim", "Stone", "Glen", "Oath", "Hex", "Rift", "Wolf", "Black", "Silver",
];
const syllableB = [
  "hold", "bridge", "hollow", "reach", "mark", "port", "spire", "vale", "cross", "ford", "fall", "gate",
];

const makeName = (seed: number, label: string): string => {
  const a = rngPick(seed, `${label}:a`, syllableA);
  const b = rngPick(seed, `${label}:b`, syllableB);
  return `${a}${b}`;
};

function mkTownState(seed: number) {
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
    guard_alertness: rngInt(seed, "town:guard", 0, 100) / 100,
    bounties: [],
    rumors: [],
    consequence_flags: {},
  };
}

function mkTravelState(seed: number) {
  const weather = rngPick(seed, "travel:weather", ["clear", "wind", "rain", "dust", "storm"]);
  const segments = Array.from({ length: rngInt(seed, "travel:segments", 3, 6) }).map((_, i) => ({
    id: `seg_${i + 1}`,
    terrain: rngPick(seed, `travel:terrain:${i}`, ["road", "forest", "ridge", "bog", "ruins"]),
    danger: rngInt(seed, `travel:danger:${i}`, 1, 5),
  }));
  return {
    seed,
    route_segments: segments,
    hazard_meter: rngInt(seed, "travel:hazard", 1, 10),
    scouting: { advantage: rngInt(seed, "travel:scout", 0, 3) },
    weather,
    encounter_seeds: segments.map((_, i) => rngInt(seed, `travel:encounter:${i}`, 1000, 9999)),
  };
}

function mkDungeonState(seed: number) {
  const roomCount = rngInt(seed, "dungeon:rooms", 5, 9);
  const rooms = Array.from({ length: roomCount }).map((_, i) => ({
    id: `room_${i + 1}`,
    tags: [rngPick(seed, `dungeon:tag:${i}`, ["trap", "altar", "lair", "cache", "puzzle"])],
    danger: rngInt(seed, `dungeon:danger:${i}`, 1, 5),
  }));
  const edges = rooms.slice(1).map((r, i) => ({
    from: rooms[i]!.id,
    to: r.id,
  }));
  return {
    seed,
    room_graph: { rooms, edges },
    fog_of_war: { revealed: [rooms[0]!.id] },
    trap_signals: rngInt(seed, "dungeon:traps", 0, 3),
    loot_nodes: rngInt(seed, "dungeon:loot", 1, 4),
    faction_presence: [rngPick(seed, "dungeon:faction", ["Ink Ghouls", "Dust Priory", "Stoneborn"])],
  };
}

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

    const authToken = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(authToken);
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

    const { campaignId, toBoardType } = parsed.data;
    const reason = parsed.data.reason ?? "manual";
    const payload = parsed.data.payload ?? {};

    const svc = createClient(supabaseUrl, serviceRoleKey);

    const { data: campaign, error: campaignError } = await svc
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) return new Response(JSON.stringify({ error: "Campaign not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

    const { data: activeBoard } = await svc
      .schema("mythic")
      .from("boards")
      .select("id, board_type, state_json")
      .eq("campaign_id", campaignId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<ActiveBoardRow>();

    const activeState = activeBoard?.state_json ?? {};
    const rawSeed = activeState.seed;
    const seedBase = typeof rawSeed === "number" && Number.isFinite(rawSeed)
      ? Math.floor(rawSeed)
      : rngInt(Date.now() % 2_147_483_647, "board:seed", 1000, 999999);

    let stateJson: Record<string, unknown>;
    if (toBoardType === "town") stateJson = mkTownState(seedBase + 1);
    else if (toBoardType === "travel") stateJson = mkTravelState(seedBase + 2);
    else if (toBoardType === "dungeon") stateJson = mkDungeonState(seedBase + 3);
    else stateJson = { seed: seedBase + 4 };

    if (activeBoard) {
      await svc.schema("mythic").from("boards").update({ status: "archived", updated_at: nowIso() }).eq("id", activeBoard.id);
    }

    const { data: newBoard, error: newBoardErr } = await svc
      .schema("mythic")
      .from("boards")
      .insert({
        campaign_id: campaignId,
        board_type: toBoardType,
        status: "active",
        state_json: { ...stateJson, ...payload },
        ui_hints_json: { camera: { x: 0, y: 0, zoom: 1.0 } },
      })
      .select("id")
      .maybeSingle<InsertedBoardRow>();
    if (newBoardErr) throw newBoardErr;

    await svc.schema("mythic").from("board_transitions").insert({
      campaign_id: campaignId,
      from_board_type: activeBoard?.board_type ?? null,
      to_board_type: toBoardType,
      reason,
      animation: "page_turn",
      payload_json: { ...payload },
    });

    return new Response(JSON.stringify({ ok: true, board_id: newBoard?.id ?? null }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-board-transition error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to transition board" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
