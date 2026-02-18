import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { rngInt, rngPick, weightedPick } from "../shared/mythic_rng.js";
import { enforceRateLimit } from "../shared/request_guard.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  vendorId: z.string().min(1).max(80),
});

type Rarity = "common" | "magical" | "unique" | "legendary" | "mythic" | "unhinged";
const SLOT_POOL = ["weapon", "armor", "helm", "gloves", "boots", "belt", "amulet", "ring", "trinket"] as const;
const ITEM_TYPES = ["gear", "artifact", "relic"] as const;
const PREFIXES = ["Rust", "Blood", "Ash", "Night", "Storm", "Iron", "Obsidian", "Void", "Saint", "Cursed"];
const SUFFIXES = ["Bite", "Ward", "Edge", "Pulse", "Lash", "Sigil", "Breaker", "Halo", "Howl", "Spite"];
const WEAPON_FAMILIES = ["blades", "axes", "blunt", "polearms", "ranged", "focus", "body", "absurd"] as const;

const BUDGETS: Record<Rarity, number> = {
  common: 8,
  magical: 16,
  unique: 24,
  legendary: 40,
  mythic: 60,
  unhinged: 70,
};

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 2_147_483_647;
}

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

function pickClassRole(seed: number, label: string): string {
  return weightedPick(seed, label, [
    { item: "dps", weight: 8 },
    { item: "skirmisher", weight: 6 },
    { item: "tank", weight: 5 },
    { item: "controller", weight: 5 },
    { item: "support", weight: 4 },
  ]);
}

function rollStockItem(args: {
  seed: number;
  label: string;
  level: number;
  rarity: Rarity;
  classRole: string;
}) {
  const { seed, label, level, rarity, classRole } = args;
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
  const weaponFamily = slot === "weapon" ? rngPick(seed, `${label}:weapon_family`, WEAPON_FAMILIES) : null;

  const requiredLevel = Math.max(1, level - 2);
  const itemPower = Math.max(1, Math.floor(level * (1 + budget / 40)));
  const price = Math.max(
    5,
    Math.floor(itemPower * (rarity === "common" ? 1.2 : rarity === "magical" ? 1.6 : rarity === "unique" ? 2.2 : rarity === "legendary" ? 3.0 : 3.6)),
  );

  return {
    id: `stock_${rngInt(seed, `${label}:id`, 1000, 9_999_999)}`,
    price,
    item: {
      name,
      rarity,
      item_type: rngPick(seed, `${label}:item_type`, ITEM_TYPES),
      slot,
      weapon_family: weaponFamily,
      weapon_profile: slot === "weapon" ? { style: classRole, speed: rngInt(seed, `${label}:speed`, 1, 5) } : {},
      affixes: Object.entries(statMods).map(([k, v]) => ({ key: k, value: v })),
      stat_mods: statMods,
      effects_json: {
        source: "vendor_stock",
        budget,
        granted_abilities: rarity === "mythic" || rarity === "unhinged" ? [`mythic_proc_${slot}`] : [],
      },
      drawback_json: {},
      narrative_hook: `${name} sits behind the counter like it wants to bite.`,
      durability_json: { current: 100, max: 100, decay_per_use: rarity === "unhinged" ? 4 : 1 },
      required_level: requiredLevel,
      item_power: itemPower,
      set_tag: rarity === "mythic" || rarity === "unhinged" ? `${classRole}_ascendant` : null,
      drop_tier: rarityTier(rarity),
      bind_policy: rarity === "common" || rarity === "magical" ? "unbound" : "bind_on_equip",
    },
  };
}

