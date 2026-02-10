import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { clampInt, rngInt } from "../_shared/mythic_rng.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const { campaignId } = parsed.data;
    const reason = parsed.data.reason ?? "encounter";

    const svc = createClient(supabaseUrl, serviceRoleKey);

    // Ensure campaign exists.
    const { data: campaign, error: campaignError } = await svc
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Active board seed -> stable encounter seed.
    const { data: activeBoard } = await svc
      .schema("mythic")
      .from("boards")
      .select("id, board_type, state_json")
      .eq("campaign_id", campaignId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

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
      .eq("player_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (charError) throw charError;
    if (!character) {
      return new Response(JSON.stringify({ error: "No mythic character found for this campaign" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull equipped items for stat bonuses.
    const { data: equippedItems, error: equipError } = await svc
      .schema("mythic")
      .from("inventory")
      .select("id, container, item:items(stat_mods, slot)")
      .eq("character_id", character.id)
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

    // Start combat session + activate combat board + transition + combat_start event.
    const { data: combatId, error: startError } = await svc
      .schema("mythic")
      .rpc("start_combat_session", {
        p_campaign_id: campaignId,
        p_seed: seed,
        p_scene_json: {
          kind: "encounter",
          started_from: (activeBoard as { board_type?: MythicBoardType } | null)?.board_type ?? null,
        },
        p_reason: reason,
      });

    if (startError) throw startError;
    if (!combatId || typeof combatId !== "string") throw new Error("start_combat_session returned no id");

    const lvl = character.level as number;

    const [{ data: hpMax }, { data: powerMax }] = await Promise.all([
      svc.schema("mythic").rpc("max_hp", { lvl, defense: derivedStats.defense, support: derivedStats.support }),
      svc.schema("mythic").rpc("max_power_bar", { lvl, utility: derivedStats.utility, support: derivedStats.support }),
    ]);

    const playerInit = clampInt((derivedStats.mobility as number) + rngInt(seed, `init:player:${character.id}`, 0, 25), 0, 999);
    const hpMaxFinal = Math.max(1, Math.floor((hpMax ?? 100) + hpBonus));
    const powerMaxFinal = Math.max(0, Math.floor((powerMax ?? 50) + powerBonus));

    const playerCombatant = {
      combat_session_id: combatId,
      entity_type: "player",
      player_id: user.id,
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

    if (combatantsError) throw combatantsError;
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
    if (turnError) throw turnError;

    const initiativeSnapshot = sorted.map((c: any) => ({ combatant_id: c.id, name: c.name, initiative: c.initiative }));

    // Add a simple deterministic combat grid with blocked tiles for LOS checks.
    const blockedTiles = Array.from({ length: rngInt(seed, "walls:count", 3, 6) }).map((_, i) => ({
      x: rngInt(seed, `walls:x:${i}`, 2, 7),
      y: rngInt(seed, `walls:y:${i}`, 1, 4),
    }));

    await svc
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

    await svc.schema("mythic").rpc("append_action_event", {
      p_combat_session_id: combatId,
      p_turn_index: 0,
      p_actor_combatant_id: null,
      p_event_type: "round_start",
      p_payload: { round_index: 0, initiative_snapshot: initiativeSnapshot },
    });

    await svc.schema("mythic").rpc("append_action_event", {
      p_combat_session_id: combatId,
      p_turn_index: 0,
      p_actor_combatant_id: sorted[0]!.id,
      p_event_type: "turn_start",
      p_payload: { actor_combatant_id: sorted[0]!.id },
    });

    return new Response(
      JSON.stringify({ ok: true, combat_session_id: combatId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("mythic-combat-start error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Failed to start combat" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
