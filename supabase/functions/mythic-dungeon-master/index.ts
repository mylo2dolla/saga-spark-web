import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aiChatCompletionsStream, resolveModel } from "../_shared/ai_provider.ts";
import { createLogger } from "../_shared/logger.ts";
import { enforceRateLimit } from "../_shared/request_guard.ts";
import { sanitizeError } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(8000),
});

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  messages: z.array(MessageSchema).max(80),
});

function errMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim().length > 0) return msg;
  }
  return fallback;
}

function errCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim().length > 0) return code;
  }
  return null;
}

function errDetails(error: unknown): unknown {
  if (error && typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const details = payload.details ?? payload.hint ?? null;
    return details;
  }
  return null;
}

function jsonOnlyContract() {
  return `
OUTPUT CONTRACT (STRICT)
- Respond with ONE JSON object ONLY. No markdown. No backticks. No prose outside JSON.
- Your JSON must include at minimum: {"narration": string}.
- Optional keys (recommended): scene, npcs, suggestions, effects, loot, persistentData.
- NEVER include sexual content or sexual violence.
- Harsh language allowed. Gore allowed.
`;
}

const MAX_TEXT_FIELD_LEN = 900;
const logger = createLogger("mythic-dungeon-master");

function shortText(value: unknown, maxLen = MAX_TEXT_FIELD_LEN): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...<truncated>`;
}

function compactSkill(skill: Record<string, unknown>) {
  const effectsJson = skill.effects_json && typeof skill.effects_json === "object"
    ? skill.effects_json as Record<string, unknown>
    : null;
  const costJson = skill.cost_json && typeof skill.cost_json === "object"
    ? skill.cost_json as Record<string, unknown>
    : null;
  const targetingJson = skill.targeting_json && typeof skill.targeting_json === "object"
    ? skill.targeting_json as Record<string, unknown>
    : null;
  return {
    id: skill.id ?? null,
    name: skill.name ?? null,
    kind: skill.kind ?? null,
    targeting: skill.targeting ?? null,
    range_tiles: skill.range_tiles ?? null,
    cooldown_turns: skill.cooldown_turns ?? null,
    cost: costJson
      ? {
          resource_id: costJson.resource_id ?? null,
          amount: costJson.amount ?? null,
        }
      : null,
    effect_tags: Array.isArray(effectsJson?.tags) ? effectsJson?.tags : [],
    status_id: effectsJson && typeof effectsJson.status === "object"
      ? (effectsJson.status as Record<string, unknown>).id ?? null
      : null,
    target_shape: targetingJson?.shape ?? null,
    description: shortText(skill.description, 320),
  };
}

function summarizeBoardState(boardType: unknown, stateJson: unknown) {
  const safeType = typeof boardType === "string" ? boardType : "unknown";
  const raw = stateJson && typeof stateJson === "object" ? stateJson as Record<string, unknown> : {};
  if (safeType === "town") {
    const worldSeed =
      raw.world_seed && typeof raw.world_seed === "object"
        ? raw.world_seed as Record<string, unknown>
        : null;
    return {
      template_key: raw.template_key ?? null,
      world_title: worldSeed?.title ?? null,
      world_description: shortText(worldSeed?.description, 240),
      vendor_count: Array.isArray(raw.vendors) ? raw.vendors.length : 0,
      service_count: Array.isArray(raw.services) ? raw.services.length : 0,
      rumor_count: Array.isArray(raw.rumors) ? raw.rumors.length : 0,
      faction_count: Array.isArray(raw.factions_present) ? raw.factions_present.length : 0,
      guard_alertness: raw.guard_alertness ?? null,
    };
  }
  if (safeType === "travel") {
    return {
      weather: raw.weather ?? null,
      hazard_meter: raw.hazard_meter ?? null,
      segment_count: Array.isArray(raw.route_segments) ? raw.route_segments.length : 0,
      encounter_seed_count: Array.isArray(raw.encounter_seeds) ? raw.encounter_seeds.length : 0,
    };
  }
  if (safeType === "dungeon") {
    const roomGraph = raw.room_graph && typeof raw.room_graph === "object"
      ? raw.room_graph as Record<string, unknown>
      : null;
    return {
      room_count: Array.isArray(roomGraph?.rooms) ? roomGraph?.rooms.length : 0,
      loot_nodes: raw.loot_nodes ?? null,
      trap_signals: raw.trap_signals ?? null,
      faction_presence_count: Array.isArray(raw.faction_presence) ? raw.faction_presence.length : 0,
    };
  }
  if (safeType === "combat") {
    const grid = raw.grid && typeof raw.grid === "object" ? raw.grid as Record<string, unknown> : null;
    return {
      combat_session_id: raw.combat_session_id ?? null,
      grid_width: grid?.width ?? null,
      grid_height: grid?.height ?? null,
      blocked_tile_count: Array.isArray(raw.blocked_tiles) ? raw.blocked_tiles.length : 0,
      seed: raw.seed ?? null,
    };
  }
  return {
    board_type: safeType,
  };
}

function compactCharacterPayload(character: unknown) {
  if (!character || typeof character !== "object") return character;
  const raw = character as Record<string, unknown>;
  const skillsRaw = Array.isArray(raw.skills) ? raw.skills : [];
  const compactSkills = skillsRaw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .slice(0, 12)
    .map(compactSkill);
  const classJson = raw.class_json && typeof raw.class_json === "object"
    ? raw.class_json as Record<string, unknown>
    : null;
  const resources = raw.resources && typeof raw.resources === "object"
    ? raw.resources as Record<string, unknown>
    : null;
  const bars = Array.isArray(resources?.bars)
    ? resources?.bars
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .slice(0, 2)
      .map((bar) => ({
        id: bar.id ?? null,
        current: bar.current ?? null,
        max: bar.max ?? null,
      }))
    : [];
  const derived = raw.derived_json && typeof raw.derived_json === "object"
    ? raw.derived_json as Record<string, unknown>
    : null;

  return {
    character_id: raw.character_id ?? null,
    campaign_id: raw.campaign_id ?? null,
    player_id: raw.player_id ?? null,
    name: raw.name ?? null,
    level: raw.level ?? null,
    updated_at: raw.updated_at ?? null,
    base_stats: raw.base_stats ?? null,
    resources: {
      primary_id: resources?.primary_id ?? null,
      bars,
    },
    derived: derived
      ? {
          max_hp: derived.max_hp ?? null,
          max_power_bar: derived.max_power_bar ?? null,
          attack_rating: derived.attack_rating ?? null,
          armor_rating: derived.armor_rating ?? null,
          crit_chance: derived.crit_chance ?? null,
          crit_mult: derived.crit_mult ?? null,
          resist: derived.resist ?? null,
        }
      : null,
    class_json: classJson
      ? {
          class_name: classJson.class_name ?? null,
          role: classJson.role ?? null,
          weapon_family: (classJson.weapon_identity as Record<string, unknown> | null)?.family ?? null,
          weakness: classJson.weakness ?? null,
        }
      : null,
    skills: compactSkills,
  };
}

function compactBoardPayload(board: unknown) {
  if (!board || typeof board !== "object") return board;
  const raw = board as Record<string, unknown>;
  return {
    campaign_id: raw.campaign_id ?? null,
    board_id: raw.board_id ?? null,
    board_type: raw.board_type ?? null,
    status: raw.status ?? null,
    state_summary: summarizeBoardState(raw.board_type, raw.state_json ?? null),
    ui_hints_json: raw.ui_hints_json ?? null,
    active_scene_id: raw.active_scene_id ?? null,
    combat_session_id: raw.combat_session_id ?? null,
    updated_at: raw.updated_at ?? null,
    recent_transitions: raw.recent_transitions ?? null,
  };
}

function compactCombatPayload(combat: unknown) {
  if (!combat || typeof combat !== "object") return combat;
  const raw = combat as Record<string, unknown>;
  const dmPayload = raw.dm_payload && typeof raw.dm_payload === "object"
    ? raw.dm_payload as Record<string, unknown>
    : null;
  const recentEvents = Array.isArray(dmPayload?.recent_events)
    ? dmPayload?.recent_events
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .slice(0, 5)
      .map((event) => ({
        event_type: event.event_type ?? null,
        turn_index: event.turn_index ?? null,
        created_at: event.created_at ?? null,
      }))
    : [];
  return {
    combat_session_id: raw.combat_session_id ?? null,
    campaign_id: raw.campaign_id ?? null,
    status: raw.status ?? null,
    seed: raw.seed ?? null,
    current_turn_index: raw.current_turn_index ?? null,
    scene_json: raw.scene_json ?? null,
    dm_payload: dmPayload
      ? {
          actor: dmPayload.actor ?? null,
          enemies_count: dmPayload.enemies_count ?? null,
          allies_count: dmPayload.allies_count ?? null,
          turn_actor_name: dmPayload.turn_actor_name ?? null,
          recent_events: recentEvents,
        }
      : null,
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

  const rateLimited = enforceRateLimit({
    req,
    route: "mythic-dungeon-master",
    limit: 24,
    windowMs: 60_000,
    corsHeaders,
  });
  if (rateLimited) return rateLimited;

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

    const raw = await req.json().catch(() => null);
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { campaignId, messages } = parsed.data;

    const svc = createClient(supabaseUrl, serviceRoleKey);

    // Canonical rules/script.
    const [{ data: rulesRow, error: rulesError }, { data: scriptRow, error: scriptError }] = await Promise.all([
      svc.schema("mythic").from("game_rules").select("name, version, rules").eq("name", "mythic-weave-rules-v1").maybeSingle(),
      svc
        .schema("mythic")
        .from("generator_scripts")
        .select("name, version, is_active, content")
        .eq("name", "mythic-weave-core")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (rulesError) throw rulesError;
    if (scriptError) throw scriptError;

    const { data: board, error: boardError } = await svc
      .schema("mythic")
      .from("v_board_state_for_dm")
      .select("*")
      .eq("campaign_id", campaignId)
      .maybeSingle();

    if (boardError) throw boardError;

    const preferredCharacterQuery = await svc
      .schema("mythic")
      .from("v_character_state_for_dm")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq("player_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let character = preferredCharacterQuery.data;
    if (preferredCharacterQuery.error) {
      // Backward-compatible fallback for environments where the view is stale.
      const fallbackQuery = await svc
        .schema("mythic")
        .from("v_character_state_for_dm")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("player_id", user.id)
        .limit(1)
        .maybeSingle();
      if (fallbackQuery.error) {
        throw fallbackQuery.error;
      }
      character = fallbackQuery.data;
    }

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

    const { data: dmCampaignState } = await svc
      .schema("mythic")
      .from("dm_campaign_state")
      .select("*")
      .eq("campaign_id", campaignId)
      .maybeSingle();

    const { data: dmWorldTension } = await svc
      .schema("mythic")
      .from("dm_world_tension")
      .select("*")
      .eq("campaign_id", campaignId)
      .maybeSingle();

    const compactRules = {
      name: rulesRow?.name ?? "mythic-weave-rules-v1",
      version: rulesRow?.version ?? null,
      content_policy: (rulesRow?.rules as Record<string, unknown> | null)?.content_policy ?? null,
      boards: (rulesRow?.rules as Record<string, unknown> | null)?.boards
        ? {
            types: ((rulesRow?.rules as Record<string, unknown>).boards as Record<string, unknown>).types ?? null,
            transition_animation: ((rulesRow?.rules as Record<string, unknown>).boards as Record<string, unknown>)
              .transition_animation ?? null,
          }
        : null,
      combat_event_contract: (rulesRow?.rules as Record<string, unknown> | null)?.combat_event_contract
        ? {
            append_only: ((rulesRow?.rules as Record<string, unknown>).combat_event_contract as Record<string, unknown>)
              .append_only ?? null,
            event_types: ((rulesRow?.rules as Record<string, unknown>).combat_event_contract as Record<string, unknown>)
              .event_types ?? null,
          }
        : null,
    };

    const compactScript = {
      name: scriptRow?.name ?? "mythic-weave-core",
      version: scriptRow?.version ?? null,
      is_active: scriptRow?.is_active ?? null,
      key_rules: [
        "DB state is authoritative.",
        "Combat/logs are append-only and deterministic.",
        "Violence/gore allowed; sexual content and sexual violence forbidden.",
        "Grid and board state are truth for narration.",
      ],
    };

    const compactBoard = compactBoardPayload(board);
    const compactCharacter = compactCharacterPayload(character);
    const compactCombat = compactCombatPayload(combat);

    const systemPrompt = `
