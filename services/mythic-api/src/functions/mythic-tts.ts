import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { enforceRateLimit } from "../shared/request_guard.js";
import { openaiTextToSpeech } from "../shared/openai.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  messageId: z.string().min(1).max(120).optional(),
  text: z.string().min(1).max(2000),
  voice: z.string().min(1).max(40).optional(),
  format: z.enum(["mp3", "wav", "opus", "aac", "flac"]).optional(),
});

const resolveVoice = (value: string | undefined): string => {
  const raw = (value ?? "").trim().toLowerCase();
  // OpenAI voices (2024+): alloy, aria, verse, etc. Keep validation minimal but safe.
  if (!raw) return "alloy";
  if (!/^[a-z0-9_-]+$/.test(raw)) return "alloy";
  return raw;
};

const resolveModel = (): string => {
  const explicit = (process.env.OPENAI_TTS_MODEL ?? "").trim();
  return explicit.length > 0 ? explicit : "tts-1";
};

export const mythicTts: FunctionHandler = {
  name: "mythic-tts",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-tts",
      limit: 90,
      windowMs: 60_000,
      corsHeaders: {},
      requestId: ctx.requestId,
    });
    if (rateLimited) return rateLimited;

    try {
      const user = await requireUser(req.headers);

      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId: ctx.requestId }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { campaignId, text, voice, format } = parsed.data;
      const cleaned = text.trim();
      if (!cleaned) {
        return new Response(JSON.stringify({ error: "Text is empty", code: "invalid_request", requestId: ctx.requestId }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if ((process.env.OPENAI_API_KEY ?? "").trim().length === 0) {
        return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured for Mythic voice.", code: "openai_not_configured", requestId: ctx.requestId }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      const svc = createServiceClient();
      await assertCampaignAccess(svc, campaignId, user.userId);

      const model = resolveModel();
      const resolvedVoice = resolveVoice(voice);
      const resolvedFormat = format ?? "mp3";

      ctx.log.info("tts.request.start", {
        request_id: ctx.requestId,
        campaign_id: campaignId,
        user_id: user.userId,
        model,
        voice: resolvedVoice,
        format: resolvedFormat,
        chars: cleaned.length,
      });

      const response = await openaiTextToSpeech({
        model,
        voice: resolvedVoice,
        input: cleaned,
        format: resolvedFormat,
      });

      const contentType = response.headers.get("Content-Type")
        ?? (resolvedFormat === "mp3" ? "audio/mpeg" : "application/octet-stream");
      return new Response(response.body, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "x-request-id": ctx.requestId,
        },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        const code = error.code === "auth_required" ? "auth_required" : "auth_invalid";
        const message = code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code, requestId: ctx.requestId }), {
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
      ctx.log.error("tts.request.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      return new Response(
        JSON.stringify({
          error: normalized.message || "Failed to generate narration audio",
          code: normalized.code ?? "openai_request_failed",
          requestId: ctx.requestId,
        }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
