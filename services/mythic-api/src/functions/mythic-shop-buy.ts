import { createHash } from "node:crypto";

import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { sanitizeError } from "../shared/redact.js";
import {
  enforceRateLimit,
  getIdempotentResponse,
  idempotencyKeyFromRequest,
  storeIdempotentResponse,
} from "../shared/request_guard.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid(),
  vendorId: z.string().min(1).max(80),
  stockItemId: z.string().min(1).max(80),
});

function uuidFromKey(key: string, label: string): string {
  const hash = createHash("sha256").update(`${label}:${key}`).digest();
  const bytes = Uint8Array.from(hash.subarray(0, 16));
  // Version 5-ish and RFC4122 variant.
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString("hex");
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
  const vendorStockRoot = (state.vendor_stock && typeof state.vendor_stock === "object") ? (state.vendor_stock as Record<string, unknown>) : {};
  const stock = vendorStockRoot[vendorId];
  if (!stock || typeof stock !== "object") return { vendorStockRoot, stock: null as Record<string, unknown> | null };
  return { vendorStockRoot, stock: stock as Record<string, unknown> };
}

export const mythicShopBuy: FunctionHandler = {
  name: "mythic-shop-buy",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const requestId = ctx.requestId;
    const baseHeaders = { "Content-Type": "application/json", "x-request-id": requestId };

    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-shop-buy",
      limit: 30,
      windowMs: 60_000,
      corsHeaders: {},
      requestId,
    });
    if (rateLimited) return rateLimited;

    const idemKey = idempotencyKeyFromRequest(req);
    if (!idemKey) {
      return new Response(JSON.stringify({ error: "Missing x-idempotency-key header", code: "idempotency_required", requestId }), {
        status: 400,
        headers: baseHeaders,
      });
    }

    const cached = getIdempotentResponse(idemKey);
    if (cached) {
      return cached;
    }

    try {
      const user = await requireUser(req.headers);

      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId }), {
          status: 400,
          headers: baseHeaders,
        });
      }

      const { campaignId, characterId, vendorId, stockItemId } = parsed.data;
      const svc = createServiceClient();

      const access = await assertCampaignAccess(svc, campaignId, user.userId);

      const { data: character, error: charErr } = await svc
        .schema("mythic")
        .from("characters")
        .select("id, campaign_id, player_id, resources, updated_at")
        .eq("id", characterId)
        .eq("campaign_id", campaignId)
        .maybeSingle();
      if (charErr) throw charErr;
      if (!character) {
        return new Response(JSON.stringify({ error: "Character not found", code: "character_not_found", requestId }), {
          status: 404,
          headers: baseHeaders,
        });
      }
      if (!access.isDm && (character as any).player_id !== user.userId) {
        return new Response(JSON.stringify({ error: "Not authorized for this character", code: "character_access_denied", requestId }), {
          status: 403,
          headers: baseHeaders,
        });
      }

      const { data: runtime, error: runtimeErr } = await svc
        .schema("mythic")
        .from("campaign_runtime")
        .select("id, mode, state_json, updated_at")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (runtimeErr) throw runtimeErr;
      if (!runtime) {
        return new Response(JSON.stringify({ error: "No active runtime found", code: "runtime_missing", requestId }), {
          status: 404,
          headers: baseHeaders,
        });
      }
      if ((runtime as any).mode !== "town") {
        return new Response(JSON.stringify({ error: "Shops are only available in town.", code: "runtime_not_town", requestId }), {
          status: 409,
          headers: baseHeaders,
        });
      }

      const state = ((runtime as any).state_json && typeof (runtime as any).state_json === "object") ? ((runtime as any).state_json as Record<string, unknown>) : {};
      const { vendorStockRoot, stock } = pullVendorStock(state, vendorId);
      if (!stock) {
        return new Response(JSON.stringify({ error: "Vendor stock not found. Open the shop first.", code: "vendor_stock_missing", requestId }), {
          status: 404,
          headers: baseHeaders,
        });
      }
      const itemsRaw = Array.isArray((stock as any).items) ? ((stock as any).items as Array<Record<string, unknown>>) : [];
      const stockItem = itemsRaw.find((entry) => String((entry as any)?.id ?? "") === stockItemId) ?? null;
      if (!stockItem) {
        return new Response(JSON.stringify({ error: "Stock item not found", code: "stock_item_not_found", requestId }), {
          status: 404,
          headers: baseHeaders,
        });
      }

      const sold = Boolean((stockItem as any).sold);
      const soldTo = typeof (stockItem as any).sold_to === "string" ? (stockItem as any).sold_to : null;
      const purchaseKey = typeof (stockItem as any).purchase_key === "string" ? (stockItem as any).purchase_key : null;
      if (sold && soldTo && soldTo !== characterId) {
        return new Response(JSON.stringify({ error: "Item already sold", code: "sold_out", requestId }), {
          status: 409,
          headers: baseHeaders,
        });
      }
      if (sold && purchaseKey && purchaseKey !== idemKey) {
        return new Response(JSON.stringify({ error: "Item already sold", code: "sold_out", requestId }), {
          status: 409,
          headers: baseHeaders,
        });
      }

      const price = toCoins((stockItem as any).price);
      const resources = asRecord((character as any).resources) ?? {};
      const coins = toCoins((resources as any).coins);
      const ledgerRaw = Array.isArray((resources as any).purchase_ledger) ? ((resources as any).purchase_ledger as unknown[]) : [];
      const ledger = ledgerRaw.filter((v): v is string => typeof v === "string").slice(-50);
      const alreadyPaid = ledger.includes(idemKey);

      if (!alreadyPaid && coins < price) {
        return new Response(JSON.stringify({ error: "Insufficient funds", code: "insufficient_funds", details: { price, coins }, requestId }), {
          status: 400,
          headers: baseHeaders,
        });
      }

      const nextCoins = alreadyPaid ? coins : Math.max(0, coins - price);
      const nextLedger = alreadyPaid ? ledger : [...ledger, idemKey].slice(-50);
      const nextResources = {
        ...resources,
        coins: nextCoins,
        purchase_ledger: nextLedger,
      };

      const itemPayload = asRecord((stockItem as any).item) ?? {};
      const itemId = uuidFromKey(idemKey, "shop:item");
      const invId = uuidFromKey(idemKey, "shop:inv");

      const effectsJson = asRecord((itemPayload as any).effects_json) ?? {};
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
            name: String((itemPayload as any).name ?? "Item"),
            rarity: (typeof (itemPayload as any).rarity === "string" ? (itemPayload as any).rarity : "common"),
            item_type: String((itemPayload as any).item_type ?? "gear"),
            slot: String((itemPayload as any).slot ?? "other"),
            weapon_family: (itemPayload as any).weapon_family ?? null,
            weapon_profile: (itemPayload as any).weapon_profile ?? {},
            affixes: (itemPayload as any).affixes ?? [],
            stat_mods: (itemPayload as any).stat_mods ?? {},
            effects_json: mergedEffects,
            drawback_json: (itemPayload as any).drawback_json ?? {},
            narrative_hook: (itemPayload as any).narrative_hook ?? null,
            durability_json: (itemPayload as any).durability_json ?? {},
            required_level: Number((itemPayload as any).required_level ?? 1),
            item_power: Number((itemPayload as any).item_power ?? 0),
            set_tag: (itemPayload as any).set_tag ?? null,
            drop_tier: String((itemPayload as any).drop_tier ?? "common"),
            bind_policy: String((itemPayload as any).bind_policy ?? "bind_on_equip"),
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

      const { error: resErr } = await svc
        .schema("mythic")
        .from("characters")
        .update({ resources: nextResources, updated_at: new Date().toISOString() })
        .eq("id", characterId);
      if (resErr) throw resErr;

      const nextItems = itemsRaw.map((entry) => {
        if (String((entry as any).id ?? "") !== stockItemId) return entry;
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
        .from("campaign_runtime")
        .update({ state_json: nextState, updated_at: new Date().toISOString() })
        .eq("id", (runtime as any).id);
      if (boardUpdErr) throw boardUpdErr;

      await svc.schema("mythic").from("dm_memory_events").insert({
        campaign_id: campaignId,
        player_id: user.userId,
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
      const response = new Response(JSON.stringify(payload), { status: 200, headers: baseHeaders });
      storeIdempotentResponse(idemKey, response, 60_000);

      ctx.log.info("shop.buy.success", { request_id: requestId, campaign_id: campaignId, vendor_id: vendorId, stock_item_id: stockItemId, item_id: itemId });
      return response;
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
      ctx.log.error("shop.buy.failed", { request_id: requestId, error: normalized.message, code: normalized.code });
      return new Response(
        JSON.stringify({ ok: false, error: normalized.message || "Purchase failed", code: normalized.code ?? "shop_buy_failed", requestId }),
        { status: 500, headers: baseHeaders },
      );
    }
  },
};
