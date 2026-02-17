const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai";
const DEFAULT_GROQ_TIMEOUT_MS = 25_000;

function getGroqConfig() {
  const apiKey = (process.env.GROQ_API_KEY ?? "").trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }
  const baseUrl = (process.env.GROQ_BASE_URL ?? DEFAULT_GROQ_BASE_URL).trim() || DEFAULT_GROQ_BASE_URL;
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, "") };
}

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

function resolveTimeoutMs() {
  const parsed = Number(process.env.GROQ_TIMEOUT_MS ?? "");
  if (!Number.isFinite(parsed)) return DEFAULT_GROQ_TIMEOUT_MS;
  return Math.max(5_000, Math.min(120_000, Math.floor(parsed)));
}

export async function groqChatCompletions(payload: unknown) {
  const { apiKey, baseUrl } = getGroqConfig();
  const timeoutMs = resolveTimeoutMs();
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
        throw new Error(`Groq request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      throw new Error(`Groq error ${response.status}: ${snippet || "Request failed"}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function groqChatCompletionsStream(payload: unknown) {
  const { apiKey, baseUrl } = getGroqConfig();
  const timeoutMs = resolveTimeoutMs();
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
        throw new Error(`Groq request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      throw new Error(`Groq error ${response.status}: ${snippet || "Request failed"}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
