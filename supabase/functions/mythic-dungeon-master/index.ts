import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { mythicOpenAIChatCompletions } from "../_shared/ai_provider.ts";
import { createLogger } from "../_shared/logger.ts";
import { enforceRateLimit } from "../_shared/request_guard.ts";
import { sanitizeError } from "../_shared/redact.ts";
import { normalizeWorldPatches, parseDmNarratorOutput } from "../_shared/turn_contract.ts";
import { computeTurnSeed } from "../_shared/turn_seed.ts";
import { createTurnPrng } from "../_shared/turn_prng.ts";

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
  actionContext: z.record(z.unknown()).nullable().optional(),
});
const requestIdFrom = (req: Request) =>
  req.headers.get("x-request-id")
  ?? req.headers.get("x-correlation-id")
  ?? req.headers.get("x-vercel-id")
  ?? crypto.randomUUID();

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

function errStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const value = Number((error as { status?: unknown }).status);
    if (Number.isFinite(value) && value >= 400 && value <= 599) return value;
  }
  return null;
}

function jsonOnlyContract() {
  return `
OUTPUT CONTRACT (STRICT)
- Respond with ONE JSON object ONLY. No markdown. No backticks. No prose outside JSON.
- Your JSON must include at minimum: {"narration": string}.
- Strongly include:
  - "scene": object with visual hints for board rendering from DB state (never fabricated stats/ids).
    Include board-synced hints when applicable: "environment", "mood", "focus", "travel_goal".
  - "effects": object with optional ambient/comic effect hints.
- Optional:
  - "ui_actions": array of intent suggestions (0-4 items; may be empty or omitted).
    Each action item should be an object with:
    - id (string), label (string), intent (string), optional prompt (string), optional payload (object).
    When suggesting a shop/vendor in town:
    - intent MUST be "shop"
    - payload MUST include {"vendorId": "<id from board.state_summary.vendors>"}.
  - "patches": array of world patch objects (may be empty). Supported patch ops:
    - FACT_CREATE / FACT_SUPERSEDE (fact_key, data)
    - ENTITY_UPSERT (entity_key, entity_type, data, tags[])
    - REL_SET (subject_key, object_key, rel_type, data)
    - QUEST_UPSERT (quest_key, data)
    - LOCATION_STATE_UPDATE (location_key, data)
  - "roll_log": array of deterministic roll log entries (may be empty).
- Optional keys: npcs, suggestions, loot, persistentData.
- Allowed: gore/violence/profanity, mild sexuality and playful sexy banter.
- Forbidden: sexual violence, coercion, rape, underage sexual content, pornographic explicit content.
- Harsh language allowed. Gore allowed.
`;
}

const MAX_TEXT_FIELD_LEN = 900;
const logger = createLogger("mythic-dungeon-master");

