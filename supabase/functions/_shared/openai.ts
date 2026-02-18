const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const DEFAULT_OPENAI_CHAT_TIMEOUT_MS = 45_000;
const DEFAULT_OPENAI_TTS_TIMEOUT_MS = 30_000;

const clampTimeoutMs = (value: string | null, fallback: number) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  // Safety clamp: keep within reasonable edge runtimes.
  return Math.max(5_000, Math.min(120_000, Math.floor(parsed)));
};

const getOpenAIConfig = () => {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const baseUrl = Deno.env.get("OPENAI_BASE_URL") ?? DEFAULT_OPENAI_BASE_URL;
  return { apiKey, baseUrl };
};

const withTimeout = (timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
};

const readErrorSnippet = async (response: Response) => {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
};

export async function openaiChatCompletions(payload: unknown) {
  const { apiKey, baseUrl } = getOpenAIConfig();
  const timeoutMs = clampTimeoutMs(Deno.env.get("OPENAI_CHAT_TIMEOUT_MS"), DEFAULT_OPENAI_CHAT_TIMEOUT_MS);
  const { controller, timeout } = withTimeout(timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      throw new Error(`OpenAI error ${response.status}: ${snippet || "Request failed"}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function openaiChatCompletionsStream(payload: unknown) {
  const { apiKey, baseUrl } = getOpenAIConfig();
  const timeoutMs = clampTimeoutMs(Deno.env.get("OPENAI_CHAT_TIMEOUT_MS"), DEFAULT_OPENAI_CHAT_TIMEOUT_MS);
  const { controller, timeout } = withTimeout(timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`OpenAI request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      throw new Error(`OpenAI error ${response.status}: ${snippet || "Request failed"}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}

export async function openaiTextToSpeech(payload: {
  model: string;
  voice: string;
  input: string;
  format?: "mp3" | "wav" | "opus" | "aac" | "flac";
}) {
  const { apiKey, baseUrl } = getOpenAIConfig();
  const timeoutMs = clampTimeoutMs(Deno.env.get("OPENAI_TTS_TIMEOUT_MS"), DEFAULT_OPENAI_TTS_TIMEOUT_MS);
  const { controller, timeout } = withTimeout(timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`OpenAI TTS request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      throw new Error(`OpenAI TTS error ${response.status}: ${snippet || "Request failed"}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
