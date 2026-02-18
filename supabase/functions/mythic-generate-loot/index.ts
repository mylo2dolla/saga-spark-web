import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { rngInt, rngPick, weightedPick } from "../_shared/mythic_rng.ts";
import { createLogger } from "../_shared/logger.ts";
import { sanitizeError } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RARITIES = ["common", "magical", "unique", "legendary", "mythic", "unhinged"] as const;
type Rarity = typeof RARITIES[number];

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  combatSessionId: z.string().uuid().optional(),
  characterId: z.string().uuid().optional(),
  count: z.number().int().min(1).max(8).default(1),
  source: z.string().max(40).default("combat"),
  rarity: z.enum(RARITIES).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});
const logger = createLogger("mythic-generate-loot");

const BUDGETS: Record<Rarity, number> = {
  common: 8,
  magical: 16,
  unique: 24,
  legendary: 40,
  mythic: 60,
  unhinged: 70,
};

const PREFIXES = ["Rust", "Blood", "Ash", "Night", "Storm", "Iron", "Obsidian", "Void", "Saint", "Cursed"];
const SUFFIXES = ["Bite", "Ward", "Edge", "Pulse", "Lash", "Sigil", "Breaker", "Halo", "Howl", "Spite"];
const SLOT_POOL = ["weapon", "armor", "helm", "gloves", "boots", "belt", "amulet", "ring", "trinket"] as const;
const ITEM_TYPES = ["gear", "artifact", "relic"] as const;
const WEAPON_FAMILIES = ["blades", "axes", "blunt", "polearms", "ranged", "focus", "body", "absurd"] as const;

const rowToInt = (v: unknown, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const maybe = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [maybe.message, maybe.details, maybe.hint, maybe.code]
      .filter((part): part is string => typeof part === "string" && part.length > 0);
    if (parts.length > 0) return parts.join(" | ");
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown object error";
    }
  }
  if (typeof error === "string" && error.length > 0) return error;
  return "Failed to generate loot";
};

function pickRarity(seed: number, label: string, level: number): Rarity {
  const late = Math.max(0, level - 25);
  return weightedPick(seed, label, [
    { item: "common" as const, weight: Math.max(5, 65 - late) },
    { item: "magical" as const, weight: Math.max(10, 26 + Math.floor(late * 0.3)) },
    { item: "unique" as const, weight: Math.max(6, 8 + Math.floor(late * 0.25)) },
    { item: "legendary" as const, weight: Math.max(2, Math.floor(level / 12)) },
    { item: "mythic" as const, weight: Math.max(1, Math.floor(level / 20)) },
    { item: "unhinged" as const, weight: level >= 70 ? 1 : 0 },
  ]);
}

function rarityTier(rarity: Rarity): "common" | "elite" | "boss" | "mythic" | "event" {
  if (rarity === "common" || rarity === "magical") return "common";
  if (rarity === "unique") return "elite";
  if (rarity === "legendary") return "boss";
  if (rarity === "mythic") return "mythic";
  return "event";
}

