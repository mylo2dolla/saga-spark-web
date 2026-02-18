import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { rngInt, rngPick, weightedPick } from "../_shared/mythic_rng.ts";
import { createLogger } from "../_shared/logger.ts";
import { sanitizeError } from "../_shared/redact.ts";
import { enforceRateLimit } from "../_shared/request_guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-request-id",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  vendorId: z.string().min(1).max(80),
});

type Rarity = "common" | "magical" | "unique" | "legendary" | "mythic" | "unhinged";
const RARITIES: Rarity[] = ["common", "magical", "unique", "legendary", "mythic", "unhinged"];

const logger = createLogger("mythic-shop-stock");

const requestIdFrom = (req: Request) =>
  req.headers.get("x-request-id")
  ?? req.headers.get("x-correlation-id")
  ?? req.headers.get("sb-request-id")
  ?? crypto.randomUUID();

const hashSeed = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 2_147_483_647;
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
  const price = Math.max(5, Math.floor(itemPower * (rarity === "common" ? 1.2 : rarity === "magical" ? 1.6 : rarity === "unique" ? 2.2 : rarity === "legendary" ? 3.0 : 3.6)));

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
    route: "mythic-shop-stock",
    limit: 40,
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase env is not configured (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY)");
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { campaignId, vendorId } = parsed.data;

    const authToken = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(authToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token", code: "auth_invalid", requestId }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(supabaseUrl, serviceRoleKey);
    const { data: campaign, error: campaignErr } = await svc
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignErr) throw campaignErr;
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found", code: "campaign_not_found", requestId }), {
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
      return new Response(JSON.stringify({ error: "Not authorized for this campaign", code: "campaign_access_denied", requestId }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
      return new Response(JSON.stringify({ error: "No active board found", code: "board_missing", requestId }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (board.board_type !== "town") {
      return new Response(JSON.stringify({ error: "Shops are only available in town.", code: "board_not_town", requestId }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const state = (board.state_json && typeof board.state_json === "object") ? board.state_json as Record<string, unknown> : {};
    const vendors = Array.isArray(state.vendors) ? state.vendors as Array<Record<string, unknown>> : [];
    const vendorRow = vendors.find((v) => String(v?.id ?? "").trim() === vendorId) ?? null;
    if (!vendorRow) {
      return new Response(JSON.stringify({ error: "Vendor not found", code: "vendor_not_found", requestId }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const vendorName = String(vendorRow.name ?? "Merchant");

    const vendorStockRoot = (state.vendor_stock && typeof state.vendor_stock === "object") ? state.vendor_stock as Record<string, unknown> : {};
    const existingStock = vendorStockRoot[vendorId];
    if (existingStock && typeof existingStock === "object") {
      const items = (existingStock as Record<string, unknown>).items;
      if (Array.isArray(items) && items.length > 0) {
        return new Response(JSON.stringify({ ok: true, vendorId, vendorName, stock: existingStock, requestId }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
        });
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

    const boardSeed = Number(state.seed ?? 0) || 0;
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
      .eq("id", board.id);
    if (updErr) throw updErr;

    logger.info("shop.stock.generated", { request_id: requestId, campaign_id: campaignId, vendor_id: vendorId, items: count });

    return new Response(JSON.stringify({ ok: true, vendorId, vendorName, stock, requestId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("shop.stock.failed", error, { request_id: requestId });
    return new Response(
      JSON.stringify({ ok: false, error: normalized.message || "Failed to load shop stock", code: normalized.code ?? "shop_stock_failed", requestId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

