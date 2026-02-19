import { z } from "zod";

import { AiProviderError, mythicOpenAIChatCompletions } from "../shared/ai_provider.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().max(4_000),
});

const RequestSchema = z.object({
  name: z.string().trim().max(120).optional(),
  messages: z.array(MessageSchema).min(1).max(50).optional(),
});

function respondJson(payload: unknown, requestId: string, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
    },
  });
}

export const dm: FunctionHandler = {
  name: "dm",
  auth: "optional",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    try {
      const parse = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parse.success) {
        return respondJson({
          error: "Invalid request",
          code: "invalid_request",
          details: parse.error.flatten(),
          requestId: ctx.requestId,
        }, ctx.requestId, 400);
      }

      const { name, messages } = parse.data;
      if ((!messages || messages.length === 0) && name) {
        return respondJson({ message: `Hello ${name}!` }, ctx.requestId, 200);
      }

      if (!messages || messages.length === 0) {
        return respondJson({
          error: "Provide either name or messages",
          code: "invalid_request",
          requestId: ctx.requestId,
        }, ctx.requestId, 400);
      }

      const system = {
        role: "system" as const,
        content:
          "You are an RPG dungeon master. Respond with concise immersive narration in plain text.",
      };
      const payload = {
        messages: [system, ...messages],
        temperature: 0.7,
      } satisfies Record<string, unknown>;

      const { data } = await mythicOpenAIChatCompletions(payload, "gpt-4o-mini");
      const rawContent = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
      return respondJson({ message: content }, ctx.requestId, 200);
    } catch (error) {
      if (error instanceof AiProviderError) {
        return respondJson({
          error: error.message,
          code: error.code,
          details: error.details,
          requestId: ctx.requestId,
        }, ctx.requestId, error.status);
      }
      const normalized = sanitizeError(error);
      return respondJson({
        error: normalized.message || "DM request failed",
        code: normalized.code ?? "dm_failed",
        requestId: ctx.requestId,
      }, ctx.requestId, 500);
    }
  },
};