function rollItem(args: {
  seed: number;
  label: string;
  level: number;
  rarity: Rarity;
  classRole: string;
  weaponFamilyHint: string | null;
  campaignId: string;
  characterId: string;
  source: string;
}) {
  const { seed, label, level, rarity, classRole, weaponFamilyHint, campaignId, characterId, source } = args;
  const budget = BUDGETS[rarity];

  const slot = weightedPick(seed, `${label}:slot`, SLOT_POOL.map((s) => {
    if ((classRole === "tank" || classRole === "support") && (s === "armor" || s === "helm" || s === "belt")) return { item: s, weight: 8 };
    if ((classRole === "dps" || classRole === "skirmisher") && (s === "weapon" || s === "ring" || s === "trinket")) return { item: s, weight: 8 };
    if (classRole === "controller" && (s === "weapon" || s === "amulet" || s === "trinket")) return { item: s, weight: 7 };
    return { item: s, weight: 4 };
  }));

  const statKeys = ["offense", "defense", "control", "support", "mobility", "utility"];
  const statCount = Math.max(1, Math.min(4, Math.floor(budget / 16) + 1));
  const statMods: Record<string, number> = {};
  for (let i = 0; i < statCount; i += 1) {
    const key = rngPick(seed, `${label}:stat:${i}`, statKeys);
    const roll = rngInt(seed, `${label}:roll:${key}:${i}`, 1, Math.max(2, Math.floor(budget / 3)));
    statMods[key] = (statMods[key] ?? 0) + roll;
  }

  if (slot === "weapon") {
    statMods.weapon_power = rngInt(seed, `${label}:weapon_power`, 2, Math.max(5, Math.floor(level / 2) + Math.floor(budget / 5)));
  } else if (slot === "armor" || slot === "helm" || slot === "gloves" || slot === "boots" || slot === "belt") {
    statMods.armor_power = rngInt(seed, `${label}:armor_power`, 1, Math.max(4, Math.floor(level / 3) + Math.floor(budget / 6)));
    statMods.resist = rngInt(seed, `${label}:resist`, 0, Math.max(3, Math.floor(budget / 8)));
    statMods.hp_max = rngInt(seed, `${label}:hp_max`, 0, Math.max(20, budget + level));
  } else if (slot === "ring" || slot === "trinket" || slot === "amulet") {
    statMods.power_max = rngInt(seed, `${label}:power_max`, 5, Math.max(15, Math.floor(level / 2) + budget));
  }

  const name = `${rngPick(seed, `${label}:prefix`, PREFIXES)} ${rngPick(seed, `${label}:suffix`, SUFFIXES)}`;
  const drawback =
    rarity === "legendary" || rarity === "mythic" || rarity === "unhinged"
      ? {
          id: `drawback_${rngPick(seed, `${label}:drawback`, ["overheat", "fragile_focus", "reckless_bloom", "doom_mark"])}`,
          description: "Power spike invites retaliation: faction heat rises and your next defense roll is weaker.",
          world_reaction: true,
        }
      : {};

  const weaponFamily = slot === "weapon"
    ? (weaponFamilyHint && WEAPON_FAMILIES.includes(weaponFamilyHint as (typeof WEAPON_FAMILIES)[number])
      ? weaponFamilyHint
      : rngPick(seed, `${label}:weapon_family`, WEAPON_FAMILIES))
    : null;

  return {
    campaign_id: campaignId,
    owner_character_id: characterId,
    name,
    rarity,
    item_type: rngPick(seed, `${label}:item_type`, ITEM_TYPES),
    slot,
    weapon_family: weaponFamily,
    weapon_profile: slot === "weapon" ? { style: classRole, speed: rngInt(seed, `${label}:speed`, 1, 5) } : {},
    affixes: Object.entries(statMods).map(([k, v]) => ({ key: k, value: v })),
    stat_mods: statMods,
    effects_json: {
      source,
      budget,
      granted_abilities: rarity === "mythic" || rarity === "unhinged" ? [`mythic_proc_${slot}`] : [],
    },
    drawback_json: drawback,
    narrative_hook: `${name} surfaced after a violent clash and still hums with static malice.`,
    durability_json: {
      current: 100,
      max: 100,
      decay_per_use: rarity === "unhinged" ? 4 : 1,
    },
    required_level: Math.max(1, level - 2),
    item_power: Math.max(1, Math.floor(level * (1 + budget / 40))),
    set_tag: rarity === "mythic" || rarity === "unhinged" ? `${classRole}_ascendant` : null,
    drop_tier: rarityTier(rarity),
    bind_policy: rarity === "common" || rarity === "magical" ? "unbound" : "bind_on_equip",
    _debug: {
      name,
      budget,
    },
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

    const { campaignId, characterId, combatSessionId, count, source, rarity, seed } = parsed.data;
    const svc = createClient(supabaseUrl, serviceRoleKey);

    const { data: campaign, error: campaignErr } = await svc
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignErr) throw campaignErr;
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: member, error: memberErr } = await svc
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberErr) throw memberErr;
    if (!member && campaign.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not authorized for this campaign" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const charQuery = svc
      .schema("mythic")
      .from("characters")
      .select("id, level, class_json, player_id")
      .eq("campaign_id", campaignId)
      .eq(characterId ? "id" : "player_id", characterId ?? user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data: character, error: charErr } = await charQuery;
    if (charErr) throw charErr;
    if (!character) {
      return new Response(JSON.stringify({ error: "Character not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const classJson = (character.class_json ?? {}) as Record<string, unknown>;
    const role = String(classJson.role ?? "hybrid");
    const weaponHint = typeof classJson.weapon_identity === "object" && classJson.weapon_identity
      ? String((classJson.weapon_identity as Record<string, unknown>).family ?? "")
      : "";
    const level = Math.max(1, Math.min(99, rowToInt(character.level, 1)));
    const baseSeed = seed ?? (Math.floor(Date.now() / 1000) % 2_147_483_647);

    const generatedItems = Array.from({ length: count }).map((_, idx) => {
      const itemRarity = rarity ?? pickRarity(baseSeed, `loot:rarity:${idx}`, level);
      return rollItem({
        seed: baseSeed,
        label: `loot:${campaignId}:${character.id}:${idx}`,
        level,
        rarity: itemRarity,
        classRole: role,
        weaponFamilyHint: weaponHint || null,
        campaignId,
        characterId: character.id,
        source,
      });
    });

    const itemRowsForInsert = generatedItems.map(({ _debug, ...row }) => row);
    const { data: insertedItems, error: insertItemsErr } = await svc
      .schema("mythic")
      .from("items")
      .insert(itemRowsForInsert)
      .select("*");
    if (insertItemsErr) throw insertItemsErr;

    const inventoryRows = (insertedItems ?? []).map((item) => ({
      character_id: character.id,
      item_id: item.id,
      container: "backpack",
      equip_slot: null,
      quantity: 1,
    }));
    const { error: inventoryErr } = await svc
      .schema("mythic")
      .from("inventory")
      .insert(inventoryRows);
    if (inventoryErr) throw inventoryErr;

    const rarityUsed = (insertedItems?.[0]?.rarity ?? generatedItems[0]?.rarity ?? "common") as Rarity;
    const budgetPoints = generatedItems.reduce((acc, item) => acc + BUDGETS[item.rarity as Rarity], 0);
    const { error: dropErr } = await svc
      .schema("mythic")
      .from("loot_drops")
      .insert({
        campaign_id: campaignId,
        combat_session_id: combatSessionId ?? null,
        source,
        rarity: rarityUsed,
        budget_points: budgetPoints,
        item_ids: (insertedItems ?? []).map((item) => item.id),
        payload: {
          generated_count: generatedItems.length,
          level,
          role,
        },
      });
    if (dropErr) throw dropErr;

    return new Response(
      JSON.stringify({
        ok: true,
        character_id: character.id,
        count: insertedItems?.length ?? 0,
        budget_points: budgetPoints,
        items: insertedItems ?? [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const normalized = sanitizeError(error);
    const message = normalized.message || toErrorMessage(error);
    logger.error("generate_loot.failed", error);
    return new Response(JSON.stringify({ error: message, code: normalized.code ?? "generate_loot_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
