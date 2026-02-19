import { z } from "zod";

import { AiProviderError, mythicOpenAIChatCompletions } from "../shared/ai_provider.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  classDescription: z.string().trim().min(3).max(2_000),
});

const GeneratedClassSchema = z.object({
  className: z.string().min(1),
  description: z.string().min(1),
  stats: z.object({
    strength: z.number(),
    dexterity: z.number(),
    constitution: z.number(),
    intelligence: z.number(),
    wisdom: z.number(),
    charisma: z.number(),
  }),
  resources: z.object({
    mana: z.number(),
    maxMana: z.number(),
    rage: z.number(),
    maxRage: z.number(),
    stamina: z.number(),
    maxStamina: z.number(),
  }),
  passives: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      effect: z.string().min(1),
    }),
  ),
  abilities: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      abilityType: z.enum(["active", "passive", "reaction"]),
      damage: z.string().optional().nullable(),
      healing: z.string().optional().nullable(),
      range: z.number(),
      cost: z.number(),
      costType: z.string(),
      cooldown: z.number(),
      targetingType: z.enum(["self", "single", "tile", "area", "cone", "line"]),
      areaSize: z.number().optional().nullable(),
      effects: z.array(z.string()).optional().nullable(),
    }),
  ).min(1),
  hitDice: z.string().min(1),
  baseAC: z.number(),
});

const SYSTEM_PROMPT = `You are a fantasy RPG class designer. Given a text description of a character concept, generate a balanced class.

RULES:
1. Stats total between 70 and 80 points (each stat 8-18).
2. Generate 2-4 starting abilities suitable for level 1.
3. Generate 1-2 passives.
4. Ability ranges 1-6 tiles, costs 0-20, cooldowns 0-5.
5. Output only valid JSON.

Required JSON shape:
{
  "className": "string",
  "description": "string",
  "stats": {
    "strength": 10,
    "dexterity": 10,
    "constitution": 10,
    "intelligence": 10,
    "wisdom": 10,
    "charisma": 10
  },
  "resources": {
    "mana": 0,
    "maxMana": 0,
    "rage": 0,
    "maxRage": 0,
    "stamina": 100,
    "maxStamina": 100
  },
  "passives": [
    { "name": "string", "description": "string", "effect": "string" }
  ],
  "abilities": [
    {
      "name": "string",
      "description": "string",
      "abilityType": "active",
      "damage": "1d8+2",
      "healing": null,
      "range": 1,
      "cost": 10,
      "costType": "stamina",
      "cooldown": 0,
      "targetingType": "single",
      "areaSize": 1,
      "effects": ["bleed"]
    }
  ],
  "hitDice": "d10",
  "baseAC": 12
}`;

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function respondJson(payload: unknown, requestId: string, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
    },
  });
}

export const generateClass: FunctionHandler = {
  name: "generate-class",
  auth: "optional",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    try {
      const parse = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parse.success) {
        return respondJson({
          error: "Class description is required",
          code: "invalid_request",
          details: parse.error.flatten(),
          requestId: ctx.requestId,
        }, ctx.requestId, 400);
      }

      const payload = {
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Create a class from this concept: "${parse.data.classDescription}"`,
          },
        ],
        temperature: 0.8,
      } satisfies Record<string, unknown>;

      const { data, model } = await mythicOpenAIChatCompletions(payload, "gpt-4o-mini");
      const rawContent = (data as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : String(rawContent ?? "");
      const jsonCandidate = extractJsonCandidate(content);
      const parsedClass = GeneratedClassSchema.safeParse(JSON.parse(jsonCandidate));
      if (!parsedClass.success) {
        return respondJson({
          error: "Invalid class generation output",
          code: "invalid_generation_shape",
          details: parsedClass.error.flatten(),
          model,
          requestId: ctx.requestId,
        }, ctx.requestId, 502);
      }

      return respondJson(parsedClass.data, ctx.requestId, 200);
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
        error: normalized.message || "Failed to generate class",
        code: normalized.code ?? "generate_class_failed",
        requestId: ctx.requestId,
      }, ctx.requestId, 500);
    }
  },
};

