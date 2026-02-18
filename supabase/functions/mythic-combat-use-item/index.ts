import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TargetSchema = z.union([
  z.object({ kind: z.literal("self") }),
  z.object({ kind: z.literal("combatant"), combatant_id: z.string().uuid() }),
  z.object({ kind: z.literal("tile"), x: z.number().int(), y: z.number().int() }),
]);

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  combatSessionId: z.string().uuid(),
  actorCombatantId: z.string().uuid(),
  inventoryItemId: z.string().uuid(),
  target: TargetSchema.optional(),
});

type CombatantRow = {
  id: string;
  entity_type: "player" | "npc" | "summon";
  player_id: string | null;
  character_id: string | null;
  x: number;
  y: number;
  hp: number;
  hp_max: number;
  power: number;
  power_max: number;
  armor: number;
  statuses: unknown;
  is_alive: boolean;
};

type TurnOrderRow = {
  turn_index: number;
  combatant_id: string;
};

type ItemRow = {
  id: string;
  name: string;
  item_type: string;
  slot: string;
  effects_json: Record<string, unknown> | null;
};

type InventoryRow = {
  id: string;
  character_id: string;
  item_id: string;
  quantity: number;
  container: string;
};

type BoardRow = {
  id: string;
  board_type: string;
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

function readEffectAmount(
  effects: Record<string, unknown>,
  key: string,
  fallback = 0,
): number {
  const value = effects[key];
  if (typeof value === "number") return Math.max(0, Math.floor(value));
  const nested = asObject(value);
  const nestedAmount = asNumber(nested.amount, fallback);
  return Math.max(0, Math.floor(nestedAmount));
}

function nowStatuses(raw: unknown): Array<{ id: string; expires_turn: number | null; stacks?: number; data?: Record<string, unknown> }> {
  return asArray(raw)
    .map((entry) => asObject(entry))
    .map((entry) => ({
      id: String(entry.id ?? ""),
      expires_turn:
        entry.expires_turn === null || entry.expires_turn === undefined
          ? null
          : Number(entry.expires_turn),
      stacks: entry.stacks === undefined ? undefined : Number(entry.stacks),
      data: asObject(entry.data),
    }))
    .filter((entry) => entry.id.length > 0);
}

function stripStatuses(statuses: Array<{ id: string; expires_turn: number | null; stacks?: number; data?: Record<string, unknown> }>, removeIds: string[]): Array<{ id: string; expires_turn: number | null; stacks?: number; data?: Record<string, unknown> }> {
  if (removeIds.length === 0) {
    return statuses.filter((status) => !status.id.startsWith("cd:"));
  }
  const set = new Set(removeIds);
  return statuses.filter((status) => !set.has(status.id));
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

    const {
      campaignId,
      combatSessionId,
      actorCombatantId,
      inventoryItemId,
      target = { kind: "self" },
    } = parsed.data;

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
      .maybeSingle();
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
      .select("*")
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

    if (!actor.character_id) {
      return new Response(JSON.stringify({ error: "Actor has no character inventory" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: inventoryRow, error: inventoryError } = await svc
      .schema("mythic")
      .from("inventory")
      .select("id, character_id, item_id, quantity, container")
      .eq("id", inventoryItemId)
      .eq("character_id", actor.character_id)
      .maybeSingle<InventoryRow>();
    if (inventoryError) throw inventoryError;
    if (!inventoryRow) {
      return new Response(JSON.stringify({ error: "Inventory item not found for actor" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (inventoryRow.quantity <= 0) {
      return new Response(JSON.stringify({ error: "Item is depleted" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: item, error: itemError } = await svc
      .schema("mythic")
      .from("items")
      .select("id, name, item_type, slot, effects_json")
      .eq("id", inventoryRow.item_id)
      .maybeSingle<ItemRow>();
    if (itemError) throw itemError;
    if (!item) {
      return new Response(JSON.stringify({ error: "Item record is missing" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: allCombatants, error: allCombatantsError } = await svc
      .schema("mythic")
      .from("combatants")
      .select("*")
      .eq("combat_session_id", combatSessionId);
    if (allCombatantsError) throw allCombatantsError;

    const combatants = (allCombatants ?? []) as CombatantRow[];
    const byId = new Map(combatants.map((combatant) => [combatant.id, combatant]));

    const resolvedTarget = (() => {
      if (target.kind === "self") return actor;
      if (target.kind === "combatant") return byId.get(target.combatant_id) ?? null;
      return combatants.find((combatant) => combatant.x === target.x && combatant.y === target.y) ?? null;
    })();

    if (!resolvedTarget || !resolvedTarget.is_alive) {
      return new Response(JSON.stringify({ error: "Target not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const effects = asObject(item.effects_json);
    const healAmount = readEffectAmount(effects, "heal", item.item_type === "consumable" ? 32 : 0);
    const powerAmount = readEffectAmount(effects, "power_gain", 0);
    const damageAmount = readEffectAmount(effects, "damage", 0);

    const cleanseIds = asArray(asObject(effects.cleanse).ids)
      .map((entry) => String(entry))
      .filter((entry) => entry.length > 0);

    const events: Array<{ turnIndex: number; actorId: string | null; eventType: string; payload: Record<string, unknown> }> = [];

    events.push({
      turnIndex,
      actorId: actor.id,
      eventType: "item_used",
      payload: {
        inventory_item_id: inventoryRow.id,
        item_id: item.id,
        item_name: item.name,
        target_combatant_id: resolvedTarget.id,
        target_kind: target.kind,
        animation_hint: {
          kind: "item_use",
          duration_ms: 280,
        },
      },
    });

    if (healAmount > 0) {
      const healTargetHp = Math.min(resolvedTarget.hp_max, Number(resolvedTarget.hp) + healAmount);
      const { error: healUpdateError } = await svc
        .schema("mythic")
        .from("combatants")
        .update({
          hp: healTargetHp,
          updated_at: new Date().toISOString(),
        })
        .eq("id", resolvedTarget.id)
        .eq("combat_session_id", combatSessionId);
      if (healUpdateError) throw healUpdateError;

      events.push({
        turnIndex,
        actorId: actor.id,
        eventType: "healed",
        payload: {
          target_combatant_id: resolvedTarget.id,
          amount: healAmount,
          hp_after: healTargetHp,
          animation_hint: {
            kind: "heal",
            duration_ms: 220,
          },
        },
      });
    }

    if (powerAmount > 0) {
      const nextPower = Math.min(actor.power_max, Number(actor.power) + powerAmount);
      const { error: powerError } = await svc
        .schema("mythic")
        .from("combatants")
        .update({
          power: nextPower,
          updated_at: new Date().toISOString(),
        })
        .eq("id", actor.id)
        .eq("combat_session_id", combatSessionId);
      if (powerError) throw powerError;

      events.push({
        turnIndex,
        actorId: actor.id,
        eventType: "power_gain",
        payload: {
          target_combatant_id: actor.id,
          amount: powerAmount,
          power_after: nextPower,
          animation_hint: {
            kind: "resource_gain",
            duration_ms: 200,
          },
        },
      });
    }

    if (cleanseIds.length > 0) {
      const statuses = nowStatuses(resolvedTarget.statuses);
      const nextStatuses = stripStatuses(statuses, cleanseIds);
      const { error: cleanseError } = await svc
        .schema("mythic")
        .from("combatants")
        .update({
          statuses: nextStatuses,
          updated_at: new Date().toISOString(),
        })
        .eq("id", resolvedTarget.id)
        .eq("combat_session_id", combatSessionId);
      if (cleanseError) throw cleanseError;

      events.push({
        turnIndex,
        actorId: actor.id,
        eventType: "cleanse",
        payload: {
          target_combatant_id: resolvedTarget.id,
          ids: cleanseIds,
          animation_hint: {
            kind: "cleanse",
            duration_ms: 190,
          },
        },
      });
    }

    if (damageAmount > 0) {
      const hpAfter = Math.max(0, Number(resolvedTarget.hp) - damageAmount);
      const died = hpAfter <= 0;
      const { error: damageError } = await svc
        .schema("mythic")
        .from("combatants")
        .update({
          hp: hpAfter,
          is_alive: died ? false : resolvedTarget.is_alive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", resolvedTarget.id)
        .eq("combat_session_id", combatSessionId);
      if (damageError) throw damageError;

      events.push({
        turnIndex,
        actorId: actor.id,
        eventType: "damage",
        payload: {
          source_combatant_id: actor.id,
          target_combatant_id: resolvedTarget.id,
          damage_to_hp: damageAmount,
          hp_after: hpAfter,
          animation_hint: {
            kind: died ? "critical_hit" : "hit",
            duration_ms: died ? 320 : 220,
          },
        },
      });

      if (died) {
        events.push({
          turnIndex,
          actorId: actor.id,
          eventType: "death",
          payload: {
            target_combatant_id: resolvedTarget.id,
            by: {
              combatant_id: actor.id,
              item_id: item.id,
            },
          },
        });
      }
    }

    if (inventoryRow.quantity > 1) {
      const { error: quantityError } = await svc
        .schema("mythic")
        .from("inventory")
        .update({
          quantity: inventoryRow.quantity - 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", inventoryRow.id)
        .eq("character_id", inventoryRow.character_id);
      if (quantityError) throw quantityError;
    } else {
      const { error: deleteError } = await svc
        .schema("mythic")
        .from("inventory")
        .delete()
        .eq("id", inventoryRow.id)
        .eq("character_id", inventoryRow.character_id);
      if (deleteError) throw deleteError;
    }

    for (const event of events) {
      await svc.schema("mythic").rpc("append_action_event", {
        p_combat_session_id: combatSessionId,
        p_turn_index: event.turnIndex,
        p_actor_combatant_id: event.actorId,
        p_event_type: event.eventType,
        p_payload: event.payload,
      });
    }

    const { data: aliveCombatants, error: aliveCombatantsError } = await svc
      .schema("mythic")
      .from("combatants")
      .select("id, entity_type, is_alive")
      .eq("combat_session_id", combatSessionId);
    if (aliveCombatantsError) throw aliveCombatantsError;

    const alivePlayers = (aliveCombatants ?? []).filter((combatant) => combatant.is_alive && combatant.entity_type === "player").length;
    const aliveNpcs = (aliveCombatants ?? []).filter((combatant) => combatant.is_alive && combatant.entity_type === "npc").length;

    if (alivePlayers === 0 || aliveNpcs === 0) {
      await svc.schema("mythic").rpc("end_combat_session", {
        p_combat_session_id: combatSessionId,
        p_outcome: {
          alive_players: alivePlayers,
          alive_npcs: aliveNpcs,
        },
      });

      const { data: lastBoard } = await svc
        .schema("mythic")
        .from("boards")
        .select("id, board_type")
        .eq("campaign_id", campaignId)
        .neq("board_type", "combat")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle<BoardRow>();

      if (lastBoard) {
        await svc
          .schema("mythic")
          .from("boards")
          .update({ status: "active", updated_at: new Date().toISOString() })
          .eq("id", lastBoard.id);

        await svc
          .schema("mythic")
          .from("boards")
          .update({ status: "archived", updated_at: new Date().toISOString() })
          .eq("combat_session_id", combatSessionId);

        await svc
          .schema("mythic")
          .from("board_transitions")
          .insert({
            campaign_id: campaignId,
            from_board_type: "combat",
            to_board_type: lastBoard.board_type,
            reason: "combat_end",
            animation: "page_turn",
            payload_json: {
              combat_session_id: combatSessionId,
              outcome: {
                alive_players: alivePlayers,
                alive_npcs: aliveNpcs,
              },
            },
          });
      }

      return new Response(JSON.stringify({
        ok: true,
        ended: true,
        rewards_ready: true,
        outcome: {
          alive_players: alivePlayers,
          alive_npcs: aliveNpcs,
        },
        animation_hint: {
          kind: "combat_end_page_flip",
          duration_ms: 420,
        },
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    if (order.length === 0) throw new Error("Turn order missing");

    const aliveSet = new Set((aliveCombatants ?? []).filter((combatant) => combatant.is_alive).map((combatant) => combatant.id));
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
      .update({ current_turn_index: nextIndex, updated_at: new Date().toISOString() })
      .eq("id", combatSessionId)
      .eq("campaign_id", campaignId);
    if (advanceError) throw advanceError;

    await svc.schema("mythic").rpc("append_action_event", {
      p_combat_session_id: combatSessionId,
      p_turn_index: turnIndex,
      p_actor_combatant_id: actor.id,
      p_event_type: "turn_end",
      p_payload: { actor_combatant_id: actor.id, action: "item" },
    });

    await svc.schema("mythic").rpc("append_action_event", {
      p_combat_session_id: combatSessionId,
      p_turn_index: nextIndex,
      p_actor_combatant_id: nextCombatantId,
      p_event_type: "turn_start",
      p_payload: {
        actor_combatant_id: nextCombatantId,
        animation_hint: {
          kind: "turn_advance",
          duration_ms: 220,
        },
      },
    });

    return new Response(JSON.stringify({
      ok: true,
      ended: false,
      next_turn_index: nextIndex,
      next_actor_combatant_id: nextCombatantId,
      item_used: {
        inventory_item_id: inventoryRow.id,
        item_id: item.id,
        item_name: item.name,
      },
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-combat-use-item error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to use item" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
