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

function scaleCompanionStat(base: number, seed: number, label: string, floor = 20): number {
  const scaled = Math.floor(base * 0.78) + rngInt(seed, `${label}:jitter`, -6, 8);
  return clampInt(scaled, floor, 100);
}

function uniqueName(base: string, seen: Set<string>): string {
  const clean = base.trim().replace(/\s+/g, " ");
  const fallback = clean.length > 0 ? clean : "Unit";
  let candidate = fallback;
  let suffix = 2;
  while (seen.has(candidate.toLowerCase())) {
    candidate = `${fallback} ${suffix}`;
    suffix += 1;
  }
  seen.add(candidate.toLowerCase());
  return candidate;
}

function enemyNamePool(themeHint: string): string[] {
  const lower = themeHint.toLowerCase();
  if (/(crypt|grave|horror|dark|gothic|night)/.test(lower)) {
    return ["Ink Ghoul", "Grave Stalker", "Pale Reaver", "Cinder Wraith", "Bone Lantern"];
  }
  if (/(ruin|sci|tech|machine|arc|metal)/.test(lower)) {
    return ["Ruin Drone", "Shard Hunter", "Ion Ravager", "Rust Strider", "Signal Maw"];
  }
  if (/(forest|wild|road|travel|frontier)/.test(lower)) {
    return ["Ridge Stalker", "Mire Howler", "Thorn Marauder", "Dust Skirmisher", "Night Pike"];
  }
  return ["Ink Ghoul", "Ash Brigand", "Gloom Raider", "Rift Hound", "Gallows Stalker"];
}

