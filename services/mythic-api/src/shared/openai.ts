const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const DEFAULT_OPENAI_CHAT_TIMEOUT_MS = 45_000;
const DEFAULT_OPENAI_TTS_TIMEOUT_MS = 30_000;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

const clampTimeoutMs = (value: string | null | undefined, fallback: number) => {
  const raw = (value ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  // Safety clamp: keep within reasonable runtimes.
  return Math.max(5_000, Math.min(120_000, Math.floor(parsed)));
};

function withTimeout(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeout };
}

async function readErrorSnippet(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return "";
  }
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return false;
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost");
}

function normalizeOpenAiBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("OPENAI_BASE_URL must be a valid absolute URL.");
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname === "/v1") {
    parsed.pathname = "/";
  } else if (pathname.endsWith("/v1")) {
    parsed.pathname = pathname.slice(0, -3) || "/";
  }

  return parsed.toString().replace(/\/+$/, "");
}

function openAiPath(baseUrl: string, path: "/v1/chat/completions" | "/v1/audio/speech"): string {
  return `${baseUrl}${path}`;
}

function getOpenAiConfig() {
  const rawBaseUrl = (process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL).trim() || DEFAULT_OPENAI_BASE_URL;
  const baseUrl = normalizeOpenAiBaseUrl(rawBaseUrl);
  const hostname = new URL(baseUrl).hostname;
  const localLoopback = isLoopbackHost(hostname);

  let apiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!apiKey && localLoopback) {
    // LM Studio and compatible local providers commonly ignore bearer validation.
    apiKey = "lm-studio";
  }
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for non-local OPENAI_BASE_URL hosts");
  }
  return { apiKey, baseUrl };
}

export async function openaiChatCompletions(
  payload: unknown,
  options: { timeoutMs?: number } = {},
) {
  const { apiKey, baseUrl } = getOpenAiConfig();
  const timeoutMs = clampTimeoutMs(
    options.timeoutMs === undefined ? process.env.OPENAI_CHAT_TIMEOUT_MS : String(options.timeoutMs),
    DEFAULT_OPENAI_CHAT_TIMEOUT_MS,
  );
  const { controller, timeout } = withTimeout(timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(openAiPath(baseUrl, "/v1/chat/completions"), {
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

export async function openaiChatCompletionsStream(
  payload: unknown,
  options: { timeoutMs?: number } = {},
) {
  const { apiKey, baseUrl } = getOpenAiConfig();
  const timeoutMs = clampTimeoutMs(
    options.timeoutMs === undefined ? process.env.OPENAI_CHAT_TIMEOUT_MS : String(options.timeoutMs),
    DEFAULT_OPENAI_CHAT_TIMEOUT_MS,
  );
  const { controller, timeout } = withTimeout(timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(openAiPath(baseUrl, "/v1/chat/completions"), {
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
  const { apiKey, baseUrl } = getOpenAiConfig();
  const timeoutMs = clampTimeoutMs(process.env.OPENAI_TTS_TIMEOUT_MS, DEFAULT_OPENAI_TTS_TIMEOUT_MS);
  const { controller, timeout } = withTimeout(timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(openAiPath(baseUrl, "/v1/audio/speech"), {
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
