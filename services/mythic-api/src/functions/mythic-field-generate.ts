import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { mythicOpenAIChatCompletions } from "../shared/ai_provider.js";
import { assertContentAllowed } from "../shared/content_policy.js";
import { enforceRateLimit } from "../shared/request_guard.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

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

const CLASS_CONCEPT_TARGET_MIN_CHARS = 220;
const CLASS_CONCEPT_TARGET_MAX_CHARS = 420;

function fieldDirective(fieldType: z.infer<typeof RequestSchema>["fieldType"]): string {
  switch (fieldType) {
    case "campaign_name":
      return "Output a short campaign/world title (2-7 words), punchy and playable.";
    case "campaign_description":
      return "Output a concise world seed description (3-7 sentences) with setting, conflict, tone, and first hook.";
    case "class_concept":
      return "Output exactly 2-3 sentences (220-420 chars) defining archetype identity, tactical loop, and explicit weakness/cost with fantasy/comic flair.";
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

function maxLengthForField(fieldType: z.infer<typeof RequestSchema>["fieldType"]): number {
  switch (fieldType) {
    case "campaign_name":
      return 80;
    case "campaign_description":
      return 2000;
    case "class_concept":
      return CLASS_CONCEPT_TARGET_MAX_CHARS;
    case "character_name":
      return 60;
    case "dm_action":
      return 1000;
    case "npc_name":
      return 120;
    case "quest_hook":
      return 1200;
    default:
      return 2000;
  }
}

const trimTo = (text: string, max: number) => (text.length > max ? text.slice(0, max).trimEnd() : text);

function compactSentence(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim().replace(/[.!?]+$/g, "");
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max).replace(/\s+\S*$/g, "").trim();
}

function titleSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 1).toUpperCase() + trimmed.slice(1);
}

function lowerSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 1).toLowerCase() + trimmed.slice(1);
}

function condenseClassConceptText(input: string): string {
  const cleaned = input.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return trimTo(cleaned, CLASS_CONCEPT_TARGET_MAX_CHARS);
}

function deterministicFieldText(input: {
  mode: "random" | "expand";
  fieldType: z.infer<typeof RequestSchema>["fieldType"];
  currentText: string;
  worldProfile: Record<string, unknown>;
}): string {
  const worldTitle = String(input.worldProfile.seed_title ?? "").trim();
  const worldDescription = String(input.worldProfile.seed_description ?? "").trim();
  const template = String(input.worldProfile.template_key ?? "custom").trim();
  const seedBasis = `${worldTitle}|${worldDescription}|${template}|${input.currentText}|${input.fieldType}|${input.mode}`.toLowerCase();

  const pick = <T,>(arr: T[], offset: number): T => {
    let hash = 0;
    for (let i = 0; i < seedBasis.length; i += 1) hash = (hash * 31 + seedBasis.charCodeAt(i) + offset) >>> 0;
    return arr[hash % arr.length]!;
  };

  if (input.mode === "expand" && input.currentText.trim().length > 0) {
    if (input.fieldType === "class_concept") {
      const expanded = input.currentText.trim().length > CLASS_CONCEPT_TARGET_MAX_CHARS
        ? condenseClassConceptText(input.currentText)
        : `${input.currentText.trim()} Lock in one explicit resource cost, one risk window, and one finisher condition tied to positioning.`;
      return trimTo(condenseClassConceptText(expanded), CLASS_CONCEPT_TARGET_MAX_CHARS);
    }
    const suffix = pick([
      "Add pressure points, rival factions, and one immediate objective.",
      "Add one concrete risk, one tactical opportunity, and one compelling hook.",
      "Add environmental detail, stakes, and an actionable first move.",
      "Add conflict escalation and a clear short-term win condition.",
    ], 17);
    return `${input.currentText.trim()} ${suffix}`.trim();
  }

  const theme = worldTitle || pick(["Iron Wastes", "Moonlit Ruins", "Fracture City", "Ashwild Frontier"], 3);
  const premise = worldDescription || pick([
    "Power blocs carve up the map while survivors trade blood for breathing room.",
    "Ancient engines are waking up and every faction wants the core keys.",
    "Stormfront anomalies keep mutating the battlefield and nobody controls the fallout.",
    "The old order collapsed and now brutal city-states weaponize relic tech.",
  ], 5);

  switch (input.fieldType) {
    case "campaign_name":
      return pick(
        [
          `${theme} Uprising`,
          `${theme} Blackout`,
          `${theme} Reckoning`,
          `${theme} Aftermath`,
          `${theme} Siege`,
        ],
        11,
      );
    case "campaign_description":
      return `${premise} Start in ${theme} and secure a foothold before the first strike force arrives.`;
    case "class_concept":
      return trimTo(
        `A ruthless class forged in ${theme} that controls tempo through violent repositioning and burst windows. Core loop: mark weak angles, force movement, then cash out with short-cooldown finishers before enemies stabilize. Cost: every high-output sequence exposes you to punish if your setup is interrupted.`,
        CLASS_CONCEPT_TARGET_MAX_CHARS,
      );
    case "character_name":
      return pick(["Kael Voss", "Nyx Calder", "Ira Stone", "Mara Hex", "Jax Riven"], 19);
    case "dm_action":
      return `I scout the nearest threat route, mark priority targets, and set up a hard engage from cover before we commit.`;
    case "npc_name":
      return pick(["Vera Lockjaw", "Tamsin Gravewire", "Rook Emberline", "Nox Gallow", "Silas Thorn"], 23);
    case "quest_hook":
      return `A convoy carrying reactor cores vanished outside ${theme}. Track the raiders, recover at least one core intact, and decide whether to return it to the council or sell it to the highest bidder before nightfall.`;
    default:
      return `${premise} ${theme} is unstable, dangerous, and worth fighting over.`;
  }
}