You are the Mythic Weave Dungeon Master entity.
You must narrate a living dungeon comic that strictly matches authoritative DB state.

AUTHORITATIVE SCRIPT (DB): mythic.generator_scripts(name='mythic-weave-core')
${JSON.stringify(compactScript, null, 2)}

AUTHORITATIVE RULES (DB): mythic.game_rules(name='mythic-weave-rules-v1')
${JSON.stringify(compactRules, null, 2)}

AUTHORITATIVE STATE (DB VIEWS)
- Active board payload (mythic.v_board_state_for_dm):
${JSON.stringify(compactBoard ?? null, null, 2)}

- Player character payload (mythic.v_character_state_for_dm):
${JSON.stringify(compactCharacter ?? null, null, 2)}

- Combat payload (mythic.v_combat_state_for_dm or null):
${JSON.stringify(compactCombat ?? null, null, 2)}

- DM campaign state:
${JSON.stringify(dmCampaignState ?? null, null, 2)}

- DM world tension:
${JSON.stringify(dmWorldTension ?? null, null, 2)}

RULES YOU MUST OBEY
- Grid is truth. Never invent positions, HP, items, skills.
- Determinism: if you reference a roll, it must be described as coming from action_events / compute_damage output.
- No dice UI; show rolls as comic visuals tied to the combat engine.
- Violence/gore allowed. Harsh language allowed.
- Sexual content and sexual violence are forbidden.
${jsonOnlyContract()}
`;

    const model = resolveModel({ openai: "gpt-4o-mini", groq: "llama-3.3-70b-versatile" });
    logger.info("dm.request.start", {
      campaign_id: campaignId,
      user_id: user.id,
      board_type: (compactBoard as Record<string, unknown> | null)?.board_type ?? null,
      has_character: Boolean(compactCharacter),
      has_combat: Boolean(compactCombat),
      model,
    });

    const response = await aiChatCompletionsStream({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      stream: true,
      temperature: 0.7,
    });

    // Proxy streaming response directly.
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type": response.headers.get("Content-Type") ?? "text/event-stream",
      },
    });
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("dm.request.failed", error);
    const code = errCode(error) ?? normalized.code ?? "dm_request_failed";
    const message = errMessage(error, normalized.message || "Failed to reach Mythic DM");
    return new Response(
      JSON.stringify({
        error: message,
        status: 500,
        code,
        details: errDetails(error),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
