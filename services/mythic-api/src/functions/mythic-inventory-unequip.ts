import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess, assertCharacterAccess } from "../shared/authz.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid(),
  inventoryId: z.string().uuid(),
});

export const mythicInventoryUnequip: FunctionHandler = {
  name: "mythic-inventory-unequip",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const baseHeaders = { "Content-Type": "application/json", "x-request-id": ctx.requestId };
    try {
      const user = await requireUser(req.headers);
      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId: ctx.requestId }), {
          status: 400,
          headers: baseHeaders,
        });
      }

      const { campaignId, characterId, inventoryId } = parsed.data;
      const svc = createServiceClient();

      await assertCampaignAccess(svc, campaignId, user.userId);
      await assertCharacterAccess(svc, { campaignId, characterId, userId: user.userId });

      const { data: row, error: rowErr } = await svc
        .schema("mythic")
        .from("inventory")
        .select("id, character_id, item_id, container, equip_slot")
        .eq("id", inventoryId)
        .maybeSingle();
      if (rowErr) throw rowErr;
      if (!row) {
        return new Response(JSON.stringify({ error: "Inventory entry not found", code: "inventory_not_found", requestId: ctx.requestId }), {
          status: 404,
          headers: baseHeaders,
        });
      }
      if ((row as { character_id: string }).character_id !== characterId) {
        return new Response(JSON.stringify({ error: "Inventory entry does not belong to character", code: "inventory_character_mismatch", requestId: ctx.requestId }), {
          status: 403,
          headers: baseHeaders,
        });
      }

      const nowIso = new Date().toISOString();
      const { error: unequipErr } = await svc
        .schema("mythic")
        .from("inventory")
        .update({ container: "backpack", equip_slot: null, equipped_at: null, updated_at: nowIso })
        .eq("id", inventoryId)
        .eq("character_id", characterId);
      if (unequipErr) throw unequipErr;

      const { error: eventErr } = await svc
        .schema("mythic")
        .from("progression_events")
        .insert({
          campaign_id: campaignId,
          character_id: characterId,
          event_type: "gear_unequipped",
          payload: {
            inventory_id: inventoryId,
            item_id: (row as { item_id?: string | null }).item_id ?? null,
            slot: (row as { equip_slot?: string | null }).equip_slot ?? null,
          },
        });
      if (eventErr) {
        ctx.log.warn("inventory_unequip.event_write_failed", {
          request_id: ctx.requestId,
          inventory_id: inventoryId,
          code: eventErr.code,
          message: eventErr.message,
        });
      }

      return new Response(JSON.stringify({ ok: true, inventoryId, characterId, requestId: ctx.requestId }), {
        status: 200,
        headers: baseHeaders,
      });
    } catch (error) {
      if (error instanceof AuthError) {
        const message = error.code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code: error.code, requestId: ctx.requestId }), {
          status: 401,
          headers: baseHeaders,
        });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId: ctx.requestId }), {
          status: error.status,
          headers: baseHeaders,
        });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("inventory_unequip.failed", { request_id: ctx.requestId, code: normalized.code, message: normalized.message });
      return new Response(JSON.stringify({ error: normalized.message || "Failed to unequip item", code: normalized.code ?? "inventory_unequip_failed", requestId: ctx.requestId }), {
        status: 500,
        headers: baseHeaders,
      });
    }
  },
};
