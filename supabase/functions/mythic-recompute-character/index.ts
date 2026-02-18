import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createLogger } from "../_shared/logger.ts";
import { sanitizeError } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid().optional(),
});
const logger = createLogger("mythic-recompute-character");

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase env is not configured (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY)");
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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

    const { campaignId, characterId } = parsed.data;
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

    const { data: character, error: charError } = await svc
      .schema("mythic")
      .from("characters")
      .select("*")
      .eq("campaign_id", campaignId)
      .eq(characterId ? "id" : "player_id", characterId ?? user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (charError) throw charError;
    if (!character) {
      return new Response(JSON.stringify({ error: "Character not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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

    // Ensure every character has a default Move skill (server-authoritative).
    // This keeps combat tactics usable even when older characters were created before Move existed.
    const moveRange = clampStat(3 + Math.floor(Number(derivedStats.mobility ?? 0) / 25));
    const moveRangeClamped = Math.min(6, Math.max(3, moveRange));
    const { data: existingMoveSkill, error: moveLookupErr } = await svc
      .schema("mythic")
      .from("skills")
      .select("id, range_tiles")
      .eq("character_id", (character as any).id)
      .eq("name", "Move")
      .maybeSingle();
    if (moveLookupErr) throw moveLookupErr;

    if (!existingMoveSkill?.id) {
      const { error: moveInsertErr } = await svc
        .schema("mythic")
        .from("skills")
        .insert({
          campaign_id: campaignId,
          character_id: (character as any).id,
          kind: "active",
          targeting: "tile",
          targeting_json: { shape: "tile", metric: "manhattan", requires_los: false, blocks_on_walls: true },
          name: "Move",
          description: "Reposition up to your move range. Cannot end on blocked or occupied tiles.",
          range_tiles: moveRangeClamped,
          cooldown_turns: 0,
          cost_json: { amount: 0, type: "flat", when: "on_cast" },
          effects_json: { move: { dash_tiles: moveRangeClamped }, onomatopoeia: "step" },
          scaling_json: {},
          counterplay: { notes: "Positioning is power. Deny lanes with obstacles and body-blocking." },
          narration_style: "tactical-brief",
        });
      if (moveInsertErr) throw moveInsertErr;
    } else if (Number(existingMoveSkill.range_tiles ?? 0) !== moveRangeClamped) {
      const { error: moveUpdateErr } = await svc
        .schema("mythic")
        .from("skills")
        .update({
          range_tiles: moveRangeClamped,
          effects_json: { move: { dash_tiles: moveRangeClamped }, onomatopoeia: "step" },
        } as any)
        .eq("id", existingMoveSkill.id)
        .eq("character_id", (character as any).id);
      if (moveUpdateErr) throw moveUpdateErr;
    }

    return new Response(JSON.stringify({ ok: true, derived: derivedJson }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("recompute_character.failed", error);
    return new Response(JSON.stringify({ error: normalized.message || "Failed to recompute character", code: normalized.code ?? "recompute_character_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
