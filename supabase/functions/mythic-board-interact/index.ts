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
  entityId: z.string().min(1),
  entityKind: z.enum(["npc", "mob", "loot", "interactable", "player_spawn"]),
  action: z.enum(["interact", "destroy", "open"]),
});

type BoardType = "town" | "travel" | "dungeon" | "combat";

interface ActiveBoardRow {
  id: string;
  board_type: BoardType;
  state_json: Record<string, unknown>;
}

interface BoardChunkRow {
  id: string;
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

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toEntityArray(value: unknown): Array<Record<string, unknown>> {
  return asArray(value).map((entry) => asObject(entry));
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

    const { campaignId, entityId, entityKind, action } = parsed.data;
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

    const { data: activeBoard, error: boardErr } = await svc
      .schema("mythic")
      .from("boards")
      .select("id, board_type, state_json")
      .eq("campaign_id", campaignId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle<ActiveBoardRow>();
    if (boardErr) throw boardErr;
    if (!activeBoard) {
      return new Response(JSON.stringify({ error: "No active board" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (activeBoard.board_type === "combat") {
      return new Response(JSON.stringify({ error: "Exploration interactions are disabled during combat" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stateJson = asObject(activeBoard.state_json);
    const entities = asObject(stateJson.entities);
    const runtime = asObject(stateJson.runtime);

    const npcs = toEntityArray(entities.npcs);
    const mobs = toEntityArray(entities.mobs);
    const loot = toEntityArray(entities.loot);
    const interactables = toEntityArray(entities.interactables);

    const all = [...npcs, ...mobs, ...loot, ...interactables];
    const target = all.find((entry) => asString(entry.id) === entityId && asString(entry.kind) === entityKind);

    if (!target) {
      return new Response(JSON.stringify({ error: "Entity not found on board" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const criticalPath = asBoolean(target.critical_path, false);
    if (action === "destroy" && criticalPath) {
      return new Response(JSON.stringify({ error: "Critical-path anchor cannot be destroyed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const destroyedIds = new Set(asArray(runtime.destroyed_ids).map((id) => asString(id)).filter((id) => id.length > 0));
    const openedIds = new Set(asArray(runtime.opened_ids).map((id) => asString(id)).filter((id) => id.length > 0));
    const flags = asObject(runtime.flags);

    if (action === "destroy") {
      destroyedIds.add(entityId);
      flags[`destroyed:${entityId}`] = true;
    } else if (action === "open") {
      openedIds.add(entityId);
      flags[`opened:${entityId}`] = true;
    } else {
      flags[`interacted:${entityId}`] = true;
    }

    const nextRuntime = {
      ...runtime,
      destroyed_ids: Array.from(destroyedIds),
      opened_ids: Array.from(openedIds),
      flags,
    };

    const nextState = {
      ...stateJson,
      runtime: nextRuntime,
    };

    const { error: updateErr } = await svc
      .schema("mythic")
      .from("boards")
      .update({
        state_json: nextState,
        updated_at: new Date().toISOString(),
      })
      .eq("id", activeBoard.id)
      .eq("campaign_id", campaignId);
    if (updateErr) throw updateErr;

    const chunk = asObject(stateJson.chunk);
    const boardType = asString(chunk.board_type, activeBoard.board_type);
    const coordX = Number(chunk.coord_x);
    const coordY = Number(chunk.coord_y);

    if ((boardType === "town" || boardType === "travel" || boardType === "dungeon") && Number.isFinite(coordX) && Number.isFinite(coordY)) {
      const { data: chunkRow, error: chunkErr } = await svc
        .schema("mythic")
        .from("board_chunks")
        .select("id, state_json, runtime_json")
        .eq("campaign_id", campaignId)
        .eq("board_type", boardType)
        .eq("coord_x", Math.floor(coordX))
        .eq("coord_y", Math.floor(coordY))
        .maybeSingle<BoardChunkRow>();
      if (chunkErr) throw chunkErr;

      if (chunkRow) {
        const { error: chunkUpdateErr } = await svc
          .schema("mythic")
          .from("board_chunks")
          .update({
            state_json: {
              ...asObject(chunkRow.state_json),
              runtime: nextRuntime,
            },
            runtime_json: {
              ...asObject(chunkRow.runtime_json),
              ...nextRuntime,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", chunkRow.id)
          .eq("campaign_id", campaignId);
        if (chunkUpdateErr) throw chunkUpdateErr;
      }
    }

    const targetName = asString(target.name, entityId);
    const actionLabel = action === "open" ? "opened" : action === "destroy" ? "destroyed" : "interacted with";

    await svc
      .schema("mythic")
      .from("story_beats")
      .insert({
        campaign_id: campaignId,
        beat_type: "board_interaction",
        title: `${targetName} ${actionLabel}`,
        narrative: `${user.id} ${actionLabel} ${targetName}.`,
        emphasis: action === "destroy" ? "high" : "normal",
        metadata: {
          entity_id: entityId,
          entity_kind: entityKind,
          action,
          board_type: activeBoard.board_type,
        },
        created_by: "system",
      });

    return new Response(JSON.stringify({
      ok: true,
      board_id: activeBoard.id,
      entity_id: entityId,
      action,
      runtime: nextRuntime,
      flag_key: `${action}:${entityId}`,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-board-interact error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Failed board interaction" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