function pickEnemyName(seed: number, combatId: string, index: number, themeHint: string, seen: Set<string>): string {
  const pool = enemyNamePool(themeHint);
  const base = pool[rngInt(seed, `enemy_name:${combatId}:${index}`, 0, pool.length - 1)] ?? pool[0]!;
  return uniqueName(base, seen);
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

      // Active runtime seed -> stable encounter seed.
      const { data: activeRuntime, error: activeRuntimeError } = await svc
        .schema("mythic")
        .from("campaign_runtime")
        .select("id, mode, state_json, combat_session_id")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      throwIfError(activeRuntimeError, "active runtime lookup");

      const boardSeed = (() => {
        const s = (activeRuntime as { state_json?: any } | null)?.state_json?.seed;
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
        started_from: (activeRuntime as { mode?: string } | null)?.mode ?? null,
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

      let runtimeId = typeof (activeRuntime as { id?: unknown } | null)?.id === "string"
        ? String((activeRuntime as { id: string }).id)
        : null;
      let runtimeState = asObject((activeRuntime as { state_json?: unknown } | null)?.state_json);
      if (!runtimeId) {
        const runtimeInsert = await svc
          .schema("mythic")
          .from("campaign_runtime")
          .insert({
            campaign_id: campaignId,
            mode: "combat",
            status: "active",
            state_json: {
              combat_session_id: combatId,
              grid: { width: 12, height: 8 },
              blocked_tiles: [],
              seed,
            },
            ui_hints_json: { camera: { x: 0, y: 0, zoom: 1 }, board_theme: "combat" },
            combat_session_id: combatId,
          })
          .select("id,state_json")
          .single();
        throwIfError(runtimeInsert.error, "insert campaign runtime");
        runtimeId = String((runtimeInsert.data as { id: string }).id);
        runtimeState = asObject((runtimeInsert.data as { state_json?: unknown }).state_json);
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

      const usedNames = new Set<string>();
      const playerCombatant = {
        combat_session_id: combatId,
        entity_type: "player",
        player_id: user.userId,
        character_id: character.id,
        name: uniqueName(character.name, usedNames),
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

      const { data: companionRows, error: companionErr } = await svc
        .schema("mythic")
        .from("campaign_companions")
        .select("companion_id,name,archetype,mood,urgency_bias")
        .eq("campaign_id", campaignId)
        .order("companion_id", { ascending: true })
        .limit(2);
      throwIfError(companionErr, "campaign companions lookup");

      const companions = (companionRows ?? []).map((row: any, index: number) => {
        const companionSeedKey = `companion:${row.companion_id ?? index + 1}`;
        const companionLevel = clampInt(lvl - 1 + rngInt(seed, `${companionSeedKey}:lvl`, 0, 1), 1, 99);
        const companionDefenseBoost = String(row.archetype ?? "").toLowerCase() === "tactician" ? 6 : 0;
        const companionSupportBoost = String(row.archetype ?? "").toLowerCase() === "support" ? 8 : 0;
        const companionMobilityBoost = String(row.archetype ?? "").toLowerCase() === "scout" ? 8 : 0;

        const offense = scaleCompanionStat(derivedStats.offense, seed, `${companionSeedKey}:offense`);
        const defense = scaleCompanionStat(derivedStats.defense + companionDefenseBoost, seed, `${companionSeedKey}:defense`);
        const control = scaleCompanionStat(derivedStats.control, seed, `${companionSeedKey}:control`);
        const support = scaleCompanionStat(derivedStats.support + companionSupportBoost, seed, `${companionSeedKey}:support`);
        const mobility = scaleCompanionStat(derivedStats.mobility + companionMobilityBoost, seed, `${companionSeedKey}:mobility`);
        const utility = scaleCompanionStat(derivedStats.utility, seed, `${companionSeedKey}:utility`);
        const initiative = clampInt(mobility + rngInt(seed, `${companionSeedKey}:initiative`, 0, 20), 0, 999);
        const companionHpMax = Math.max(36, Math.floor(hpMaxFinal * 0.72) + rngInt(seed, `${companionSeedKey}:hp`, -12, 14));
        const companionPowerMax = Math.max(24, Math.floor(powerMaxFinal * 0.6) + rngInt(seed, `${companionSeedKey}:power`, -6, 8));

        return {
          combat_session_id: combatId,
          entity_type: "summon",
          player_id: user.userId,
          character_id: null,
          name: uniqueName(
            typeof row.name === "string" && row.name.trim().length > 0
              ? row.name.trim()
              : `Companion ${index + 1}`,
            usedNames,
          ),
          x: 1 + (index % 2),
          y: 2 + Math.floor(index / 2),
          lvl: companionLevel,
          offense,
          defense,
          control,
          support,
          mobility,
          utility,
          weapon_power: Math.max(0, Math.floor(weaponPower * 0.65)),
          armor_power: Math.max(0, Math.floor(armorPower * 0.65)),
          hp: companionHpMax,
          hp_max: companionHpMax,
          power: companionPowerMax,
          power_max: companionPowerMax,
          armor: Math.max(0, Math.floor(armorBonus * 0.6)),
          resist: Math.max(0, Math.floor(resistBonus * 0.6)),
          statuses: [
            {
              id: "ally_companion",
              expires_turn: null,
              data: {
                companion_id: row.companion_id ?? null,
                mood: row.mood ?? null,
                urgency_bias: row.urgency_bias ?? null,
              },
            },
          ],
          initiative,
          is_alive: true,
        };
      });

      const enemyCount = rngInt(seed, `enemy_count:${combatId}`, 2, 4);
      const themeHint = [
        reason,
        typeof (activeRuntime as { mode?: unknown } | null)?.mode === "string"
          ? String((activeRuntime as { mode: string }).mode)
          : "",
      ]
        .filter((entry) => entry.length > 0)
        .join(" ");
      const enemies: Array<Record<string, unknown>> = [];
      for (let i = 0; i < enemyCount; i += 1) {
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
        const hpBaseRes = await svc.rpc("mythic_max_hp", {
          lvl,
          defense,
          support,
        });
        throwIfError(hpBaseRes.error, "enemy max_hp");
        const hpBase = Math.max(1, Math.floor(Number(hpBaseRes.data ?? 100)));
        const hpVariancePct = rngInt(seed, `enemy:hp_variance:${i}`, -10, 10);
        const enemyHpMax = Math.max(50, Math.floor(hpBase * (1 + (hpVariancePct / 100))));

        enemies.push({
          combat_session_id: combatId,
          entity_type: "npc",
          player_id: null,
          character_id: null,
          name: pickEnemyName(seed, combatId, i, themeHint, usedNames),
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
          hp: enemyHpMax,
          hp_max: enemyHpMax,
          power: 0,
          power_max: 0,
          armor: 0,
          resist: 0,
          statuses: [],
          initiative,
          is_alive: true,
        });
      }

      const { data: insertedCombatants, error: combatantsError } = await svc
        .schema("mythic")
        .from("combatants")
        .insert([playerCombatant, ...companions, ...enemies])
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

      if (!runtimeId) throw new Error("Runtime row missing during combat start");
      const previousMode = typeof (activeRuntime as { mode?: unknown } | null)?.mode === "string"
        ? String((activeRuntime as { mode: string }).mode)
        : null;
      const nextRuntimeState = {
        ...runtimeState,
        combat_session_id: combatId,
        return_mode: previousMode && previousMode !== "combat" ? previousMode : (runtimeState.return_mode ?? "town"),
        grid: { width: 12, height: 8 },
        blocked_tiles: blockedTiles,
        seed,
      };
      const { error: runtimeUpdateError } = await svc
        .schema("mythic")
        .from("campaign_runtime")
        .update({
          mode: "combat",
          combat_session_id: combatId,
          state_json: nextRuntimeState,
          updated_at: new Date().toISOString(),
        })
        .eq("id", runtimeId);
      throwIfError(runtimeUpdateError, "runtime combat state update");

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
        companion_count: companions.length,
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
