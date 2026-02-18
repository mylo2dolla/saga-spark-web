import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createLogger } from "../_shared/logger.ts";
import {
  enforceRateLimit,
  getIdempotentResponse,
  idempotencyKeyFromRequest,
  storeIdempotentResponse,
} from "../_shared/request_guard.ts";
import { sanitizeError } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid(),
  inventoryId: z.string().uuid(),
});

const logger = createLogger("mythic-inventory-equip");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rateLimited = enforceRateLimit({
    req,
    route: "mythic-inventory-equip",
    limit: 120,
    windowMs: 60_000,
    corsHeaders,
  });
  if (rateLimited) return rateLimited;

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

    const { campaignId, characterId, inventoryId } = parsed.data;
    const svc = createClient(supabaseUrl, serviceRoleKey);

    const idempotencyHeader = idempotencyKeyFromRequest(req);
    const idempotencyKey = idempotencyHeader ? `${user.id}:${idempotencyHeader}` : null;
    if (idempotencyKey) {
      const cached = getIdempotentResponse(idempotencyKey);
      if (cached) return cached;
    }

    const { data: campaign, error: campaignError } = await svc
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", campaignId)
      .maybeSingle();
    if (campaignError) throw campaignError;
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found", code: "campaign_not_found" }), {
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
      return new Response(JSON.stringify({ error: "Not authorized for this campaign", code: "campaign_access_denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: character, error: charError } = await svc
      .schema("mythic")
      .from("characters")
      .select("id,campaign_id,player_id")
      .eq("id", characterId)
      .eq("campaign_id", campaignId)
      .maybeSingle();
    if (charError) throw charError;
    if (!character) {
      return new Response(JSON.stringify({ error: "Character not found", code: "character_missing" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (character.player_id !== user.id) {
      return new Response(JSON.stringify({ error: "Character does not belong to you", code: "character_access_denied" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: invRow, error: invError } = await svc
      .schema("mythic")
      .from("inventory")
      .select("id,character_id,item_id,container,equip_slot")
      .eq("id", inventoryId)
      .maybeSingle();
    if (invError) throw invError;
    if (!invRow || invRow.character_id !== characterId) {
      return new Response(JSON.stringify({ error: "Inventory item not found", code: "inventory_missing" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: itemRow, error: itemError } = await svc
      .schema("mythic")
      .from("items")
      .select("id,slot")
      .eq("id", invRow.item_id)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!itemRow) {
      return new Response(JSON.stringify({ error: "Item not found", code: "item_missing" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const itemSlot = typeof itemRow.slot === "string" && itemRow.slot.trim().length > 0 ? itemRow.slot : "other";
    const isUnlimited = itemSlot === "ring" || itemSlot === "trinket";
    const now = new Date().toISOString();

    if (!isUnlimited) {
      const { error: unequipErr } = await svc
        .schema("mythic")
        .from("inventory")
        .update({ container: "backpack", equip_slot: null, equipped_at: null, updated_at: now })
        .eq("character_id", characterId)
        .eq("container", "equipment")
        .eq("equip_slot", itemSlot);
      if (unequipErr) throw unequipErr;
    }

    // If it's already equipped in the right slot, treat as idempotent success.
    if (invRow.container === "equipment" && invRow.equip_slot === itemSlot) {
      const response = new Response(JSON.stringify({ ok: true, inventoryId, equip_slot: itemSlot, already_equipped: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
      if (idempotencyKey) storeIdempotentResponse(idempotencyKey, response, 10_000);
      return response;
    }

    const { error: equipErr } = await svc
      .schema("mythic")
      .from("inventory")
      .update({ container: "equipment", equip_slot: itemSlot, equipped_at: now, updated_at: now })
      .eq("id", inventoryId)
      .eq("character_id", characterId);
    if (equipErr) throw equipErr;

    const response = new Response(JSON.stringify({ ok: true, inventoryId, equip_slot: itemSlot }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    if (idempotencyKey) storeIdempotentResponse(idempotencyKey, response, 10_000);
    return response;
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("inventory_equip.failed", error);
    return new Response(JSON.stringify({
      error: normalized.message || "Failed to equip item",
      code: normalized.code ?? "inventory_equip_failed",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