export const mythicShopStock: FunctionHandler = {
  name: "mythic-shop-stock",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const requestId = ctx.requestId;
    const baseHeaders = { "Content-Type": "application/json", "x-request-id": requestId };

    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-shop-stock",
      limit: 40,
      windowMs: 60_000,
      corsHeaders: {},
      requestId,
    });
    if (rateLimited) return rateLimited;

    try {
      const user = await requireUser(req.headers);

      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId }), {
          status: 400,
          headers: baseHeaders,
        });
      }

      const { campaignId, vendorId } = parsed.data;
      const svc = createServiceClient();

      await assertCampaignAccess(svc, campaignId, user.userId);

      const { data: board, error: boardErr } = await svc
        .schema("mythic")
        .from("boards")
        .select("id, board_type, state_json, updated_at")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (boardErr) throw boardErr;
      if (!board) {
        return new Response(JSON.stringify({ error: "No active board found", code: "board_missing", requestId }), { status: 404, headers: baseHeaders });
      }
      if ((board as any).board_type !== "town") {
        return new Response(JSON.stringify({ error: "Shops are only available in town.", code: "board_not_town", requestId }), { status: 409, headers: baseHeaders });
      }

      const state = ((board as any).state_json && typeof (board as any).state_json === "object") ? ((board as any).state_json as Record<string, unknown>) : {};
      const vendors = Array.isArray((state as any).vendors) ? ((state as any).vendors as Array<Record<string, unknown>>) : [];
      const vendorRow = vendors.find((v) => String((v as any)?.id ?? "").trim() === vendorId) ?? null;
      if (!vendorRow) {
        return new Response(JSON.stringify({ error: "Vendor not found", code: "vendor_not_found", requestId }), { status: 404, headers: baseHeaders });
      }
      const vendorName = String((vendorRow as any).name ?? "Merchant");

      const vendorStockRoot = ((state as any).vendor_stock && typeof (state as any).vendor_stock === "object") ? ((state as any).vendor_stock as Record<string, unknown>) : {};
      const existingStock = vendorStockRoot[vendorId];
      if (existingStock && typeof existingStock === "object") {
        const items = (existingStock as Record<string, unknown>).items;
        if (Array.isArray(items) && items.length > 0) {
          return new Response(JSON.stringify({ ok: true, vendorId, vendorName, stock: existingStock, requestId }), { status: 200, headers: baseHeaders });
        }
      }

      const { data: topChar } = await svc
        .schema("mythic")
        .from("characters")
        .select("level")
        .eq("campaign_id", campaignId)
        .order("level", { ascending: false })
        .limit(1)
        .maybeSingle();
      const level = Math.max(1, Math.min(99, Number((topChar as { level?: unknown } | null)?.level ?? 1)));

      const boardSeed = Number((state as any).seed ?? 0) || 0;
      const seed = (hashSeed(`shop-stock:${campaignId}:${vendorId}`) ^ boardSeed) >>> 0;
      const classRole = pickClassRole(seed, "shop:role");

      const count = 6;
      const items = Array.from({ length: count }).map((_, idx) => {
        const rarity = pickRarity(seed, `shop:rarity:${idx}`, level);
        return rollStockItem({
          seed,
          label: `shop:item:${idx}`,
          level,
          rarity,
          classRole,
        });
      });

      const stock = {
        vendor_id: vendorId,
        vendor_name: vendorName,
        generated_at: new Date().toISOString(),
        seed,
        items,
      };

      const nextState: Record<string, unknown> = {
        ...state,
        vendor_stock: {
          ...vendorStockRoot,
          [vendorId]: stock,
        },
      };

      const { error: updErr } = await svc
        .schema("mythic")
        .from("boards")
        .update({ state_json: nextState, updated_at: new Date().toISOString() })
        .eq("id", (board as any).id);
      if (updErr) throw updErr;

      ctx.log.info("shop.stock.generated", { request_id: requestId, campaign_id: campaignId, vendor_id: vendorId, items: count });

      return new Response(JSON.stringify({ ok: true, vendorId, vendorName, stock, requestId }), { status: 200, headers: baseHeaders });
    } catch (error) {
      if (error instanceof AuthError) {
        const code = error.code === "auth_required" ? "auth_required" : "auth_invalid";
        const message = code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code, requestId }), { status: 401, headers: baseHeaders });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId }), { status: error.status, headers: baseHeaders });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("shop.stock.failed", { request_id: requestId, error: normalized.message, code: normalized.code });
      return new Response(
        JSON.stringify({ ok: false, error: normalized.message || "Failed to load shop stock", code: normalized.code ?? "shop_stock_failed", requestId }),
        { status: 500, headers: baseHeaders },
      );
    }
  },
};

