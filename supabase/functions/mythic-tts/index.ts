import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { createLogger } from "../_shared/logger.ts";
import { sanitizeError } from "../_shared/redact.ts";
import { enforceRateLimit } from "../_shared/request_guard.ts";
import { openaiTextToSpeech } from "../_shared/openai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-request-id",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  messageId: z.string().min(1).max(120).optional(),
  text: z.string().min(1).max(2000),
  voice: z.string().min(1).max(40).optional(),
  format: z.enum(["mp3", "wav", "opus", "aac", "flac"]).optional(),
});

const logger = createLogger("mythic-tts");

const requestIdFrom = (req: Request) =>
  req.headers.get("x-request-id")
  ?? req.headers.get("x-correlation-id")
  ?? req.headers.get("sb-request-id")
  ?? crypto.randomUUID();

const resolveVoice = (value: string | undefined): string => {
  const raw = (value ?? "").trim().toLowerCase();
  // OpenAI voices (2024+): alloy, aria, verse, etc. Keep validation minimal but safe.
  if (!raw) return "alloy";
  if (!/^[a-z0-9_-]+$/.test(raw)) return "alloy";
  return raw;
};

const resolveModel = (): string => {
  const explicit = (Deno.env.get("OPENAI_TTS_MODEL") ?? "").trim();
  return explicit.length > 0 ? explicit : "tts-1";
};

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
    route: "mythic-tts",
    limit: 90,
    windowMs: 60_000,
    corsHeaders,
  });
  if (rateLimited) return rateLimited;

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

    const { campaignId, text, voice, format } = parsed.data;
    const cleaned = text.trim();
    if (!cleaned) {
      return new Response(JSON.stringify({ error: "Text is empty", code: "invalid_request", requestId }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((Deno.env.get("OPENAI_API_KEY") ?? "").trim().length === 0) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured for Mythic voice.", code: "openai_not_configured", requestId }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    const model = resolveModel();
    const resolvedVoice = resolveVoice(voice);
    const resolvedFormat = format ?? "mp3";

    logger.info("tts.request.start", {
      request_id: requestId,
      campaign_id: campaignId,
      user_id: user.id,
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

    const contentType = response.headers.get("Content-Type") ?? (resolvedFormat === "mp3" ? "audio/mpeg" : "application/octet-stream");
    return new Response(response.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("tts.request.failed", error, { request_id: requestId });
    return new Response(
      JSON.stringify({
        error: normalized.message || "Failed to generate narration audio",
        code: normalized.code ?? "openai_request_failed",
        requestId,
      }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

