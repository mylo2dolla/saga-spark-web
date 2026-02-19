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

const unlimitedSlots = new Set(["ring", "trinket"]);

export const mythicInventoryEquip: FunctionHandler = {
  name: "mythic-inventory-equip",
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
        .select("id, character_id, container, equip_slot, item:items(id,slot,name)")
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

      const item = (row as { item?: { slot?: string | null } | null }).item ?? null;
      const slot = typeof item?.slot === "string" ? item.slot.trim() : "";
      if (!slot) {
        return new Response(JSON.stringify({ error: "Item slot is missing", code: "item_slot_missing", requestId: ctx.requestId }), {
          status: 400,
          headers: baseHeaders,
        });
      }

      if (!unlimitedSlots.has(slot)) {
        const { error: clearErr } = await svc
          .schema("mythic")
          .from("inventory")
          .update({ container: "backpack", equip_slot: null, equipped_at: null, updated_at: new Date().toISOString() })
          .eq("character_id", characterId)
          .eq("container", "equipment")
          .eq("equip_slot", slot)
          .neq("id", inventoryId);
        if (clearErr) throw clearErr;
      }

      const nowIso = new Date().toISOString();
      const { error: equipErr } = await svc
        .schema("mythic")
        .from("inventory")
        .update({ container: "equipment", equip_slot: slot, equipped_at: nowIso, updated_at: nowIso })
        .eq("id", inventoryId)
        .eq("character_id", characterId);
      if (equipErr) throw equipErr;

      const { error: eventErr } = await svc
        .schema("mythic")
        .from("progression_events")
        .insert({
          campaign_id: campaignId,
          character_id: characterId,
          event_type: "gear_equipped",
          payload: {
            inventory_id: inventoryId,
            item_id: (row as { item?: { id?: string | null } | null }).item?.id ?? null,
            slot,
          },
        });
      if (eventErr) {
        ctx.log.warn("inventory_equip.event_write_failed", {
          request_id: ctx.requestId,
          inventory_id: inventoryId,
          code: eventErr.code,
          message: eventErr.message,
        });
      }

      return new Response(JSON.stringify({ ok: true, inventoryId, characterId, slot, requestId: ctx.requestId }), {
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
      ctx.log.error("inventory_equip.failed", { request_id: ctx.requestId, code: normalized.code, message: normalized.message });
      return new Response(JSON.stringify({ error: normalized.message || "Failed to equip item", code: normalized.code ?? "inventory_equip_failed", requestId: ctx.requestId }), {
        status: 500,
        headers: baseHeaders,
      });
    }
  },
};
