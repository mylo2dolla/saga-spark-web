import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { clampInt, rngInt } from "../shared/mythic_rng.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  reason: z.string().max(200).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});

type MythicBoardType = "town" | "dungeon" | "travel" | "combat";
type StatKey = "offense" | "defense" | "control" | "support" | "mobility" | "utility";

const STAT_KEYS: StatKey[] = ["offense", "defense", "control", "support", "mobility", "utility"];

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampStat(n: number): number {
  return Math.min(100, Math.max(0, Math.floor(n)));
}

function toErrorMessage(error: unknown, context: string): string {
  if (!error) return `${context} failed`;
  if (error instanceof Error) return `${context}: ${error.message}`;
  if (typeof error === "object") {
    const anyErr = error as Record<string, unknown>;
    const message = typeof anyErr.message === "string" ? anyErr.message : "unknown error";
    const code = typeof anyErr.code === "string" ? ` code=${anyErr.code}` : "";
    const hint = typeof anyErr.hint === "string" && anyErr.hint ? ` hint=${anyErr.hint}` : "";
    const details = typeof anyErr.details === "string" && anyErr.details ? ` details=${anyErr.details}` : "";
    return `${context}: ${message}${code}${hint}${details}`;
  }
  return `${context}: ${String(error)}`;
}

function throwIfError(error: unknown, context: string): void {
  if (!error) return;
  throw new Error(toErrorMessage(error, context));
}

function sumEquipmentBonuses(rows: Array<{ item?: { stat_mods?: unknown; slot?: string } | null }>) {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const statMods = asObject(row?.item?.stat_mods);
    for (const [k, v] of Object.entries(statMods)) {
      const add = num(v, 0);
      if (!Number.isFinite(add)) continue;
      totals[k] = (totals[k] ?? 0) + add;
    }
  }
  return totals;
}

