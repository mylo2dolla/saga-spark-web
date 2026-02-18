import { groqChatCompletions, groqChatCompletionsStream } from "./groq.js";
import { openaiChatCompletions, openaiChatCompletionsStream } from "./openai.js";

export type LlmProvider = "openai" | "groq";

export class AiProviderError extends Error {
  code: string;
  status: number;
  details: Record<string, unknown> | null;

  constructor(code: string, message: string, status = 500, details: Record<string, unknown> | null = null) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const errMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim().length > 0) return message;
  }
  return String(error);
};

const normalizeProvider = (value: string | null | undefined): LlmProvider | null => {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "openai") return "openai";
  if (v === "groq" || v === "grok") return "groq";
  return null;
};

export const resolveProvider = (): LlmProvider => {
  const explicit = normalizeProvider(process.env.LLM_PROVIDER);
  if (explicit) return explicit;
  if ((process.env.OPENAI_API_KEY ?? "").trim()) return "openai";
  if ((process.env.GROQ_API_KEY ?? "").trim()) return "groq";
  throw new Error("No LLM provider configured. Set OPENAI_API_KEY or GROQ_API_KEY.");
};

export const resolveModel = (defaults: { openai: string; groq: string }): string => {
  const provider = resolveProvider();
  const universal = (process.env.LLM_MODEL ?? "").trim();
  if (universal) return universal;
  if (provider === "openai") {
    return (process.env.OPENAI_MODEL ?? "").trim() || defaults.openai;
  }
  return (process.env.GROQ_MODEL ?? "").trim() || defaults.groq;
};

export async function aiChatCompletions(payload: unknown) {
  const provider = resolveProvider();
  if (provider === "openai") {
    return await openaiChatCompletions(payload);
  }
  return await groqChatCompletions(payload);
}

export async function aiChatCompletionsStream(payload: unknown) {
  const provider = resolveProvider();
  if (provider === "openai") {
    return await openaiChatCompletionsStream(payload);
  }
  return await groqChatCompletionsStream(payload);
}

function ensureOpenAiConfigured() {
  if ((process.env.OPENAI_API_KEY ?? "").trim().length > 0) return;
  throw new AiProviderError(
    "openai_not_configured",
    "OPENAI_API_KEY is not configured for Mythic runtime.",
    503,
  );
}

function resolveOpenAiModel(defaultModel: string): string {
  const universal = (process.env.LLM_MODEL ?? "").trim();
  if (universal) return universal;
  const explicit = (process.env.OPENAI_MODEL ?? "").trim();
  return explicit || defaultModel;
}

function withModel(payload: Record<string, unknown>, model: string): Record<string, unknown> {
  if (typeof payload.model === "string" && payload.model.trim().length > 0) return payload;
  return { ...payload, model };
}

export async function mythicOpenAIChatCompletions(
  payload: Record<string, unknown>,
  defaultModel = "gpt-4o-mini",
): Promise<{ data: unknown; provider: "openai"; model: string }> {
  ensureOpenAiConfigured();
  const model = resolveOpenAiModel(defaultModel);
  try {
    const data = await openaiChatCompletions(withModel(payload, model));
    return { data, provider: "openai", model };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(
      "openai_request_failed",
      `OpenAI request failed: ${errMessage(error)}`,
      502,
      { model },
    );
  }
}

export async function mythicOpenAIChatCompletionsStream(
  payload: Record<string, unknown>,
  defaultModel = "gpt-4o-mini",
): Promise<{ response: Response; provider: "openai"; model: string }> {
  ensureOpenAiConfigured();
  const model = resolveOpenAiModel(defaultModel);
  try {
    const response = await openaiChatCompletionsStream(withModel(payload, model));
    return { response, provider: "openai", model };
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError(
      "openai_request_failed",
      `OpenAI request failed: ${errMessage(error)}`,
      502,
      { model },
    );
  }
}

