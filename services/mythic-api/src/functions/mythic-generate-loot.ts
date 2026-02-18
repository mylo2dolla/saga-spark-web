import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { rngInt, rngPick, weightedPick } from "../shared/mythic_rng.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

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
    ? (weaponFamilyHint && (WEAPON_FAMILIES as readonly string[]).includes(weaponFamilyHint)
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
  };
}

export const mythicGenerateLoot: FunctionHandler = {
  name: "mythic-generate-loot",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const requestId = ctx.requestId;
    const baseHeaders = { "Content-Type": "application/json", "x-request-id": requestId };

    try {
      const user = await requireUser(req.headers);

      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
          status: 400,
          headers: baseHeaders,
        });
      }

      const { campaignId, characterId, combatSessionId, count, source, rarity, seed } = parsed.data;
      const svc = createServiceClient();

      const access = await assertCampaignAccess(svc, campaignId, user.userId);

      const charQuery = svc
        .schema("mythic")
        .from("characters")
        .select("id, level, class_json, player_id")
        .eq("campaign_id", campaignId)
        .eq(characterId ? "id" : "player_id", characterId ?? user.userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: character, error: charErr } = await charQuery;
      if (charErr) throw charErr;
      if (!character) {
        return new Response(JSON.stringify({ error: "Character not found" }), { status: 404, headers: baseHeaders });
      }

      if (!access.isDm && (character as any).player_id !== user.userId) {
        return new Response(JSON.stringify({ error: "Not authorized for this character", code: "character_access_denied", requestId }), {
          status: 403,
          headers: baseHeaders,
        });
      }

      const classJson = ((character as any).class_json ?? {}) as Record<string, unknown>;
      const role = String(classJson.role ?? "hybrid");
      const weaponHint = typeof (classJson as any).weapon_identity === "object" && (classJson as any).weapon_identity
        ? String(((classJson as any).weapon_identity as Record<string, unknown>).family ?? "")
        : "";
      const level = Math.max(1, Math.min(99, rowToInt((character as any).level, 1)));
      const baseSeed = seed ?? (Math.floor(Date.now() / 1000) % 2_147_483_647);

      const generatedItems = Array.from({ length: count }).map((_, idx) => {
        const itemRarity = rarity ?? pickRarity(baseSeed, `loot:rarity:${idx}`, level);
        return rollItem({
          seed: baseSeed,
          label: `loot:${campaignId}:${(character as any).id}:${idx}`,
          level,
          rarity: itemRarity,
          classRole: role,
          weaponFamilyHint: weaponHint || null,
          campaignId,
          characterId: (character as any).id,
          source,
        });
      });

      const { data: insertedItems, error: insertItemsErr } = await svc
        .schema("mythic")
        .from("items")
        .insert(generatedItems)
        .select("*");
      if (insertItemsErr) throw insertItemsErr;

      const inventoryRows = (insertedItems ?? []).map((item: any) => ({
        character_id: (character as any).id,
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

      const rarityUsed = ((insertedItems?.[0] as any)?.rarity ?? (generatedItems[0] as any)?.rarity ?? "common") as Rarity;
      const budgetPoints = generatedItems.reduce((acc, item: any) => acc + BUDGETS[item.rarity as Rarity], 0);
      const { error: dropErr } = await svc
        .schema("mythic")
        .from("loot_drops")
        .insert({
          campaign_id: campaignId,
          combat_session_id: combatSessionId ?? null,
          source,
          rarity: rarityUsed,
          budget_points: budgetPoints,
          item_ids: (insertedItems ?? []).map((item: any) => item.id),
          payload: {
            generated_count: generatedItems.length,
            level,
            role,
          },
        });
      if (dropErr) throw dropErr;

      return new Response(JSON.stringify({
        ok: true,
        character_id: (character as any).id,
        count: insertedItems?.length ?? 0,
        budget_points: budgetPoints,
        items: insertedItems ?? [],
      }), { status: 200, headers: baseHeaders });
    } catch (error) {
      if (error instanceof AuthError) {
        const message = error.code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code: error.code, requestId }), { status: 401, headers: baseHeaders });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId }), { status: error.status, headers: baseHeaders });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("generate_loot.failed", { request_id: requestId, error: normalized.message, code: normalized.code });
      return new Response(JSON.stringify({ error: normalized.message || "Failed to generate loot", code: normalized.code ?? "generate_loot_failed", requestId }), {
        status: 500,
        headers: baseHeaders,
      });
    }
  },
};