export const mythicFieldGenerate: FunctionHandler = {
  name: "mythic-field-generate",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-field-generate",
      limit: 60,
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

      const { mode, fieldType, currentText = "", campaignId, context = {} } = parsed.data;
      const svc = createServiceClient();

      let worldProfile: Record<string, unknown> = {};
      if (campaignId) {
        await assertCampaignAccess(svc, campaignId, user.userId);
        const primary = await svc
          .schema("mythic")
          .from("world_profiles")
          .select("seed_title, seed_description, template_key, world_profile_json")
          .eq("campaign_id", campaignId)
          .maybeSingle();

        let profile = primary.data;
        if (primary.error) {
          const fallback = await svc
            .schema("mythic")
            .from("campaign_world_profiles")
            .select("seed_title, seed_description, template_key, world_profile_json")
            .eq("campaign_id", campaignId)
            .maybeSingle();
          profile = fallback.data;
        }

        if (profile) {
          worldProfile = {
            seed_title: profile.seed_title,
            seed_description: profile.seed_description,
            template_key: profile.template_key,
            world_profile_json: profile.world_profile_json,
          };
        }
      }

      const directive = fieldDirective(fieldType);
      const isClassConcept = fieldType === "class_concept";
      const modeRules = isClassConcept
        ? mode === "random"
          ? "Generate exactly 2-3 sentences within 220-420 chars. Include archetype identity, tactical loop, and explicit weakness/cost."
          : "Expand and refine currentText into exactly 2-3 sentences within 220-420 chars. Must include tactical loop and explicit weakness/cost."
        : mode === "random"
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

      let text = "";
      let source: "llm" | "deterministic_fallback" = "llm";
      const maxTokens = isClassConcept ? 170 : 350;
      const completion = await mythicOpenAIChatCompletions(
        {
          temperature: mode === "random" ? 0.8 : 0.45,
          max_tokens: maxTokens,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt },
          ],
        },
        "gpt-4o-mini",
      );
      const completionData = completion.data as { choices?: Array<{ message?: { content?: string } }> };
      text = String(completionData?.choices?.[0]?.message?.content ?? "").trim();
      if (!text) {
        ctx.log.warn("field_generate.empty_llm_output", { request_id: ctx.requestId, field_type: fieldType, mode });
        source = "deterministic_fallback";
        text = deterministicFieldText({
          mode,
          fieldType,
          currentText,
          worldProfile,
        });
      }

      const fieldMax = maxLengthForField(fieldType);
      const normalizedText = isClassConcept
        ? condenseClassConceptText(text)
        : text;
      const finalText = trimTo(normalizedText, fieldMax);

      assertContentAllowed([{ path: "generated_text", value: finalText }]);

      return new Response(JSON.stringify({
        ok: true,
        text: finalText,
        source,
        provider: completion.provider,
        model: completion.model,
        requestId: ctx.requestId,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
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
      ctx.log.error("field_generate.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      const code = normalized.code ?? "field_generate_failed";
      const status = code === "openai_not_configured" ? 503 : code === "openai_request_failed" ? 502 : 500;
      return new Response(JSON.stringify({ error: normalized.message || "Failed to generate text", code, requestId: ctx.requestId }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
