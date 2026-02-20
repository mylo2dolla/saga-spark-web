import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { pickLootRarity, rollLootItem, type LootRarity, LOOT_RARITIES, rarityBudget } from "../shared/loot_roll.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  combatSessionId: z.string().uuid().optional(),
  characterId: z.string().uuid().optional(),
  count: z.number().int().min(1).max(8).default(1),
  source: z.string().max(40).default("combat"),
  rarity: z.enum(LOOT_RARITIES).optional(),
  seed: z.number().int().min(0).max(2_147_483_647).optional(),
});

const rowToInt = (v: unknown, fallback: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
};

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
        const itemRarity = rarity ?? pickLootRarity(baseSeed, `loot:rarity:${idx}`, level);
        return rollLootItem({
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

      const rarityUsed = ((insertedItems?.[0] as any)?.rarity ?? (generatedItems[0] as any)?.rarity ?? "common") as LootRarity;
      const budgetPoints = generatedItems.reduce((acc, item: any) => acc + rarityBudget(item.rarity as LootRarity), 0);
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
