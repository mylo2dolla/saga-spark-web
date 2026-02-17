import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid().optional(),
  name: z.string().min(1).max(60).default("Default"),
  skillIds: z.array(z.string().uuid()).max(20),
  activate: z.boolean().default(true),
});

export const mythicSetLoadout: FunctionHandler = {
  name: "mythic-set-loadout",
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

      const { campaignId, characterId, name, activate } = parsed.data;
      const uniqueSkillIds = Array.from(new Set(parsed.data.skillIds));

      const svc = createServiceClient();
      const access = await assertCampaignAccess(svc, campaignId, user.userId);

      const charQuery = svc
        .schema("mythic")
        .from("characters")
        .select("id,campaign_id,player_id,level")
        .eq("campaign_id", campaignId)
        .eq(characterId ? "id" : "player_id", characterId ?? user.userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: character, error: charError } = await charQuery;
      if (charError) throw charError;
      if (!character) {
        return new Response(JSON.stringify({ error: "Character not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!access.isDm && character.player_id !== user.userId) {
        return new Response(JSON.stringify({ error: "Not authorized for this character" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data: slotsAllowed, error: slotsErr } = await svc
        .rpc("mythic_loadout_slots_for_level", { lvl: character.level });
      if (slotsErr) throw slotsErr;

      const slotCap = Math.max(1, Number(slotsAllowed ?? 2));
      const selected = uniqueSkillIds.slice(0, slotCap);

      if (selected.length > 0) {
        const { data: validSkills, error: skillErr } = await svc
          .schema("mythic")
          .from("skills")
          .select("id,kind")
          .eq("character_id", character.id)
          .in("id", selected)
          .in("kind", ["active", "ultimate"]);
        if (skillErr) throw skillErr;

        const validSet = new Set((validSkills ?? []).map((s) => s.id));
        const invalid = selected.filter((id) => !validSet.has(id));
        if (invalid.length > 0) {
          return new Response(JSON.stringify({ error: "Invalid skills for this character", invalid }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      const now = new Date().toISOString();

      const { data: existing } = await svc
        .schema("mythic")
        .from("character_loadouts")
        .select("id")
        .eq("character_id", character.id)
        .eq("name", name)
        .maybeSingle();

      let loadoutId: string;
      if (existing?.id) {
        const { error: updErr } = await svc
          .schema("mythic")
          .from("character_loadouts")
          .update({ slots_json: selected, is_active: activate, updated_at: now })
          .eq("id", existing.id)
          .eq("character_id", character.id);
        if (updErr) throw updErr;
        loadoutId = existing.id;
      } else {
        const { data: ins, error: insErr } = await svc
          .schema("mythic")
          .from("character_loadouts")
          .insert({
            character_id: character.id,
            campaign_id: campaignId,
            name,
            is_active: activate,
            slots_json: selected,
          })
          .select("id")
          .single();
        if (insErr) throw insErr;
        loadoutId = ins.id;
      }

      if (activate) {
        await svc
          .schema("mythic")
          .from("character_loadouts")
          .update({ is_active: false, updated_at: now })
          .eq("character_id", character.id)
          .neq("id", loadoutId);
        await svc
          .schema("mythic")
          .from("character_loadouts")
          .update({ is_active: true, updated_at: now })
          .eq("id", loadoutId);
      }

      await svc
        .schema("mythic")
        .from("progression_events")
        .insert({
          campaign_id: campaignId,
          character_id: character.id,
          event_type: "loadout_changed",
          payload: {
            loadout_id: loadoutId,
            name,
            activated: activate,
            slots: selected,
            slot_cap: slotCap,
          },
        });

      return new Response(JSON.stringify({
        ok: true,
        loadout_id: loadoutId,
        slots: selected,
        slot_cap: slotCap,
        truncated: uniqueSkillIds.length > selected.length,
      }), {
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
      ctx.log.error("set_loadout.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      return new Response(JSON.stringify({ error: normalized.message || "Failed to set loadout", code: normalized.code ?? "set_loadout_failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
