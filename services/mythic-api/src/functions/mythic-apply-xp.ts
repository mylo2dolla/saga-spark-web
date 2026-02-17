import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid().optional(),
  amount: z.number().int().min(1).max(500000),
  reason: z.string().max(120).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const mythicApplyXp: FunctionHandler = {
  name: "mythic-apply-xp",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    try {
      const user = await requireUser(req.headers);
      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { campaignId, characterId, amount, reason, metadata } = parsed.data;
      const svc = createServiceClient();

      const access = await assertCampaignAccess(svc, campaignId, user.userId);

      const charQuery = svc
        .schema("mythic")
        .from("characters")
        .select("id, campaign_id, player_id")
        .eq("campaign_id", campaignId)
        .eq(characterId ? "id" : "player_id", characterId ?? user.userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: character, error: charErr } = await charQuery;
      if (charErr) throw charErr;
      if (!character) {
        return new Response(JSON.stringify({ error: "Character not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const canManageAny = access.isDm;
      if (!canManageAny && character.player_id !== user.userId) {
        return new Response(JSON.stringify({ error: "You can only apply XP to your own character" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data: result, error: xpErr } = await svc
        .rpc("mythic_apply_xp", {
          character_id: character.id,
          amount,
          reason: reason ?? "manual",
          metadata: metadata ?? {},
        });
      if (xpErr) throw xpErr;

      return new Response(JSON.stringify({ ok: true, result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        const message = error.code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId: ctx.requestId }), {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("apply_xp.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      return new Response(JSON.stringify({ error: normalized.message || "Failed to apply XP", code: normalized.code ?? "apply_xp_failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
