import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aiChatCompletions, resolveModel } from "../_shared/ai_provider.ts";
import { assertContentAllowed } from "../_shared/content_policy.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  mode: z.enum(["random", "expand"]),
  fieldType: z.enum([
    "campaign_name",
    "campaign_description",
    "class_concept",
    "character_name",
    "dm_action",
    "npc_name",
    "quest_hook",
    "generic",
  ]),
  currentText: z.string().max(4000).optional(),
  campaignId: z.string().uuid().optional(),
  context: z.record(z.unknown()).optional(),
});

function fieldDirective(fieldType: z.infer<typeof RequestSchema>["fieldType"]): string {
  switch (fieldType) {
    case "campaign_name":
      return "Output a short campaign/world title (2-7 words), punchy and playable.";
    case "campaign_description":
      return "Output a concise world seed description (3-7 sentences) with setting, conflict, tone, and first hook.";
    case "class_concept":
      return "Output a vivid class concept paragraph with fantasy/comic flair and tactical identity.";
    case "character_name":
      return "Output one distinct character name, 1-3 words max.";
    case "dm_action":
      return "Output an actionable player command/message to DM (1-3 sentences), tactical and clear.";
    case "npc_name":
      return "Output one NPC name + 2-5 word epithet.";
    case "quest_hook":
      return "Output one compelling quest hook paragraph with stakes and immediate objective.";
    default:
      return "Output concise, useful text for this game field.";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

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

    const { mode, fieldType, currentText = "", campaignId, context = {} } = parsed.data;
    const svc = createClient(supabaseUrl, serviceRoleKey);

    let worldProfile: Record<string, unknown> = {};
    if (campaignId) {
      const { data: profile } = await svc
        .schema("mythic")
        .from("campaign_world_profiles")
        .select("seed_title, seed_description, template_key, world_profile_json")
        .eq("campaign_id", campaignId)
        .maybeSingle();
      if (profile) {
        worldProfile = {
          seed_title: profile.seed_title,
          seed_description: profile.seed_description,
          template_key: profile.template_key,
          world_profile_json: profile.world_profile_json,
        };
      }
    }

    const model = resolveModel({ openai: "gpt-4o-mini", groq: "llama-3.3-70b-versatile" });

    const directive = fieldDirective(fieldType);
    const modeRules = mode === "random"
      ? "If currentText is empty, generate from world/campaign context. If not empty, you may still use it as optional hint."
      : "Expand and refine currentText while preserving intent and theme. Add concrete details and tactical flavor.";

    const system = [
      "You generate concise game text for Mythic Weave.",
      "Violence/gore allowed. Sexual content and sexual violence forbidden.",
      "No markdown. Output plain text only.",
      "Keep output tight and actionable for player UX.",
    ].join("\n");

    const userPrompt = [
      `mode: ${mode}`,
      `fieldType: ${fieldType}`,
      directive,
      modeRules,
      `currentText: ${currentText || "<empty>"}`,
      `worldProfile: ${JSON.stringify(worldProfile)}`,
      `context: ${JSON.stringify(context)}`,
      "Return exactly one text value.",
    ].join("\n");

    const completion = await aiChatCompletions({
      model,
      temperature: mode === "random" ? 0.8 : 0.45,
      max_tokens: 350,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
    });

    const text = completion?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("No text generated");

    assertContentAllowed([{ path: "generated_text", value: text }]);

    return new Response(JSON.stringify({ ok: true, text }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-field-generate error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to generate text" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
