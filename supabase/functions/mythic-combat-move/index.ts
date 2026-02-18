import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z
  .object({
    campaignId: z.string().uuid(),
    combatSessionId: z.string().uuid(),
    actorCombatantId: z.string().uuid(),
    to: z.object({ x: z.number().int(), y: z.number().int() }).optional(),
    wait: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.wait && !value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide destination tile or wait=true",
        path: ["to"],
      });
    }
  });

type CombatSessionRow = {
  id: string;
  seed: number;
  status: string;
  current_turn_index: number;
};

type TurnOrderRow = {
  turn_index: number;
  combatant_id: string;
};

type CombatantRow = {
  id: string;
  entity_type: "player" | "npc" | "summon";
  player_id: string | null;
  combat_session_id: string;
  x: number;
  y: number;
  mobility: number;
  statuses: unknown;
  is_alive: boolean;
};

type BoardStateRow = {
  state_json: Record<string, unknown> | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBlockedTiles(value: unknown): Array<{ x: number; y: number }> {
  return asArray(value)
    .map((entry) => asObject(entry))
    .filter((entry) => Number.isFinite(Number(entry.x)) && Number.isFinite(Number(entry.y)))
    .map((entry) => ({ x: Math.floor(Number(entry.x)), y: Math.floor(Number(entry.y)) }));
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function movementBudget(actor: CombatantRow): number {
  const statuses = asArray(actor.statuses)
    .map((entry) => asObject(entry))
    .map((entry) => String(entry.id ?? ""));

  if (statuses.includes("root") || statuses.includes("stun")) return 0;
  const base = Math.floor(actor.mobility / 20) + 2;
  return Math.max(2, Math.min(8, base));
}

function shortestPath(args: {
  start: { x: number; y: number };
  end: { x: number; y: number };
  width: number;
  height: number;
  blocked: Set<string>;
  occupied: Set<string>;
}): Array<{ x: number; y: number }> | null {
  const { start, end, width, height, blocked, occupied } = args;
  const startKey = key(start.x, start.y);
  const endKey = key(end.x, end.y);

  if (startKey === endKey) return [{ x: start.x, y: start.y }];

  const queue: Array<{ x: number; y: number }> = [{ x: start.x, y: start.y }];
  const visited = new Set<string>([startKey]);
  const parent = new Map<string, string>();

  const deltas = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentKey = key(current.x, current.y);

    for (const delta of deltas) {
      const nx = current.x + delta.x;
      const ny = current.y + delta.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;

      const nextKey = key(nx, ny);
      if (visited.has(nextKey)) continue;
      if (blocked.has(nextKey)) continue;
      if (occupied.has(nextKey) && nextKey !== endKey) continue;

      visited.add(nextKey);
      parent.set(nextKey, currentKey);

      if (nextKey === endKey) {
        const path: Array<{ x: number; y: number }> = [{ x: nx, y: ny }];
        let cursor = currentKey;
        while (cursor !== startKey) {
          const [px, py] = cursor.split(",").map((part) => Number(part));
          path.push({ x: px, y: py });
          const prev = parent.get(cursor);
          if (!prev) break;
          cursor = prev;
        }
        path.push({ x: start.x, y: start.y });
        path.reverse();
        return path;
      }

      queue.push({ x: nx, y: ny });
    }
  }

  return null;
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
    const {
      data: { user },
      error: userError,
    } = await authClient.auth.getUser(authToken);
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

    const { campaignId, combatSessionId, actorCombatantId, to, wait } = parsed.data;
    const isWait = Boolean(wait);

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

    const { data: session, error: sessionError } = await svc
      .schema("mythic")
      .from("combat_sessions")
      .select("id, seed, status, current_turn_index")
      .eq("id", combatSessionId)
      .eq("campaign_id", campaignId)
      .maybeSingle<CombatSessionRow>();
    if (sessionError) throw sessionError;
    if (!session) {
      return new Response(JSON.stringify({ error: "Combat session not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (session.status !== "active") {
      return new Response(JSON.stringify({ error: "Combat is not active" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const turnIndex = Number(session.current_turn_index ?? 0);

    const { data: expectedActor, error: expectedActorError } = await svc
      .schema("mythic")
      .from("turn_order")
      .select("combatant_id")
      .eq("combat_session_id", combatSessionId)
      .eq("turn_index", turnIndex)
      .maybeSingle<{ combatant_id: string }>();
    if (expectedActorError) throw expectedActorError;
    if (!expectedActor) {
      return new Response(JSON.stringify({ error: "Turn order is missing" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (expectedActor.combatant_id !== actorCombatantId) {
      return new Response(JSON.stringify({ error: "Not your turn" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: actor, error: actorError } = await svc
      .schema("mythic")
      .from("combatants")
      .select("id,entity_type,player_id,combat_session_id,x,y,mobility,statuses,is_alive")
      .eq("id", actorCombatantId)
      .eq("combat_session_id", combatSessionId)
      .maybeSingle<CombatantRow>();
    if (actorError) throw actorError;
    if (!actor || !actor.is_alive) {
      return new Response(JSON.stringify({ error: "Actor is not alive" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (actor.entity_type === "player" && actor.player_id !== user.id) {
      return new Response(JSON.stringify({ error: "Actor does not belong to you" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: boardRow, error: boardError } = await svc
      .schema("mythic")
      .from("boards")
      .select("state_json")
      .eq("campaign_id", campaignId)
      .eq("combat_session_id", combatSessionId)
      .eq("status", "active")
      .maybeSingle<BoardStateRow>();
    if (boardError) throw boardError;

    const boardState = asObject(boardRow?.state_json);
    const grid = asObject(boardState.grid);
    const width = Math.max(4, Math.floor(asNumber(grid.width, 12)));
    const height = Math.max(4, Math.floor(asNumber(grid.height, 8)));

    const blockedTiles = parseBlockedTiles(boardState.blocked_tiles);
    const blocked = new Set(blockedTiles.map((tile) => key(tile.x, tile.y)));

    const { data: combatants, error: combatantsError } = await svc
      .schema("mythic")
      .from("combatants")
      .select("id,x,y,is_alive")
      .eq("combat_session_id", combatSessionId);
    if (combatantsError) throw combatantsError;

    const occupied = new Set<string>();
    for (const combatant of combatants ?? []) {
      if (!combatant.is_alive) continue;
      if (combatant.id === actor.id) continue;
      occupied.add(key(Math.floor(combatant.x), Math.floor(combatant.y)));
    }

    const budget = movementBudget(actor);

    let destination = { x: Math.floor(actor.x), y: Math.floor(actor.y) };
    let path: Array<{ x: number; y: number }> = [{ x: Math.floor(actor.x), y: Math.floor(actor.y) }];
    let stepsUsed = 0;

    if (!isWait) {
      if (!to) {
        return new Response(JSON.stringify({ error: "Destination is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      destination = { x: Math.floor(to.x), y: Math.floor(to.y) };

      if (budget <= 0) {
        return new Response(JSON.stringify({ error: "Actor is unable to move this turn" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (destination.x < 0 || destination.y < 0 || destination.x >= width || destination.y >= height) {
        return new Response(JSON.stringify({ error: "Destination is outside the combat grid" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (blocked.has(key(destination.x, destination.y))) {
        return new Response(JSON.stringify({ error: "Destination tile is blocked" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (occupied.has(key(destination.x, destination.y))) {
        return new Response(JSON.stringify({ error: "Destination tile is occupied" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const resolvedPath = shortestPath({
        start: { x: Math.floor(actor.x), y: Math.floor(actor.y) },
        end: destination,
        width,
        height,
        blocked,
        occupied,
      });

      if (!resolvedPath) {
        return new Response(JSON.stringify({ error: "No valid route to destination" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      path = resolvedPath;
      stepsUsed = Math.max(0, path.length - 1);
      if (stepsUsed > budget) {
        return new Response(JSON.stringify({ error: `Move exceeds budget (${stepsUsed}/${budget})` }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { error: updateActorError } = await svc
        .schema("mythic")
        .from("combatants")
        .update({
          x: destination.x,
          y: destination.y,
          updated_at: new Date().toISOString(),
        })
        .eq("id", actor.id)
        .eq("combat_session_id", combatSessionId);
      if (updateActorError) throw updateActorError;

      await svc.schema("mythic").rpc("append_action_event", {
        p_combat_session_id: combatSessionId,
        p_turn_index: turnIndex,
        p_actor_combatant_id: actor.id,
        p_event_type: "moved",
        p_payload: {
          from: { x: actor.x, y: actor.y },
          to: destination,
          path,
          movement_budget: budget,
          steps_used: stepsUsed,
          animation_hint: {
            kind: "move",
            duration_ms: 160 + stepsUsed * 55,
            easing: "linear",
          },
        },
      });
    } else {
      await svc.schema("mythic").rpc("append_action_event", {
        p_combat_session_id: combatSessionId,
        p_turn_index: turnIndex,
        p_actor_combatant_id: actor.id,
        p_event_type: "wait",
        p_payload: {
          actor_combatant_id: actor.id,
          movement_budget: budget,
          animation_hint: {
            kind: "idle",
            duration_ms: 250,
          },
        },
      });
    }

    const { data: turnRows, error: turnRowsError } = await svc
      .schema("mythic")
      .from("turn_order")
      .select("turn_index, combatant_id")
      .eq("combat_session_id", combatSessionId)
      .order("turn_index", { ascending: true });
    if (turnRowsError) throw turnRowsError;

    const order = (turnRows ?? []) as TurnOrderRow[];
    if (order.length === 0) {
      throw new Error("Turn order missing");
    }

    const { data: aliveRows, error: aliveRowsError } = await svc
      .schema("mythic")
      .from("combatants")
      .select("id, is_alive")
      .eq("combat_session_id", combatSessionId);
    if (aliveRowsError) throw aliveRowsError;

    const aliveSet = new Set(
      (aliveRows ?? [])
        .filter((row) => row.is_alive)
        .map((row) => row.id),
    );

    let nextIndex = (turnIndex + 1) % order.length;
    for (let i = 0; i < order.length; i += 1) {
      const candidateIndex = (turnIndex + 1 + i) % order.length;
      const candidateCombatantId = order[candidateIndex]!.combatant_id;
      if (aliveSet.has(candidateCombatantId)) {
        nextIndex = candidateIndex;
        break;
      }
    }

    const nextCombatantId = order[nextIndex]!.combatant_id;

    const { error: advanceError } = await svc
      .schema("mythic")
      .from("combat_sessions")
      .update({
        current_turn_index: nextIndex,
        updated_at: new Date().toISOString(),
      })
      .eq("id", combatSessionId)
      .eq("campaign_id", campaignId);
    if (advanceError) throw advanceError;

    await svc.schema("mythic").rpc("append_action_event", {
      p_combat_session_id: combatSessionId,
      p_turn_index: turnIndex,
      p_actor_combatant_id: actor.id,
      p_event_type: "turn_end",
      p_payload: {
        actor_combatant_id: actor.id,
        action: isWait ? "wait" : "move",
      },
    });

    await svc.schema("mythic").rpc("append_action_event", {
      p_combat_session_id: combatSessionId,
      p_turn_index: nextIndex,
      p_actor_combatant_id: nextCombatantId,
      p_event_type: "turn_start",
      p_payload: {
        actor_combatant_id: nextCombatantId,
        animation_hint: {
          kind: "focus",
          duration_ms: 220,
        },
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        moved: !isWait,
        waited: isWait,
        movement_budget: budget,
        steps_used: stepsUsed,
        path,
        to: destination,
        next_turn_index: nextIndex,
        next_actor_combatant_id: nextCombatantId,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("mythic-combat-move error:", error);
    const message = error instanceof Error ? error.message : "Failed to execute combat movement";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
