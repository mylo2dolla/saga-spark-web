import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const UpsertSchema = z.object({
  action: z.literal("upsert"),
  campaignId: z.string().uuid(),
  saveName: z.string().trim().min(1).max(120),
  campaignSeed: z.unknown(),
  worldState: z.unknown(),
  gameState: z.unknown(),
  playerLevel: z.number().int().min(1).max(1000),
  totalXp: z.number().int().min(0).max(1_000_000_000),
  playtimeSeconds: z.number().int().min(0).max(1_000_000_000),
});

const UpdateSchema = z.object({
  action: z.literal("update"),
  saveId: z.string().uuid(),
  campaignSeed: z.unknown(),
  worldState: z.unknown(),
  gameState: z.unknown(),
  playerLevel: z.number().int().min(1).max(1000),
  totalXp: z.number().int().min(0).max(1_000_000_000),
  playtimeSeconds: z.number().int().min(0).max(1_000_000_000),
});

const DeleteSchema = z.object({
  action: z.literal("delete"),
  saveId: z.string().uuid(),
});

const RequestSchema = z.discriminatedUnion("action", [
  UpsertSchema,
  UpdateSchema,
  DeleteSchema,
]);

export const mythicGameSave: FunctionHandler = {
  name: "mythic-game-save",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    try {
      const user = await requireUser(req.headers);
      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "Invalid request",
            code: "invalid_request",
            details: parsed.error.flatten(),
            requestId: ctx.requestId,
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const svc = createServiceClient();
      const payload = parsed.data;

      if (payload.action === "upsert") {
        const { data, error } = await svc
          .from("game_saves")
          .upsert(
            {
              campaign_id: payload.campaignId,
              user_id: user.userId,
              save_name: payload.saveName,
              campaign_seed: payload.campaignSeed,
              world_state: payload.worldState,
              game_state: payload.gameState,
              player_level: payload.playerLevel,
              total_xp: payload.totalXp,
              playtime_seconds: payload.playtimeSeconds,
            },
            { onConflict: "campaign_id,user_id,save_name" },
          )
          .select("id")
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({
            ok: true,
            id: data.id,
            requestId: ctx.requestId,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (payload.action === "update") {
        const { error } = await svc
          .from("game_saves")
          .update({
            campaign_seed: payload.campaignSeed,
            world_state: payload.worldState,
            game_state: payload.gameState,
            player_level: payload.playerLevel,
            total_xp: payload.totalXp,
            playtime_seconds: payload.playtimeSeconds,
          })
          .eq("id", payload.saveId)
          .eq("user_id", user.userId);

        if (error) throw error;

        return new Response(
          JSON.stringify({
            ok: true,
            updated: true,
            requestId: ctx.requestId,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const { error } = await svc
        .from("game_saves")
        .delete()
        .eq("id", payload.saveId)
        .eq("user_id", user.userId);

      if (error) throw error;

      return new Response(
        JSON.stringify({
          ok: true,
          deleted: true,
          requestId: ctx.requestId,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      if (error instanceof AuthError) {
        const code = error.code === "auth_required" ? "auth_required" : "auth_invalid";
        return new Response(
          JSON.stringify({
            ok: false,
            error: error.message,
            code,
            requestId: ctx.requestId,
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const normalized = sanitizeError(error);
      ctx.log.error("game_save.failed", {
        request_id: ctx.requestId,
        code: normalized.code ?? "game_save_failed",
        error: normalized.message,
      });
      return new Response(
        JSON.stringify({
          ok: false,
          error: normalized.message || "Failed to mutate save",
          code: normalized.code ?? "game_save_failed",
          requestId: ctx.requestId,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};
