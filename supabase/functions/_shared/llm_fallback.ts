import { groqChatCompletions, groqChatCompletionsStream } from "./groq.ts";
import { openaiChatCompletions, openaiChatCompletionsStream } from "./openai.ts";

export type LlmProvider = "openai" | "groq";

export interface LlmModelDefaults {
  openai: string;
  groq: string;
}

export interface CompletionFallbackResult<T = unknown> {
  data: T;
  provider: LlmProvider;
  model: string;
  attempts: string[];
}

export interface StreamFallbackResult {
  response: Response;
  provider: LlmProvider;
  model: string;
  attempts: string[];
}

const normalizeProvider = (value: string | null | undefined): LlmProvider | null => {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "openai") return "openai";
  if (v === "groq" || v === "grok") return "groq";
  return null;
};

const hasProviderKey = (provider: LlmProvider): boolean => {
  if (provider === "openai") return Boolean((Deno.env.get("OPENAI_API_KEY") ?? "").trim());
  return Boolean((Deno.env.get("GROQ_API_KEY") ?? "").trim());
};

const resolveProviderOrder = (): LlmProvider[] => {
  const explicit = normalizeProvider(Deno.env.get("LLM_PROVIDER"));
  const providers: LlmProvider[] = [];

  if (explicit && hasProviderKey(explicit)) {
    providers.push(explicit);
  }

  for (const candidate of ["openai", "groq"] as const) {
    if (!hasProviderKey(candidate)) continue;
    if (providers.includes(candidate)) continue;
    providers.push(candidate);
  }

  return providers;
};

const resolveModelForProvider = (provider: LlmProvider, defaults: LlmModelDefaults): string => {
  const universal = (Deno.env.get("LLM_MODEL") ?? "").trim();
  if (universal) return universal;
  if (provider === "openai") {
    return (Deno.env.get("OPENAI_MODEL") ?? "").trim() || defaults.openai;
  }
  return (Deno.env.get("GROQ_MODEL") ?? "").trim() || defaults.groq;
};

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const value = (error as { message?: unknown }).message;
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return String(error);
};

const withModel = (payload: Record<string, unknown>, model: string): Record<string, unknown> => ({
  ...payload,
  model,
});

export async function aiChatCompletionsWithFallback(
  payload: Record<string, unknown>,
  defaults: LlmModelDefaults,
): Promise<CompletionFallbackResult> {
  const order = resolveProviderOrder();
  if (order.length === 0) {
    throw new Error("No LLM provider configured. Set OPENAI_API_KEY or GROQ_API_KEY.");
  }

  const attempts: string[] = [];
  for (const provider of order) {
    const model = resolveModelForProvider(provider, defaults);
    const requestPayload = withModel(payload, model);
    try {
      const data = provider === "openai"
        ? await openaiChatCompletions(requestPayload)
        : await groqChatCompletions(requestPayload);
      attempts.push(`${provider}:${model}:ok`);
      return { data, provider, model, attempts };
    } catch (error) {
      attempts.push(`${provider}:${model}:failed:${errorMessage(error)}`);
    }
  }

  throw new Error(`All LLM providers failed :: ${attempts.join(" || ")}`);
}

export async function aiChatCompletionsStreamWithFallback(
  payload: Record<string, unknown>,
  defaults: LlmModelDefaults,
): Promise<StreamFallbackResult> {
  const order = resolveProviderOrder();
  if (order.length === 0) {
    throw new Error("No LLM provider configured. Set OPENAI_API_KEY or GROQ_API_KEY.");
  }

  const attempts: string[] = [];
  for (const provider of order) {
    const model = resolveModelForProvider(provider, defaults);
    const requestPayload = withModel(payload, model);
    try {
      const response = provider === "openai"
        ? await openaiChatCompletionsStream(requestPayload)
        : await groqChatCompletionsStream(requestPayload);
      attempts.push(`${provider}:${model}:ok`);
      return { response, provider, model, attempts };
    } catch (error) {
      attempts.push(`${provider}:${model}:failed:${errorMessage(error)}`);
    }
  }

  throw new Error(`All LLM providers failed :: ${attempts.join(" || ")}`);
}
