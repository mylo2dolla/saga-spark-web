import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createLogger } from "../_shared/logger.ts";
import { sanitizeError } from "../_shared/redact.ts";
import {
  enforceRateLimit,
  getIdempotentResponse,
  idempotencyKeyFromRequest,
  storeIdempotentResponse,
} from "../_shared/request_guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-request-id",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid(),
  vendorId: z.string().min(1).max(80),
  stockItemId: z.string().min(1).max(80),
});

const logger = createLogger("mythic-shop-buy");

const requestIdFrom = (req: Request) =>
  req.headers.get("x-request-id")
  ?? req.headers.get("x-correlation-id")
  ?? req.headers.get("sb-request-id")
  ?? crypto.randomUUID();

async function uuidFromKey(key: string, label: string): Promise<string> {
  const data = new TextEncoder().encode(`${label}:${key}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const bytes = hash.slice(0, 16);
  // Version 5-ish and RFC4122 variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toCoins(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pullVendorStock(state: Record<string, unknown>, vendorId: string) {
  const vendorStockRoot = (state.vendor_stock && typeof state.vendor_stock === "object") ? state.vendor_stock as Record<string, unknown> : {};
  const stock = vendorStockRoot[vendorId];
  if (!stock || typeof stock !== "object") return { vendorStockRoot, stock: null as Record<string, unknown> | null };
  return { vendorStockRoot, stock: stock as Record<string, unknown> };
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
    route: "mythic-shop-buy",
    limit: 30,
    windowMs: 60_000,
    corsHeaders,
  });
  if (rateLimited) return rateLimited;

  const idemKey = idempotencyKeyFromRequest(req);
  if (!idemKey) {
    return new Response(JSON.stringify({ error: "Missing x-idempotency-key header", code: "idempotency_required", requestId }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const cached = getIdempotentResponse(idemKey);
  if (cached) {
    return cached;
  }

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

    const { campaignId, characterId, vendorId, stockItemId } = parsed.data;

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

    const { data: character, error: charErr } = await svc
      .schema("mythic")
      .from("characters")
      .select("id, campaign_id, resources, updated_at")
      .eq("id", characterId)
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (charErr) throw charErr;
    if (!character) {
      return new Response(JSON.stringify({ error: "Character not found", code: "character_not_found", requestId }), {
        status: 404,
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
    const { vendorStockRoot, stock } = pullVendorStock(state, vendorId);
    if (!stock) {
      return new Response(JSON.stringify({ error: "Vendor stock not found. Open the shop first.", code: "vendor_stock_missing", requestId }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const itemsRaw = Array.isArray(stock.items) ? stock.items as Array<Record<string, unknown>> : [];
    const stockItem = itemsRaw.find((entry) => String(entry?.id ?? "") === stockItemId) ?? null;
    if (!stockItem) {
      return new Response(JSON.stringify({ error: "Stock item not found", code: "stock_item_not_found", requestId }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sold = Boolean(stockItem.sold);
    const soldTo = typeof stockItem.sold_to === "string" ? stockItem.sold_to : null;
    const purchaseKey = typeof stockItem.purchase_key === "string" ? stockItem.purchase_key : null;
    if (sold && soldTo && soldTo !== characterId) {
      return new Response(JSON.stringify({ error: "Item already sold", code: "sold_out", requestId }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (sold && purchaseKey && purchaseKey !== idemKey) {
      return new Response(JSON.stringify({ error: "Item already sold", code: "sold_out", requestId }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const price = toCoins(stockItem.price);
    const resources = asRecord(character.resources) ?? {};
    const coins = toCoins(resources.coins);
    const ledgerRaw = Array.isArray(resources.purchase_ledger) ? resources.purchase_ledger as unknown[] : [];
    const ledger = ledgerRaw.filter((v): v is string => typeof v === "string").slice(-50);
    const alreadyPaid = ledger.includes(idemKey);

    if (!alreadyPaid && coins < price) {
      return new Response(JSON.stringify({ error: "Insufficient funds", code: "insufficient_funds", details: { price, coins }, requestId }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nextCoins = alreadyPaid ? coins : Math.max(0, coins - price);
    const nextLedger = alreadyPaid ? ledger : [...ledger, idemKey].slice(-50);
    const nextResources = {
      ...resources,
      coins: nextCoins,
      purchase_ledger: nextLedger,
    };

    // Ensure the item exists (idempotent insert).
    const itemPayload = asRecord(stockItem.item) ?? {};
    const itemId = await uuidFromKey(idemKey, "shop:item");
    const invId = await uuidFromKey(idemKey, "shop:inv");

    const effectsJson = (asRecord(itemPayload.effects_json) ?? {});
    const mergedEffects = {
      ...effectsJson,
      purchase: {
        vendor_id: vendorId,
        stock_item_id: stockItemId,
        idempotency_key: idemKey,
        price,
        purchased_at: new Date().toISOString(),
      },
    };

    const { error: itemErr } = await svc
      .schema("mythic")
      .from("items")
      .upsert(
        {
          id: itemId,
          campaign_id: campaignId,
          owner_character_id: characterId,
          name: String(itemPayload.name ?? "Item"),
          rarity: (typeof itemPayload.rarity === "string" ? itemPayload.rarity : "common"),
          item_type: String(itemPayload.item_type ?? "gear"),
          slot: String(itemPayload.slot ?? "other"),
          weapon_family: itemPayload.weapon_family ?? null,
          weapon_profile: itemPayload.weapon_profile ?? {},
          affixes: itemPayload.affixes ?? [],
          stat_mods: itemPayload.stat_mods ?? {},
          effects_json: mergedEffects,
          drawback_json: itemPayload.drawback_json ?? {},
          narrative_hook: itemPayload.narrative_hook ?? null,
          durability_json: itemPayload.durability_json ?? {},
          required_level: Number(itemPayload.required_level ?? 1),
          item_power: Number(itemPayload.item_power ?? 0),
          set_tag: itemPayload.set_tag ?? null,
          drop_tier: String(itemPayload.drop_tier ?? "common"),
          bind_policy: String(itemPayload.bind_policy ?? "bind_on_equip"),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    if (itemErr) throw itemErr;

    const { error: invErr } = await svc
      .schema("mythic")
      .from("inventory")
      .upsert(
        {
          id: invId,
          character_id: characterId,
          item_id: itemId,
          container: "backpack",
          quantity: 1,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      );
    if (invErr) throw invErr;

    // Persist coins (idempotent via purchase_ledger).
    const { error: resErr } = await svc
      .schema("mythic")
      .from("characters")
      .update({ resources: nextResources, updated_at: new Date().toISOString() })
      .eq("id", characterId);
    if (resErr) throw resErr;

    // Mark stock item sold in board state (best-effort; idempotent).
    const nextItems = itemsRaw.map((entry) => {
      if (String(entry.id ?? "") !== stockItemId) return entry;
      return {
        ...entry,
        sold: true,
        sold_to: characterId,
        sold_at: new Date().toISOString(),
        purchase_key: idemKey,
      };
    });
    const nextVendorStock = {
      ...stock,
      items: nextItems,
    };
    const nextState: Record<string, unknown> = {
      ...state,
      vendor_stock: {
        ...vendorStockRoot,
        [vendorId]: nextVendorStock,
      },
    };

    const { error: boardUpdErr } = await svc
      .schema("mythic")
      .from("boards")
      .update({ state_json: nextState, updated_at: new Date().toISOString() })
      .eq("id", board.id);
    if (boardUpdErr) throw boardUpdErr;

    // Record for DM continuity.
    await svc.schema("mythic").from("dm_memory_events").insert({
      campaign_id: campaignId,
      player_id: user.id,
      category: "shop_purchase",
      severity: 1,
      payload: {
        vendor_id: vendorId,
        stock_item_id: stockItemId,
        item_id: itemId,
        price,
        coins_after: nextCoins,
      },
    });

    const payload = {
      ok: true,
      itemId,
      coins: nextCoins,
      vendorId,
      stockItemId,
      requestId,
    };
    const response = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json", "x-request-id": requestId },
    });
    storeIdempotentResponse(idemKey, response, 60_000);

    logger.info("shop.buy.success", { request_id: requestId, campaign_id: campaignId, vendor_id: vendorId, stock_item_id: stockItemId, item_id: itemId });
    return response;
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("shop.buy.failed", error, { request_id: requestId });
    return new Response(
      JSON.stringify({ ok: false, error: normalized.message || "Purchase failed", code: normalized.code ?? "shop_buy_failed", requestId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

