import { groqChatCompletions, groqChatCompletionsStream } from "./groq.ts";
import {
  isOpenAiRuntimeConfigured,
  openaiChatCompletions,
  openaiChatCompletionsStream,
} from "./openai.ts";

export type LlmProvider = "openai" | "groq";

const normalizeProvider = (value: string | null | undefined): LlmProvider | null => {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "openai") return "openai";
  if (v === "groq" || v === "grok") return "groq";
  return null;
};

export const resolveProvider = (): LlmProvider => {
  const explicit = normalizeProvider(Deno.env.get("LLM_PROVIDER"));
  if (explicit === "openai") {
    if (!isOpenAiRuntimeConfigured()) {
      throw new Error(
        "LLM_PROVIDER=openai is set, but OpenAI runtime is not configured. Set OPENAI_API_KEY for api.openai.com or set OPENAI_BASE_URL to a reachable OpenAI-compatible endpoint.",
      );
    }
    return "openai";
  }
  if (explicit === "groq") return "groq";

  if (isOpenAiRuntimeConfigured()) return "openai";
  if (Deno.env.get("GROQ_API_KEY")) return "groq";
  throw new Error(
    "No LLM provider configured. Set OPENAI_API_KEY (or OPENAI_BASE_URL for a local/Tailscale OpenAI-compatible endpoint) or GROQ_API_KEY.",
  );
};

export const resolveModel = (defaults: { openai: string; groq: string }): string => {
  const provider = resolveProvider();
  const universal = (Deno.env.get("LLM_MODEL") ?? "").trim();
  if (universal) return universal;
  if (provider === "openai") {
    return (Deno.env.get("OPENAI_MODEL") ?? "").trim() || defaults.openai;
  }
  return (Deno.env.get("GROQ_MODEL") ?? "").trim() || defaults.groq;
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
