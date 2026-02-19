import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid().optional(),
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

function sumEquipmentBonuses(rows: Array<{ item?: { stat_mods?: unknown } | null }>) {
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

export const mythicRecomputeCharacter: FunctionHandler = {
  name: "mythic-recompute-character",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    try {
      const user = await requireUser(req.headers);
      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { campaignId, characterId } = parsed.data;
      const svc = createServiceClient();
      const access = await assertCampaignAccess(svc, campaignId, user.userId);

      const { data: character, error: charError } = await svc
        .schema("mythic")
        .from("characters")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq(characterId ? "id" : "player_id", characterId ?? user.userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (charError) throw charError;
      if (!character) {
        return new Response(JSON.stringify({ error: "Character not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!access.isDm && (character as { player_id?: string }).player_id !== user.userId) {
        return new Response(JSON.stringify({ error: "Not authorized for this character" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data: equippedItems, error: equipError } = await svc
        .schema("mythic")
        .from("inventory")
        .select("id, container, item:items(stat_mods)")
        .eq("character_id", (character as any).id)
        .eq("container", "equipment");
      if (equipError) throw equipError;

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

      const lvl = Number((character as any).level ?? 1);
      const [{ data: hpMax }, { data: powerMax }] = await Promise.all([
        svc.rpc("mythic_max_hp", { lvl, defense: derivedStats.defense, support: derivedStats.support }),
        svc.rpc("mythic_max_power_bar", { lvl, utility: derivedStats.utility, support: derivedStats.support }),
      ]);

      const hpMaxFinal = Math.max(1, Math.floor((hpMax ?? 100) + hpBonus));
      const powerMaxFinal = Math.max(0, Math.floor((powerMax ?? 50) + powerBonus));

      const derivedJson = {
        derived_stats: derivedStats,
        equipment_bonuses: equipBonuses,
        weapon_power: weaponPower,
        armor_power: armorPower,
        resist: resistBonus,
        armor: armorBonus,
        hp_max: hpMaxFinal,
        power_max: powerMaxFinal,
      };

      const { error: updateError } = await svc
        .schema("mythic")
        .from("characters")
        .update({
          derived_json: derivedJson,
          updated_at: new Date().toISOString(),
        })
        .eq("id", (character as any).id)
        .eq("campaign_id", campaignId);
      if (updateError) throw updateError;

      // If combat is active, refresh the live combatant snapshot for this character.
      const { data: activeSession } = await svc
        .schema("mythic")
        .from("combat_sessions")
        .select("id, status")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeSession?.id) {
        const { data: combatant } = await svc
          .schema("mythic")
          .from("combatants")
          .select("id, hp, power, hp_max, power_max")
          .eq("combat_session_id", activeSession.id)
          .eq("character_id", (character as any).id)
          .maybeSingle();

        if (combatant?.id) {
          const nextHp = Math.min(Number(combatant.hp ?? 0), hpMaxFinal);
          const nextPower = Math.min(Number(combatant.power ?? 0), powerMaxFinal);
          await svc
            .schema("mythic")
            .from("combatants")
            .update({
              offense: derivedStats.offense,
              defense: derivedStats.defense,
              control: derivedStats.control,
              support: derivedStats.support,
              mobility: derivedStats.mobility,
              utility: derivedStats.utility,
              weapon_power: weaponPower,
              armor_power: armorPower,
              resist: resistBonus,
              armor: armorBonus,
              hp_max: hpMaxFinal,
              power_max: powerMaxFinal,
              hp: nextHp,
              power: nextPower,
              updated_at: new Date().toISOString(),
            })
            .eq("id", combatant.id)
            .eq("combat_session_id", activeSession.id);
        }
      }

      return new Response(JSON.stringify({ ok: true, derived: derivedJson }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        const message = error.code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message }), {
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
      ctx.log.error("recompute_character.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      return new Response(JSON.stringify({ error: normalized.message || "Failed to recompute character", code: normalized.code ?? "recompute_character_failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
