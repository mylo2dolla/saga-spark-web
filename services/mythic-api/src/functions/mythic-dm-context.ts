import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { enforceRateLimit } from "../shared/request_guard.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
});

const errMessage = (err: unknown, fallback: string) => {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim().length > 0) return msg;
  }
  return fallback;
};

const MAX_TEXT_FIELD_LEN = 900;

function shortText(value: unknown, maxLen = MAX_TEXT_FIELD_LEN): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...<truncated>`;
}

function sampleEntries(value: unknown, maxItems = 4): unknown[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string" || (entry && typeof entry === "object"))
    .slice(0, maxItems)
    .map((entry) => {
      if (typeof entry === "string") return shortText(entry, 180);
      return entry;
    })
    .filter(Boolean) as unknown[];
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
    description: shortText(skill.description, 320),
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
  };
}

function summarizeBoardState(boardType: unknown, stateJson: unknown) {
  const safeType = typeof boardType === "string" ? boardType : "unknown";
  const raw = stateJson && typeof stateJson === "object" ? stateJson as Record<string, unknown> : {};
  const companionPresence = sampleEntries(raw.companion_presence, 3);
  const companionCheckins = sampleEntries(raw.companion_checkins, 3);
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
      rumor_samples: sampleEntries(raw.rumors, 4),
      objective_samples: sampleEntries(raw.objectives, 4),
      faction_count: Array.isArray(raw.factions_present) ? raw.factions_present.length : 0,
      guard_alertness: raw.guard_alertness ?? null,
      companion_presence: companionPresence,
      companion_checkins: companionCheckins,
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
      segment_samples: sampleEntries(raw.route_segments, 4),
      encounter_seed_count: Array.isArray(raw.encounter_seeds) ? raw.encounter_seeds.length : 0,
      discovery_samples: sampleEntries(raw.discovery_log, 4),
      companion_presence: companionPresence,
      companion_checkins: companionCheckins,
    };
  }
  if (safeType === "dungeon") {
    const roomGraph = raw.room_graph && typeof raw.room_graph === "object"
      ? raw.room_graph as Record<string, unknown>
      : null;
    return {
      room_count: Array.isArray(roomGraph?.rooms) ? roomGraph?.rooms.length : 0,
      room_samples: sampleEntries(roomGraph?.rooms, 4),
      loot_nodes: raw.loot_nodes ?? null,
      trap_signals: raw.trap_signals ?? null,
      faction_presence_count: Array.isArray(raw.faction_presence) ? raw.faction_presence.length : 0,
      objective_samples: sampleEntries(raw.objectives, 4),
      discovery_samples: sampleEntries(raw.discovery_log, 4),
      companion_presence: companionPresence,
      companion_checkins: companionCheckins,
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
      scene_cache: raw.scene_cache ?? null,
      companion_checkins: companionCheckins,
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
    character_id: raw.character_id ?? raw.id ?? null,
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
  const boardType = raw.board_type ?? raw.mode ?? null;
  return {
    campaign_id: raw.campaign_id ?? null,
    board_id: raw.board_id ?? raw.id ?? null,
    board_type: boardType,
    status: raw.status ?? null,
    state_summary: summarizeBoardState(boardType, raw.state_json ?? null),
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
    combat_session_id: raw.combat_session_id ?? raw.id ?? null,
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

export const mythicDmContext: FunctionHandler = {
  name: "mythic-dm-context",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-dm-context",
      limit: 60,
      windowMs: 60_000,
      corsHeaders: {},
      requestId: ctx.requestId,
    });
    if (rateLimited) return rateLimited;

    try {
      const user = await requireUser(req.headers);

      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId: ctx.requestId }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { campaignId } = parsed.data;
      const svc = createServiceClient();
      await assertCampaignAccess(svc, campaignId, user.userId);

      const warnings: string[] = [];

      // Authoritative runtime payload.
      let board: Record<string, unknown> | null = null;
      {
        const runtimeQuery = await svc
          .schema("mythic")
          .from("campaign_runtime")
          .select("id,campaign_id,mode,status,state_json,ui_hints_json,combat_session_id,updated_at")
          .eq("campaign_id", campaignId)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(2);
        if (runtimeQuery.error) {
          warnings.push(`campaign_runtime unavailable: ${errMessage(runtimeQuery.error, "query failed")}`);
        } else {
          const rows = ((runtimeQuery.data ?? []) as Record<string, unknown>[]);
          if (rows.length > 1) {
            warnings.push("duplicate_active_runtime_rows_detected:using_latest_runtime_row");
          }
          const activeRuntime = rows[0] ?? null;
          if (activeRuntime) {
            const transitions = await svc
              .schema("mythic")
              .from("runtime_events")
              .select("id,from_mode,to_mode,reason,payload_json,created_at")
              .eq("campaign_id", campaignId)
              .order("created_at", { ascending: false })
              .limit(12);
            if (transitions.error) {
              warnings.push(`runtime_events unavailable: ${errMessage(transitions.error, "query failed")}`);
            }
            board = {
              ...activeRuntime,
              board_type: activeRuntime.mode,
              recent_transitions: transitions.data ?? [],
            };
          }
        }
      }

      // Most recent mythic character for this player in this campaign, with table fallback.
      let char: Record<string, unknown> | null = null;
      {
        const { data, error } = await svc
          .schema("mythic")
          .from("v_character_state_for_dm")
          .select("*")
          .eq("campaign_id", campaignId)
          .eq("player_id", user.userId)
          .limit(1)
          .maybeSingle();
        if (error) {
          warnings.push(`v_character_state_for_dm unavailable: ${errMessage(error, "query failed")}`);
          const fallback = await svc
            .schema("mythic")
            .from("characters")
            .select("id,campaign_id,player_id,name,level,offense,defense,control,support,mobility,utility,class_json,derived_json,updated_at")
            .eq("campaign_id", campaignId)
            .eq("player_id", user.userId)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (fallback.error) {
            warnings.push(`characters fallback failed: ${errMessage(fallback.error, "query failed")}`);
          } else {
            char = (fallback.data as Record<string, unknown> | null) ?? null;
          }
        } else {
          char = (data as Record<string, unknown> | null) ?? null;
        }
      }

      // Combat payload if the active board is combat.
      let combat: unknown = null;
      const combatSessionId =
        board && typeof board === "object" && "combat_session_id" in board
          ? ((board as { combat_session_id?: string | null }).combat_session_id ?? null)
          : null;
      if (combatSessionId) {
        const { data: cs, error: csError } = await svc
          .schema("mythic")
          .from("v_combat_state_for_dm")
          .select("combat_session_id, campaign_id, status, seed, scene_json, current_turn_index, dm_payload")
          .eq("combat_session_id", combatSessionId)
          .maybeSingle();
        if (csError) {
          warnings.push(`v_combat_state_for_dm unavailable: ${errMessage(csError, "query failed")}`);
          const fallback = await svc
            .schema("mythic")
            .from("combat_sessions")
            .select("id,campaign_id,status,seed,scene_json,current_turn_index")
            .eq("id", combatSessionId)
            .maybeSingle();
          if (fallback.error) {
            warnings.push(`combat_sessions fallback failed: ${errMessage(fallback.error, "query failed")}`);
          } else {
            combat = fallback.data ?? null;
          }
        } else {
          combat = cs;
        }
      }

      // Canonical rules/script for the DM.
      const { data: rulesRow, error: rulesError } = await svc
        .schema("mythic")
        .from("game_rules")
        .select("name, version, rules")
        .eq("name", "mythic-weave-rules-v1")
        .maybeSingle();
      if (rulesError) {
        warnings.push(`game_rules unavailable: ${errMessage(rulesError, "query failed")}`);
      }

      const { data: scriptRow, error: scriptError } = await svc
        .schema("mythic")
        .from("generator_scripts")
        .select("name, version, is_active, content")
        .eq("name", "mythic-weave-core")
        .eq("is_active", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (scriptError) {
        warnings.push(`generator_scripts unavailable: ${errMessage(scriptError, "query failed")}`);
      }

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
        policy: {
          allow_gore: true,
          allow_mild_sexuality: true,
          ban_sexual_content: false,
          ban_sexual_violence: true,
          ban_coercion: true,
          ban_underage: true,
          ban_explicit_porn: true,
        },
      };

      return new Response(
        JSON.stringify({
          ok: true,
          campaign_id: campaignId,
          player_id: user.userId,
          board: compactBoardPayload(board),
          character: compactCharacterPayload(char),
          combat: compactCombatPayload(combat),
          rules: compactRules,
          script: compactScript,
          dm_campaign_state: dmState.data ?? null,
          dm_world_tension: tension.data ?? null,
          warnings,
          requestId: ctx.requestId,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    } catch (error) {
      if (error instanceof AuthError) {
        const code = error.code === "auth_required" ? "auth_required" : "auth_invalid";
        const message = code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code, requestId: ctx.requestId }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId: ctx.requestId }), {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("dm_context.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      return new Response(
        JSON.stringify({
          error: errMessage(error, normalized.message || "Failed to load mythic DM context"),
          code: normalized.code ?? "dm_context_failed",
          requestId: ctx.requestId,
        }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
