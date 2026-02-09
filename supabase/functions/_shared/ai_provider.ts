import { groqChatCompletions, groqChatCompletionsStream } from "./groq.ts";
import { openAIChatCompletions, openAIChatCompletionsStream } from "./openai.ts";

type ChatPayload = Record<string, unknown>;

type Provider = "openai" | "groq";

function resolveProvider(): Provider {
  const preferred = (Deno.env.get("LLM_PROVIDER") ?? "").toLowerCase();
  if (preferred === "openai" || preferred === "groq") return preferred as Provider;

  const hasOpenAI = Boolean(Deno.env.get("OPENAI_API_KEY"));
  const hasGroq = Boolean(Deno.env.get("GROQ_API_KEY"));
  if (hasOpenAI && hasGroq) return "openai";
  if (hasOpenAI) return "openai";
  if (hasGroq) return "groq";
  throw new Error("No LLM provider configured (OPENAI_API_KEY or GROQ_API_KEY required)");
}

export async function aiChatCompletions(payload: ChatPayload) {
  const provider = resolveProvider();
  if (provider === "openai") return await openAIChatCompletions(payload);
  return await groqChatCompletions(payload);
}

export async function aiChatCompletionsStream(payload: ChatPayload) {
  const provider = resolveProvider();
  if (provider === "openai") return await openAIChatCompletionsStream(payload);
  return await groqChatCompletionsStream(payload);
}