function streamOpenAiDelta(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunkSize = 120;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        for (let i = 0; i < text.length; i += chunkSize) {
          const chunk = text.slice(i, i + chunkSize);
          const payload = {
            choices: [{ delta: { content: chunk } }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

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
    const vendorsRaw = Array.isArray(raw.vendors) ? raw.vendors : [];
    const vendors = vendorsRaw
      .slice(0, 6)
      .map((entry, index) => {
        if (!entry) return null;
        if (typeof entry === "string") {
          return { id: `vendor_${index + 1}`, name: entry.slice(0, 64), services: [] as string[] };
        }
        if (typeof entry !== "object") return null;
        const vendor = entry as Record<string, unknown>;
        const id = typeof vendor.id === "string" && vendor.id.trim().length > 0 ? vendor.id.trim() : `vendor_${index + 1}`;
        const name = typeof vendor.name === "string" && vendor.name.trim().length > 0 ? vendor.name.trim() : `Vendor ${index + 1}`;
        const services = Array.isArray(vendor.services)
          ? vendor.services.filter((svc): svc is string => typeof svc === "string").slice(0, 4)
          : [];
        return { id, name, services };
      })
      .filter((entry): entry is { id: string; name: string; services: string[] } => Boolean(entry));
    return {
      template_key: raw.template_key ?? null,
      world_title: worldSeed?.title ?? null,
      world_description: shortText(worldSeed?.description, 240),
      vendor_count: Array.isArray(raw.vendors) ? raw.vendors.length : 0,
      vendors,
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
      travel_goal: raw.travel_goal ?? null,
      search_target: raw.search_target ?? null,
      dungeon_traces_found: raw.dungeon_traces_found ?? null,
      discovery_flags: raw.discovery_flags ?? null,
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
  const requestId = requestIdFrom(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed", code: "method_not_allowed", requestId }), {
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
      return new Response(JSON.stringify({ error: "Authentication required", code: "auth_required", requestId }), {
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
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token", code: "auth_invalid", requestId }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const raw = await req.json().catch(() => null);
    const parsed = RequestSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { campaignId, messages, actionContext } = parsed.data;

    const svc = createClient(supabaseUrl, serviceRoleKey);
    const warnings: string[] = [];

    // Authorization: explicit membership/owner check since service role bypasses RLS.
    const [{ data: campaignRow, error: campaignErr }, { data: memberRow, error: memberErr }] = await Promise.all([
      svc.from("campaigns").select("id, owner_id, is_active").eq("id", campaignId).maybeSingle(),
      svc.from("campaign_members").select("id").eq("campaign_id", campaignId).eq("user_id", user.id).maybeSingle(),
    ]);
    if (campaignErr) throw campaignErr;
    if (memberErr) throw memberErr;
    const isOwner = campaignRow?.owner_id === user.id;
    const isMember = Boolean(memberRow);
    if (!campaignRow || !campaignRow.is_active || (!isOwner && !isMember)) {
      return new Response(
        JSON.stringify({ error: "Campaign not found or access denied", code: "campaign_denied", requestId }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Turn context: compute next turn index and a deterministic seed up-front.
    const { data: latestTurn, error: latestTurnErr } = await svc
      .schema("mythic")
      .from("turns")
      .select("turn_index")
      .eq("campaign_id", campaignId)
      .order("turn_index", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestTurnErr) {
      logger.error("dm.turn_index.failed", latestTurnErr, { request_id: requestId, campaign_id: campaignId });
      return new Response(
        JSON.stringify({
          error: "Turn engine not ready (missing mythic.turns). Apply migrations and retry.",
          code: "turn_engine_not_ready",
          details: { hint: errMessage(latestTurnErr, "query failed") },
          requestId,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const expectedTurnIndex = (latestTurn?.turn_index ?? -1) + 1;
    const salt = (Deno.env.get("MYTHIC_TURN_SALT") ?? "").trim();
    if (!salt) {
      warnings.push("missing_turn_salt:determinism_weak");
    }
    const turnSeed = await computeTurnSeed({
      campaignSeed: campaignId,
      turnIndex: expectedTurnIndex,
      playerId: user.id,
      salt,
    });

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

    let board: Record<string, unknown> | null = null;
    {
      const boardView = await svc
        .schema("mythic")
        .from("v_board_state_for_dm")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("updated_at", { ascending: false })
        .limit(2);
      if (boardView.error) {
        warnings.push(`v_board_state_for_dm unavailable: ${errMessage(boardView.error, "query failed")}`);
      } else {
        const rows = ((boardView.data ?? []) as Record<string, unknown>[]);
        if (rows.length > 1) {
          warnings.push("duplicate_active_boards_detected:using_latest_view_row");
        }
        board = rows[0] ?? null;
      }

      if (!board) {
        const fallback = await svc
          .schema("mythic")
          .from("boards")
          .select("id,campaign_id,board_type,status,state_json,ui_hints_json,active_scene_id,combat_session_id,updated_at")
          .eq("campaign_id", campaignId)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(2);
        if (fallback.error) {
          warnings.push(`boards fallback failed: ${errMessage(fallback.error, "query failed")}`);
        } else {
          const rows = ((fallback.data ?? []) as Record<string, unknown>[]);
          if (rows.length > 1) {
            warnings.push("duplicate_active_boards_detected:using_latest_board_row");
          }
          board = rows[0] ?? null;
        }
      }
    }

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
        "Violence/gore allowed; mild sexuality/banter allowed; sexual violence/coercion forbidden.",
        "Grid and board state are truth for narration.",
      ],
    };

    const compactBoard = compactBoardPayload(board);
    const compactCharacter = compactCharacterPayload(character);
    const compactCombat = compactCombatPayload(combat);

    const prng = createTurnPrng(turnSeed);
    // Consume deterministic rolls in a stable order. These are authoritative for the turn.
    const rollContext = (() => {
      const boardType = (compactBoard as Record<string, unknown> | null)?.board_type;
      const bt = typeof boardType === "string" ? boardType : "unknown";
      // A couple of general-purpose rolls used for pacing/scene variation.
      const scene_variant = prng.next01("scene_variant", { board_type: bt });
      const tension = prng.next01("tension", { board_type: bt });
      // Board-specific rolls (kept minimal for now, but logged for replay).
      const encounter = prng.next01("encounter_check", { board_type: bt });
      const discovery = prng.next01("discovery_check", { board_type: bt });
      return { board_type: bt, scene_variant, tension, encounter, discovery };
    })();

    const allowedVendorIds = (() => {
      const vendors = (compactBoard as Record<string, unknown> | null)?.state_summary
        && typeof (compactBoard as Record<string, unknown>).state_summary === "object"
        ? ((compactBoard as Record<string, unknown>).state_summary as Record<string, unknown>).vendors
        : null;
      if (!Array.isArray(vendors)) return new Set<string>();
      const ids = vendors
        .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).id : null))
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim());
      return new Set(ids);
    })();

    const systemPrompt = `
You are the Mythic Weave Dungeon Master entity.
You must narrate a living dungeon comic that strictly matches authoritative DB state.

TURN CONTEXT (DETERMINISTIC, AUTHORITATIVE)
${JSON.stringify({ expected_turn_index: expectedTurnIndex, turn_seed: turnSeed.toString(), rolls: rollContext }, null, 2)}

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

- Recent command execution context (authoritative client action result, may be null):
${JSON.stringify(actionContext ?? null, null, 2)}

- Runtime warnings:
${JSON.stringify(warnings, null, 2)}

RULES YOU MUST OBEY
- Grid is truth. Never invent positions, HP, items, skills.
- Determinism: if you reference a roll, it must be described as coming from action_events / compute_damage output.
- No dice UI; show rolls as comic visuals tied to the combat engine.
- Narration quality is primary. scene/effects should help render visual board state updates.
- If command execution context is provided, narrate outcomes using that state delta and avoid contradiction.
- Violence/gore allowed. Harsh language allowed.
- Mild sexuality / playful sexy banter allowed.
- Sexual violence, coercion, rape, underage sexual content, and pornographic explicit content are forbidden.
${jsonOnlyContract()}
`;

    const requestedModel = "gpt-4o-mini";
    logger.info("dm.request.start", {
      campaign_id: campaignId,
      user_id: user.id,
      board_type: (compactBoard as Record<string, unknown> | null)?.board_type ?? null,
      has_character: Boolean(compactCharacter),
      has_combat: Boolean(compactCombat),
      model: requestedModel,
      provider: "openai",
      request_id: requestId,
      warning_count: warnings.length,
    });

    const maxAttempts = 2;
    let lastErrors: string[] = [];
    let dmText = "";
    let dmParsed: ReturnType<typeof parseDmNarratorOutput> | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const attemptMessages = attempt === 1
        ? [{ role: "system" as const, content: systemPrompt }, ...messages]
        : [
          { role: "system" as const, content: systemPrompt },
          ...messages,
          {
            role: "system" as const,
            content: `Validation errors on previous output: ${JSON.stringify(lastErrors).slice(0, 2000)}. Regenerate a single valid JSON object that satisfies the contract exactly.`,
          },
        ];

      const { data, model } = await mythicOpenAIChatCompletions(
        {
          messages: attemptMessages,
          stream: false,
          temperature: 0.7,
        },
        requestedModel,
      );

      const rawContent = (data as Record<string, unknown>)?.choices
        && Array.isArray((data as Record<string, unknown>).choices)
        ? (((data as { choices: Array<{ message?: { content?: unknown } }> }).choices[0]?.message?.content) ?? "")
        : "";
      dmText = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");

      const parsedOut = parseDmNarratorOutput(dmText);
      if (!parsedOut.ok) {
        lastErrors = parsedOut.errors;
        logger.warn("dm.request.validation_failed", { attempt, model, request_id: requestId, errors: lastErrors });
        dmParsed = parsedOut;
        continue;
      }

      // Additional validation: if suggesting shop actions, vendorId must match board summary.
      const actions = parsedOut.value.ui_actions ?? [];
      const badShop = actions.find((action) => {
        if (action.intent !== "shop") return false;
        const vendorId = (action.payload as Record<string, unknown> | undefined)?.vendorId;
        return typeof vendorId !== "string" || !allowedVendorIds.has(vendorId);
      });
      if (badShop) {
        const vendorId = (badShop.payload as Record<string, unknown> | undefined)?.vendorId;
        lastErrors = [`ui_actions.shop.vendorId_invalid:${typeof vendorId === "string" ? vendorId : "missing"}`];
        logger.warn("dm.request.validation_failed", { attempt, model, request_id: requestId, errors: lastErrors });
        dmParsed = { ok: false, errors: lastErrors };
        continue;
      }

      dmParsed = parsedOut;
      break;
    }

    if (!dmParsed || !dmParsed.ok) {
      logger.error("dm.request.rejected", new Error("dm_validation_failed"), { request_id: requestId, errors: lastErrors });
      const fallback = {
        schema_version: "mythic.dm.narrator.v1",
        narration: "The story stutters and resets. Rephrase your action and try again.",
        scene: { mood: "glitch", focus: "retry" },
      };
      const text = JSON.stringify(fallback);
      return new Response(streamOpenAiDelta(text), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "x-request-id": requestId,
        },
      });
    }

    const boardType = (compactBoard as Record<string, unknown> | null)?.board_type;
    const boardId = (compactBoard as Record<string, unknown> | null)?.board_id;
    if (typeof boardType !== "string" || typeof boardId !== "string") {
      return new Response(JSON.stringify({ error: "Active board not found", code: "board_not_found", requestId }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { patches, dropped } = normalizeWorldPatches(dmParsed.value.patches);
    if (dropped > 0) {
      warnings.push(`dropped_invalid_patches:${dropped}`);
    }

    const dmRequestJson = {
      schema_version: "mythic.turn.request.v1",
      campaign_id: campaignId,
      player_id: user.id,
      board_id: boardId,
      board_type: boardType,
      expected_turn_index: expectedTurnIndex,
      turn_seed: turnSeed.toString(),
      model: requestedModel,
      messages,
      actionContext: actionContext ?? null,
      warnings,
    };

    const dmResponseJson: Record<string, unknown> = {
      ...dmParsed.value,
      schema_version: dmParsed.value.schema_version ?? "mythic.dm.narrator.v1",
      roll_log: prng.rollLog,
      turn: {
        expected_turn_index: expectedTurnIndex,
        turn_seed: turnSeed.toString(),
      },
    };

    const commit = await svc.rpc("mythic_commit_turn", {
      campaign_id: campaignId,
      player_id: user.id,
      board_id: boardId,
      board_type: boardType,
      turn_seed: turnSeed.toString(),
      dm_request_json: dmRequestJson,
      dm_response_json: dmResponseJson,
      patches_json: patches,
      roll_log_json: prng.rollLog,
    });
    if (commit.error) {
      logger.error("dm.turn_commit.failed", commit.error, { request_id: requestId, campaign_id: campaignId });
      const msg = errMessage(commit.error, "unknown");
      const isConflict = String((commit.error as { code?: unknown }).code ?? "").includes("40001")
        || msg.includes("expected_turn_index_")
        || msg.includes("40001");
      return new Response(
        JSON.stringify({
          error: isConflict
            ? "Another turn committed concurrently. Retry your action."
            : `Failed to commit turn: ${msg}`,
          code: isConflict ? "turn_conflict" : "turn_commit_failed",
          requestId,
        }),
        { status: isConflict ? 409 : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const commitPayload = commit.data && typeof commit.data === "object" ? commit.data as Record<string, unknown> : null;
    if (commitPayload?.ok !== true) {
      logger.error("dm.turn_commit.rejected", new Error("turn_commit_rejected"), { request_id: requestId, commit: commitPayload });
      return new Response(
        JSON.stringify({
          error: "Turn commit rejected",
          code: "turn_commit_rejected",
          details: commitPayload,
          requestId,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    dmResponseJson.meta = {
      ...(typeof dmResponseJson.meta === "object" && dmResponseJson.meta ? dmResponseJson.meta : {}),
      turn_id: commitPayload.turn_id ?? null,
      turn_index: commitPayload.turn_index ?? expectedTurnIndex,
      turn_seed: turnSeed.toString(),
    };

    const outText = JSON.stringify(dmResponseJson);
    return new Response(streamOpenAiDelta(outText), {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("dm.request.failed", error, { request_id: requestId });
    const code = errCode(error) ?? normalized.code ?? "dm_request_failed";
    const message = errMessage(error, normalized.message || "Failed to reach Mythic DM");
    const status = errStatus(error) ?? (code === "openai_not_configured" ? 503 : 500);
    return new Response(
      JSON.stringify({
        error: message,
        status,
        code,
        details: errDetails(error),
        requestId,
      }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
