const DEFAULT_GROQ_BASE_URL = "https://api.groq.com/openai";
const DEFAULT_TIMEOUT_MS = 25_000;

const normalizeGroqBaseUrl = (raw: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("GROQ_BASE_URL must be a valid absolute URL");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
};

const buildGroqEndpointUrl = (baseUrl: string, endpointPath: string): string => {
  const parsed = new URL(baseUrl);
  const rawPath = parsed.pathname.replace(/\/+$/, "");
  const versionedBasePath = rawPath.endsWith("/v1") ? rawPath : `${rawPath || ""}/v1`;
  const normalizedBasePath = versionedBasePath.startsWith("/") ? versionedBasePath : `/${versionedBasePath}`;
  const normalizedEndpoint = endpointPath.replace(/^\/+/, "");
  parsed.pathname = `${normalizedBasePath}/${normalizedEndpoint}`.replace(/\/{2,}/g, "/");
  return parsed.toString();
};

const getGroqConfig = () => {
  const apiKey = (Deno.env.get("GROQ_API_KEY") ?? "").trim();
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not configured");
  }
  const rawBaseUrl = (Deno.env.get("GROQ_BASE_URL") ?? DEFAULT_GROQ_BASE_URL).trim() || DEFAULT_GROQ_BASE_URL;
  return { apiKey, baseUrl: normalizeGroqBaseUrl(rawBaseUrl) };
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

const requestGroq = async (payload: unknown): Promise<Response> => {
  const { apiKey, baseUrl } = getGroqConfig();
  const { controller, timeout } = withTimeout(DEFAULT_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(buildGroqEndpointUrl(baseUrl, "chat/completions"), {
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
        throw new Error(`Groq request timed out after ${DEFAULT_TIMEOUT_MS}ms`);
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
};

export async function groqChatCompletions(payload: unknown) {
  const response = await requestGroq(payload);
  return await response.json();
}

export async function groqChatCompletionsStream(payload: unknown) {
  return await requestGroq(payload);
}
