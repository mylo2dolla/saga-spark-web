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
  direction: z.enum(["north", "south", "east", "west"]),
});

type Direction = "north" | "south" | "east" | "west";
type BoardType = "town" | "travel" | "dungeon";
type Biome = "town" | "plains" | "forest" | "wetlands" | "desert" | "badlands" | "mountain" | "ruins" | "cavern" | "crypt" | "void";

interface ActiveBoardRow {
  id: string;
  board_type: BoardType | "combat";
  state_json: Record<string, unknown>;
  ui_hints_json: Record<string, unknown>;
}

interface BoardChunkRow {
  id: string;
  campaign_id: string;
  board_type: BoardType;
  coord_x: number;
  coord_y: number;
  biome: Biome;
  seed: number;
  state_json: Record<string, unknown>;
  runtime_json: Record<string, unknown>;
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function roll(seed: number, label: string): number {
  return (hashString(`${seed}:${label}`) % 10_000) / 10_000;
}

function biomeMatrix(boardType: BoardType, fromBiome: Biome): Array<{ biome: Biome; weight: number }> {
  if (boardType === "town") {
    return [
      { biome: "town", weight: 0.68 },
      { biome: "plains", weight: 0.12 },
      { biome: "forest", weight: 0.08 },
      { biome: "wetlands", weight: 0.04 },
      { biome: "mountain", weight: 0.04 },
      { biome: "badlands", weight: 0.04 },
    ];
  }

  if (boardType === "travel") {
    const stable: Array<{ biome: Biome; weight: number }> = [
      { biome: fromBiome, weight: 0.55 },
      { biome: "plains", weight: 0.15 },
      { biome: "forest", weight: 0.1 },
      { biome: "wetlands", weight: 0.07 },
      { biome: "badlands", weight: 0.06 },
      { biome: "desert", weight: 0.04 },
      { biome: "mountain", weight: 0.03 },
    ];
    return stable;
  }

  return [
    { biome: fromBiome === "town" ? "ruins" : fromBiome, weight: 0.58 },
    { biome: "ruins", weight: 0.2 },
    { biome: "cavern", weight: 0.12 },
    { biome: "crypt", weight: 0.1 },
  ];
}

function pickWeighted(seed: number, label: string, weights: Array<{ biome: Biome; weight: number }>): Biome {
  const total = weights.reduce((sum, item) => sum + item.weight, 0);
  let cursor = roll(seed, label) * total;
  for (const item of weights) {
    cursor -= item.weight;
    if (cursor <= 0) return item.biome;
  }
  return weights[weights.length - 1]?.biome ?? "plains";
}

function defaultSize(boardType: BoardType): { width: number; height: number; tileSize: number } {
  if (boardType === "town") return { width: 48, height: 32, tileSize: 16 };
  if (boardType === "travel") return { width: 64, height: 40, tileSize: 16 };
  return { width: 56, height: 36, tileSize: 16 };
}

function terrainTileForBiome(biome: Biome): string {
  switch (biome) {
    case "town":
      return "cobble";
    case "forest":
      return "grass_forest";
    case "wetlands":
      return "mud";
    case "desert":
      return "sand";
    case "badlands":
      return "dry_rock";
    case "mountain":
      return "stone";
    case "ruins":
      return "ruin_floor";
    case "cavern":
      return "cave_floor";
    case "crypt":
      return "crypt_floor";
    case "void":
      return "void";
    default:
      return "grass";
  }
}

function makeDefaultState(boardType: BoardType, biome: Biome, coordX: number, coordY: number, seed: number): Record<string, unknown> {
  const size = defaultSize(boardType);
  const terrainTile = terrainTileForBiome(biome);

  const terrain = Array.from({ length: size.height }, (_, y) =>
    Array.from({ length: size.width }, (_, x) => {
      const edge = x === 0 || y === 0 || x === size.width - 1 || y === size.height - 1;
      if (edge) return `${terrainTile}_edge`;
      if (roll(seed, `terrain:${x}:${y}`) < 0.07) return `${terrainTile}_variant`;
      return terrainTile;
    }),
  );

  const obstacles = Array.from({ length: size.height }, (_, y) =>
    Array.from({ length: size.width }, (_, x) => {
      const edge = x === 0 || y === 0 || x === size.width - 1 || y === size.height - 1;
      if (edge) return "wall";
      if (boardType === "town") return roll(seed, `obs_town:${x}:${y}`) < 0.02 ? "crate" : "void";
      if (boardType === "travel") return roll(seed, `obs_travel:${x}:${y}`) < 0.05 ? "tree" : "void";
      return roll(seed, `obs_dungeon:${x}:${y}`) < 0.08 ? "pillar" : "void";
    }),
  );

  const entities = {
    player_spawn: {
      id: "player_spawn",
      kind: "player_spawn",
      x: Math.floor(size.width / 2),
      y: Math.floor(size.height / 2),
      sprite: "player_default",
      critical_path: false,
      destructible: false,
    },
    npcs: boardType === "town"
      ? [
          { id: "npc_vendor_1", kind: "npc", x: 8, y: 6, name: "Quartermaster", sprite: "npc_default", destructible: false, critical_path: false },
          { id: "npc_vendor_2", kind: "npc", x: 12, y: 8, name: "Innkeeper", sprite: "npc_default", destructible: false, critical_path: false },
        ]
      : [],
    mobs: boardType === "dungeon"
      ? Array.from({ length: 4 }, (_, idx) => ({
          id: `mob_${idx + 1}`,
          kind: "mob",
          x: 6 + ((idx * 8) % (size.width - 10)),
          y: 6 + ((idx * 6) % (size.height - 10)),
          name: `Shade ${idx + 1}`,
          sprite: "mob_default",
          destructible: true,
          critical_path: false,
        }))
      : [],
    loot: [
      {
        id: `loot_${Math.abs(coordX)}_${Math.abs(coordY)}`,
        kind: "loot",
        x: clampInt(4 + (seed % (size.width - 8)), 2, size.width - 3),
        y: clampInt(4 + ((seed >>> 5) % (size.height - 8)), 2, size.height - 3),
        name: "Field Cache",
        sprite: "loot_default",
        destructible: true,
        critical_path: false,
      },
    ],
    interactables: boardType === "travel"
      ? [
          { id: "poi_watchtower", kind: "interactable", x: 10, y: 8, name: "Watchtower", sprite: "poi", destructible: true, critical_path: false },
          { id: "poi_caravan", kind: "interactable", x: size.width - 12, y: size.height - 9, name: "Caravan Wreck", sprite: "poi", destructible: true, critical_path: false },
        ]
      : [
          { id: "main_exit", kind: "interactable", x: Math.floor(size.width / 2), y: 1, name: "Main Exit", sprite: "gate", destructible: false, critical_path: true },
        ],
  };

  return {
    version: 2,
    chunk: {
      board_type: boardType,
      coord_x: coordX,
      coord_y: coordY,
      biome,
      seed,
    },
    grid: {
      width: size.width,
      height: size.height,
      tile_size: size.tileSize,
      layers: [
        { id: "terrain", kind: "terrain", tiles: terrain, collision: false, destructible: false },
        { id: "obstacles", kind: "obstacle", tiles: obstacles, collision: true, destructible: true },
      ],
    },
    entities,
    runtime: {
      destroyed_ids: [],
      opened_ids: [],
      flags: {},
      fog_revealed: [],
    },
    exits: {
      north: { enabled: true, direction: "north", hint: "north edge" },
      south: { enabled: true, direction: "south", hint: "south edge" },
      east: { enabled: true, direction: "east", hint: "east edge" },
      west: { enabled: true, direction: "west", hint: "west edge" },
    },
  };
}

function nextCoords(coordX: number, coordY: number, direction: Direction): { x: number; y: number } {
  if (direction === "north") return { x: coordX, y: coordY - 1 };
  if (direction === "south") return { x: coordX, y: coordY + 1 };
  if (direction === "east") return { x: coordX + 1, y: coordY };
  return { x: coordX - 1, y: coordY };
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

    const { campaignId, direction } = parsed.data;
    const svc = createClient(supabaseUrl, serviceRoleKey);

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

    const { data: activeBoard, error: activeErr } = await svc
      .schema("mythic")
      .from("boards")
      .select("id, board_type, state_json, ui_hints_json")
      .eq("campaign_id", campaignId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<ActiveBoardRow>();
    if (activeErr) throw activeErr;
    if (!activeBoard) {
      return new Response(JSON.stringify({ error: "No active board for campaign" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (activeBoard.board_type === "combat") {
      return new Response(JSON.stringify({ error: "Use combat flow while in combat board" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const activeState = asObject(activeBoard.state_json);
    const activeChunk = asObject(activeState.chunk);
    const currentX = clampInt(asNumber(activeChunk.coord_x ?? activeState.coord_x, 0), -9999, 9999);
    const currentY = clampInt(asNumber(activeChunk.coord_y ?? activeState.coord_y, 0), -9999, 9999);
    const currentSeed = clampInt(asNumber(activeChunk.seed ?? activeState.seed, hashString(`${campaignId}:${activeBoard.id}`)), 1, 2_147_483_647);
    const currentBiome = asString(activeChunk.biome, "plains") as Biome;
    const boardType = activeBoard.board_type;

    const target = nextCoords(currentX, currentY, direction);
    const seed = clampInt(hashString(`${campaignId}:${boardType}:${target.x}:${target.y}`), 1, 2_147_483_647);

    const continuityWeights = biomeMatrix(boardType, currentBiome);
    const targetBiome = pickWeighted(seed, `biome:${direction}`, continuityWeights);

    const { data: existingChunk, error: existingErr } = await svc
      .schema("mythic")
      .from("board_chunks")
      .select("id, campaign_id, board_type, coord_x, coord_y, biome, seed, state_json, runtime_json")
      .eq("campaign_id", campaignId)
      .eq("board_type", boardType)
      .eq("coord_x", target.x)
      .eq("coord_y", target.y)
      .maybeSingle<BoardChunkRow>();
    if (existingErr) throw existingErr;

    const targetState = existingChunk
      ? {
          ...asObject(existingChunk.state_json),
          runtime: {
            ...asObject(asObject(existingChunk.state_json).runtime),
            ...asObject(existingChunk.runtime_json),
          },
          chunk: {
            ...asObject(asObject(existingChunk.state_json).chunk),
            board_type: boardType,
            coord_x: target.x,
            coord_y: target.y,
            biome: existingChunk.biome,
            seed: existingChunk.seed,
          },
        }
      : makeDefaultState(boardType, targetBiome, target.x, target.y, seed);

    const upsertState = asObject(targetState);
    const runtime = asObject(asObject(upsertState.runtime));

    const { error: upsertErr } = await svc
      .schema("mythic")
      .from("board_chunks")
      .upsert({
        campaign_id: campaignId,
        board_type: boardType,
        coord_x: target.x,
        coord_y: target.y,
        biome: asString(asObject(upsertState.chunk).biome, targetBiome),
        seed: clampInt(asNumber(asObject(upsertState.chunk).seed, seed), 1, 2_147_483_647),
        state_json: upsertState,
        runtime_json: runtime,
      }, { onConflict: "campaign_id,board_type,coord_x,coord_y" });
    if (upsertErr) throw upsertErr;

    const { error: archiveErr } = await svc
      .schema("mythic")
      .from("boards")
      .update({ status: "archived", updated_at: new Date().toISOString() })
      .eq("id", activeBoard.id);
    if (archiveErr) throw archiveErr;

    const { data: nextBoard, error: nextBoardErr } = await svc
      .schema("mythic")
      .from("boards")
      .insert({
        campaign_id: campaignId,
        board_type: boardType,
        status: "active",
        state_json: upsertState,
        ui_hints_json: activeBoard.ui_hints_json ?? { camera: { x: 0, y: 0, zoom: 1 } },
      })
      .select("id, state_json")
      .maybeSingle();
    if (nextBoardErr) throw nextBoardErr;

    const transitionPayload = {
      direction,
      continuity: {
        from_biome: currentBiome,
        to_biome: asString(asObject(asObject(upsertState).chunk).biome, targetBiome),
        weighted_similarity: currentBiome === asString(asObject(asObject(upsertState).chunk).biome, targetBiome) ? 1 : 0.5,
      },
      from_chunk: {
        coord_x: currentX,
        coord_y: currentY,
        biome: currentBiome,
      },
      to_chunk: {
        coord_x: target.x,
        coord_y: target.y,
        biome: asString(asObject(asObject(upsertState).chunk).biome, targetBiome),
      },
    };

    const { error: transitionErr } = await svc
      .schema("mythic")
      .from("board_transitions")
      .insert({
        campaign_id: campaignId,
        from_board_type: boardType,
        to_board_type: boardType,
        reason: "edge_step",
        animation: "page_turn",
        payload_json: transitionPayload,
      });
    if (transitionErr) throw transitionErr;

    return new Response(JSON.stringify({
      ok: true,
      board_id: asObject(nextBoard ?? {}).id ?? null,
      chunk: asObject(upsertState.chunk),
      biome: asObject(upsertState.chunk).biome,
      state_json: upsertState,
      prefetch: {
        neighboring_coords: [
          nextCoords(target.x, target.y, "north"),
          nextCoords(target.x, target.y, "south"),
          nextCoords(target.x, target.y, "east"),
          nextCoords(target.x, target.y, "west"),
        ],
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-board-step error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to step board" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
