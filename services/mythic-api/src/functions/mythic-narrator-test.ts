import { z } from "zod";

import { mythicOpenAIChatCompletions } from "../shared/ai_provider.js";
import { sanitizeError } from "../shared/redact.js";
import { getConfig } from "../shared/env.js";
import { generateProceduralNarration } from "../dm/proceduralNarrator/index.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const config = getConfig();

const RequestSchema = z.object({
  campaignSeed: z.string().trim().min(1).max(120).optional(),
  sessionId: z.string().trim().min(1).max(120).optional(),
  eventId: z.string().trim().min(1).max(120).optional(),
  boardType: z.string().trim().min(1).max(48).optional(),
  biome: z.string().trim().min(1).max(80).nullable().optional(),
  tone: z.string().trim().min(1).max(64).optional(),
  intensity: z.enum(["low", "med", "high"]).optional(),
  actionSummary: z.string().trim().min(1).max(240).optional(),
  recoveryBeat: z.string().trim().min(1).max(240).optional(),
  boardAnchor: z.string().trim().min(1).max(120).optional(),
  summaryObjective: z.string().trim().min(1).max(240).nullable().optional(),
  summaryRumor: z.string().trim().min(1).max(240).nullable().optional(),
  boardNarration: z.string().trim().min(1).max(360).optional(),
  introOpening: z.boolean().optional(),
  suppressNarrationOnError: z.boolean().optional(),
  executionError: z.string().trim().min(1).max(240).nullable().optional(),
  stateChanges: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
  events: z.array(z.record(z.unknown())).max(240).optional(),
  includeAi: z.boolean().optional(),
});

function aiTextFromCompletion(payload: unknown): string | null {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : null;
  const message = first?.message && typeof first.message === "object" ? first.message as Record<string, unknown> : null;
  const content = typeof message?.content === "string" ? message.content.trim() : "";
  return content.length > 0 ? content : null;
}

export const mythicNarratorTest: FunctionHandler = {
  name: "mythic-narrator-test",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    if (!config.allowDmNarratorQueryOverride) {
      return new Response(JSON.stringify({ error: "Narrator test is disabled in production.", code: "dev_only", requestId: ctx.requestId }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const raw = await req.json().catch(() => null);
      const parsed = RequestSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId: ctx.requestId }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const body = parsed.data;
      const procedural = generateProceduralNarration({
        campaignSeed: body.campaignSeed ?? "narrator-test-campaign",
        sessionId: body.sessionId ?? "narrator-test-session",
        eventId: body.eventId ?? "narrator-test-event",
        boardType: body.boardType ?? "combat",
        biome: body.biome ?? null,
        tone: body.tone ?? "tactical",
        intensity: body.intensity ?? "med",
        actionSummary: body.actionSummary ?? "Press the strongest tactical opening from current board pressure.",
        recoveryBeat: body.recoveryBeat ?? "Choose one concrete move and commit it now.",
        boardAnchor: body.boardAnchor ?? "the active board",
        summaryObjective: body.summaryObjective ?? null,
        summaryRumor: body.summaryRumor ?? null,
        boardNarration: body.boardNarration ?? "The board stays authoritative and pressure-forward.",
        introOpening: body.introOpening === true,
        suppressNarrationOnError: body.suppressNarrationOnError === true,
        executionError: body.executionError ?? null,
        stateChanges: body.stateChanges ?? [],
        events: body.events ?? [],
      });

      let ai: {
        text: string | null;
        model: string | null;
        provider: string | null;
        error: string | null;
      } | null = null;

      if (body.includeAi === true) {
        try {
          const promptPayload = {
            board_type: body.boardType ?? "combat",
            action_summary: body.actionSummary ?? "Press tactical lead",
            state_changes: body.stateChanges ?? [],
            events: body.events ?? [],
            objective: body.summaryObjective ?? null,
            rumor: body.summaryRumor ?? null,
          };
          const aiResult = await mythicOpenAIChatCompletions({
            messages: [
              {
                role: "system",
                content: [
                  "You are a dungeon master narrator for a tactical board game.",
                  "Return plain text only (no markdown), 45-90 words, one short paragraph.",
                  "Use concrete board language and avoid placeholders.",
                ].join(" "),
              },
              {
                role: "user",
                content: `Narrate this event payload:\n${JSON.stringify(promptPayload)}`,
              },
            ],
            temperature: 0.55,
          }, "gpt-4o-mini");
          ai = {
            text: aiTextFromCompletion(aiResult.data),
            model: aiResult.model ?? null,
            provider: aiResult.provider ?? null,
            error: null,
          };
        } catch (error) {
          ai = {
            text: null,
            model: null,
            provider: "openai",
            error: sanitizeError(error).message || "ai_generation_failed",
          };
        }
      }

      return new Response(
        JSON.stringify({
          ok: true,
          requestId: ctx.requestId,
          narrator_mode_env: config.dmNarratorMode,
          procedural: {
            text: procedural.text,
            template_id: procedural.templateId,
            debug: procedural.debug,
          },
          ai,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (error) {
      const normalized = sanitizeError(error);
      return new Response(
        JSON.stringify({
          error: normalized.message || "Narrator test failed",
          code: normalized.code ?? "narrator_test_failed",
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