export const mythicCombatStart: FunctionHandler = {
  name: "mythic-combat-start",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const requestId = ctx.requestId;
    const baseHeaders = { "x-request-id": requestId };

    try {
      const user = await requireUser(req.headers);

      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId }), {
          status: 400,
          headers: { ...baseHeaders, "Content-Type": "application/json" },
        });
      }

      const { campaignId } = parsed.data;
      const reason = parsed.data.reason ?? "encounter";

      const svc = createServiceClient();
      await assertCampaignAccess(svc, campaignId, user.userId);

      const t0 = Date.now();

      ctx.log.info("combat_start.request", {
        request_id: requestId,
        campaign_id: campaignId,
        user_id: user.userId,
        reason,
      });

      // Ensure campaign exists.
      const { data: campaign, error: campaignError } = await svc
        .from("campaigns")
        .select("id")
        .eq("id", campaignId)
        .maybeSingle();
      throwIfError(campaignError, "campaign lookup");
      if (!campaign) {
        return new Response(JSON.stringify({ error: "Campaign not found", code: "campaign_not_found", requestId }), {
          status: 404,
          headers: { ...baseHeaders, "Content-Type": "application/json" },
        });
      }

      // Active board seed -> stable encounter seed.
      const { data: activeBoard, error: activeBoardError } = await svc
        .schema("mythic")
        .from("boards")
        .select("id, board_type, state_json")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      throwIfError(activeBoardError, "active board lookup");

      const boardSeed = (() => {
        const s = (activeBoard as { state_json?: any } | null)?.state_json?.seed;
        return typeof s === "number" && Number.isFinite(s) ? Math.floor(s) : 12345;
      })();

      const nowSeed = Math.floor(Date.now() / 1000) % 2_147_483_647;
      const seed = parsed.data.seed ?? rngInt(boardSeed + nowSeed, `combat_seed:${campaignId}`, 0, 2_147_483_647);

      // Player mythic character.
      const { data: character, error: charError } = await svc
        .schema("mythic")
        .from("characters")
        .select("id, name, level, offense, defense, control, support, mobility, utility")
        .eq("campaign_id", campaignId)
        .eq("player_id", user.userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      throwIfError(charError, "character lookup");
      if (!character) {
        return new Response(JSON.stringify({ error: "No mythic character found for this campaign", code: "character_missing", requestId }), {
          status: 400,
          headers: { ...baseHeaders, "Content-Type": "application/json" },
        });
      }

      // Pull equipped items for stat bonuses.
      const { data: equippedItems, error: equipError } = await svc
        .schema("mythic")
        .from("inventory")
        .select("id, container, item:items(stat_mods, slot)")
        .eq("character_id", character.id)
        .eq("container", "equipment");

      throwIfError(equipError, "equipment lookup");

      const equipBonuses = sumEquipmentBonuses((equippedItems ?? []) as Array<{ item?: { stat_mods?: unknown } | null }>);

      const derivedStats = STAT_KEYS.reduce((acc, key) => {
        const base = num((character as any)[key], 0);
        const bonus = num(equipBonuses[key], 0);
        acc[key] = clampStat(base + bonus);
        return acc;
      }, {} as Record<StatKey, number>);

      const weaponPower = Math.max(0, num(equipBonuses.weapon_power, 0));
      const armorPower = Math.max(0, num(equipBonuses.armor_power, 0));
      const resistBonus = Math.max(0, num(equipBonuses.resist, 0));
      const armorBonus = Math.max(0, num(equipBonuses.armor, 0));
      const hpBonus = Math.max(0, num(equipBonuses.hp_max, 0));
      const powerBonus = Math.max(0, num(equipBonuses.power_max, 0));

      // Start combat session + activate combat board + transition + combat_start event.
      const sceneJson = {
        kind: "encounter",
        started_from: (activeBoard as { board_type?: MythicBoardType } | null)?.board_type ?? null,
      };

      const startRes = await svc.rpc("mythic_start_combat_session", {
        campaign_id: campaignId,
        seed,
        scene_json: sceneJson,
        reason,
      });
      const combatId = typeof startRes.data === "string" ? startRes.data : null;
      const startError = startRes.error;
      throwIfError(startError, "start_combat_session");
      if (!combatId || typeof combatId !== "string") throw new Error("start_combat_session returned no id");

      // Self-heal: ensure there is an active combat board bound to this combat session.
      const { data: activeCombatBoard, error: activeCombatBoardError } = await svc
        .schema("mythic")
        .from("boards")
        .select("id,combat_session_id,state_json")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .eq("board_type", "combat")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      throwIfError(activeCombatBoardError, "active combat board lookup");
      if (!activeCombatBoard) {
        const { error: archiveNonCombatError } = await svc
          .schema("mythic")
          .from("boards")
          .update({ status: "archived", updated_at: new Date().toISOString() })
          .eq("campaign_id", campaignId)
          .eq("status", "active")
          .neq("board_type", "combat");
        throwIfError(archiveNonCombatError, "archive stale active boards");

        const { error: insertCombatBoardError } = await svc
          .schema("mythic")
          .from("boards")
          .insert({
            campaign_id: campaignId,
            board_type: "combat",
            status: "active",
            combat_session_id: combatId,
            state_json: {
              combat_session_id: combatId,
              grid: { width: 12, height: 8 },
              blocked_tiles: [],
              seed,
            },
            ui_hints_json: {
              camera: { x: 0, y: 0, zoom: 1 },
              board_theme: "combat",
            },
          });
        throwIfError(insertCombatBoardError, "insert combat board self-heal");
        ctx.log.warn("combat_start.board_self_heal_created", {
          request_id: requestId,
          campaign_id: campaignId,
          combat_session_id: combatId,
        });
      } else if (activeCombatBoard.combat_session_id !== combatId) {
        const currentState = asObject(activeCombatBoard.state_json);
        const { error: repairBoardError } = await svc
          .schema("mythic")
          .from("boards")
          .update({
            combat_session_id: combatId,
            state_json: {
              ...currentState,
              combat_session_id: combatId,
              seed,
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", activeCombatBoard.id);
        throwIfError(repairBoardError, "repair combat board session binding");
        ctx.log.warn("combat_start.board_self_heal_rebound", {
          request_id: requestId,
          campaign_id: campaignId,
          combat_session_id: combatId,
          board_id: activeCombatBoard.id,
        });
      }

      const lvl = character.level as number;

      const [hpMaxRes, powerMaxRes] = await Promise.all([
        svc.rpc("mythic_max_hp", { lvl, defense: derivedStats.defense, support: derivedStats.support }),
        svc.rpc("mythic_max_power_bar", { lvl, utility: derivedStats.utility, support: derivedStats.support }),
      ]);
      throwIfError(hpMaxRes.error, "max_hp");
      throwIfError(powerMaxRes.error, "max_power_bar");

      const playerInit = clampInt((derivedStats.mobility as number) + rngInt(seed, `init:player:${character.id}`, 0, 25), 0, 999);
      const hpMaxFinal = Math.max(1, Math.floor(((hpMaxRes.data as number | null) ?? 100) + hpBonus));
      const powerMaxFinal = Math.max(0, Math.floor(((powerMaxRes.data as number | null) ?? 50) + powerBonus));

      const playerCombatant = {
        combat_session_id: combatId,
        entity_type: "player",
        player_id: user.userId,
        character_id: character.id,
        name: character.name,
        x: 1,
        y: 1,
        lvl,
        offense: derivedStats.offense,
        defense: derivedStats.defense,
        control: derivedStats.control,
        support: derivedStats.support,
        mobility: derivedStats.mobility,
        utility: derivedStats.utility,
        weapon_power: weaponPower,
        armor_power: armorPower,
        hp: hpMaxFinal,
        hp_max: hpMaxFinal,
        power: powerMaxFinal,
        power_max: powerMaxFinal,
        armor: armorBonus,
        resist: resistBonus,
        statuses: [],
        initiative: playerInit,
        is_alive: true,
      };

      const enemyCount = rngInt(seed, `enemy_count:${combatId}`, 2, 4);
      const enemies = Array.from({ length: enemyCount }, (_, i) => {
        const base = 35 + rngInt(seed, `enemy:base:${i}`, 0, 25);
        const mobility = clampInt(base + rngInt(seed, `enemy:mob:${i}`, -5, 10), 0, 100);
        const offense = clampInt(base + rngInt(seed, `enemy:off:${i}`, -5, 15), 0, 100);
        const defense = clampInt(base + rngInt(seed, `enemy:def:${i}`, -5, 15), 0, 100);
        const control = clampInt(base + rngInt(seed, `enemy:ctl:${i}`, -10, 10), 0, 100);
        const support = clampInt(base + rngInt(seed, `enemy:sup:${i}`, -10, 10), 0, 100);
        const utility = clampInt(base + rngInt(seed, `enemy:uti:${i}`, -10, 10), 0, 100);
        const initiative = clampInt(mobility + rngInt(seed, `init:enemy:${i}`, 0, 25), 0, 999);

        const x = 8 + rngInt(seed, `enemy:x:${i}`, 0, 2);
        const y = 1 + i;

        return {
          combat_session_id: combatId,
          entity_type: "npc",
          player_id: null,
          character_id: null,
          name: `Ink Ghoul ${i + 1}`,
          x,
          y,
          lvl,
          offense,
          defense,
          control,
          support,
          mobility,
          utility,
          weapon_power: 0,
          armor_power: 0,
          hp: 100,
          hp_max: 100,
          power: 0,
          power_max: 0,
          armor: 0,
          resist: 0,
          statuses: [],
          initiative,
          is_alive: true,
        };
      });

      const { data: insertedCombatants, error: combatantsError } = await svc
        .schema("mythic")
        .from("combatants")
        .insert([playerCombatant, ...enemies])
        .select("id, name, initiative");

      throwIfError(combatantsError, "combatants insert");
      if (!insertedCombatants || insertedCombatants.length < 2) throw new Error("Failed to insert combatants");

      const sorted = [...insertedCombatants].sort((a: any, b: any) => {
        const ia = Number(a.initiative ?? 0);
        const ib = Number(b.initiative ?? 0);
        if (ib !== ia) return ib - ia;
        return String(a.name).localeCompare(String(b.name));
      });

      const turnRows = sorted.map((c: any, idx: number) => ({
        combat_session_id: combatId,
        turn_index: idx,
        combatant_id: c.id,
      }));

      const { error: turnError } = await svc
        .schema("mythic")
        .from("turn_order")
        .insert(turnRows);
      throwIfError(turnError, "turn_order insert");

      const initiativeSnapshot = sorted.map((c: any) => ({ combatant_id: c.id, name: c.name, initiative: c.initiative }));

      // Add a simple deterministic combat grid with blocked tiles for LOS checks.
      const blockedTiles = Array.from({ length: rngInt(seed, "walls:count", 3, 6) }).map((_, i) => ({
        x: rngInt(seed, `walls:x:${i}`, 2, 7),
        y: rngInt(seed, `walls:y:${i}`, 1, 4),
      }));

      const { data: updatedBoards, error: boardUpdateError } = await svc
        .schema("mythic")
        .from("boards")
        .update({
          state_json: {
            combat_session_id: combatId,
            grid: { width: 12, height: 8 },
            blocked_tiles: blockedTiles,
            seed,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("combat_session_id", combatId)
        .eq("status", "active");
      throwIfError(boardUpdateError, "combat board update");
      if (!updatedBoards) {
        // `update` without select returns null, but we still want to ensure row matched.
        const { data: verifyBoard, error: verifyError } = await svc
          .schema("mythic")
          .from("boards")
          .select("id")
          .eq("combat_session_id", combatId)
          .eq("status", "active")
          .maybeSingle();
        throwIfError(verifyError, "combat board verify");
        if (!verifyBoard) throw new Error("Combat board update affected 0 rows");
      }

      const roundStartRes = await svc.rpc("mythic_append_action_event", {
        combat_session_id: combatId,
        turn_index: 0,
        actor_combatant_id: null,
        event_type: "round_start",
        payload: { round_index: 0, initiative_snapshot: initiativeSnapshot },
      });
      throwIfError(roundStartRes.error, "append_action_event round_start");

      const turnStartRes = await svc.rpc("mythic_append_action_event", {
        combat_session_id: combatId,
        turn_index: 0,
        actor_combatant_id: sorted[0]!.id,
        event_type: "turn_start",
        payload: { actor_combatant_id: sorted[0]!.id },
      });
      throwIfError(turnStartRes.error, "append_action_event turn_start");

      ctx.log.info("combat_start.success", {
        request_id: requestId,
        campaign_id: campaignId,
        combat_session_id: combatId,
        duration_ms: Date.now() - t0,
        enemy_count: enemyCount,
      });

      return new Response(
        JSON.stringify({ ok: true, combat_session_id: combatId, requestId }),
        { status: 200, headers: { ...baseHeaders, "Content-Type": "application/json" } },
      );
    } catch (error) {
      if (error instanceof AuthError) {
        const code = error.code === "auth_required" ? "auth_required" : "auth_invalid";
        const message = code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code, requestId }), {
          status: 401,
          headers: { ...baseHeaders, "Content-Type": "application/json" },
        });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId }), {
          status: error.status,
          headers: { ...baseHeaders, "Content-Type": "application/json" },
        });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("combat_start.failed", { request_id: requestId, error: normalized.message, code: normalized.code });
      return new Response(
        JSON.stringify({
          error: normalized.message || "Failed to start combat",
          code: normalized.code ?? "combat_start_failed",
          requestId,
        }),
        { status: 500, headers: { ...baseHeaders, "Content-Type": "application/json" } },
      );
    }
  },
};
