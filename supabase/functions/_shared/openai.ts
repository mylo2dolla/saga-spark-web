const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const DEFAULT_TIMEOUT_MS = 25_000;
const OPENAI_DEFAULT_HOST = "api.openai.com";

const OPENAI_BASE_URL_ENV_KEYS = [
  "OPENAI_BASE_URL",
  "TAILSCALE_OPENAI_BASE_URL",
  "TAILSCALE_AI_BASE_URL",
  "LLM_BASE_URL",
] as const;

const OPENAI_API_KEY_ENV_KEYS = [
  "OPENAI_API_KEY",
  "TAILSCALE_OPENAI_API_KEY",
  "LLM_API_KEY",
] as const;

const readFirstSet = (keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = (Deno.env.get(key) ?? "").trim();
    if (value.length > 0) return value;
  }
  return null;
};

const normalizeOpenAiBaseUrl = (raw: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("OPENAI_BASE_URL must be a valid absolute URL");
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
};

const buildOpenAiEndpointUrl = (baseUrl: string, endpointPath: string): string => {
  const parsed = new URL(baseUrl);
  const rawPath = parsed.pathname.replace(/\/+$/, "");
  const versionedBasePath = rawPath.endsWith("/v1") ? rawPath : `${rawPath || ""}/v1`;
  const normalizedBasePath = versionedBasePath.startsWith("/") ? versionedBasePath : `/${versionedBasePath}`;
  const normalizedEndpoint = endpointPath.replace(/^\/+/, "");
  parsed.pathname = `${normalizedBasePath}/${normalizedEndpoint}`.replace(/\/{2,}/g, "/");
  return parsed.toString();
};

export interface OpenAiRuntimeConfig {
  apiKey: string | null;
  baseUrl: string;
  requiresApiKey: boolean;
}

export function resolveOpenAiRuntimeConfig(): OpenAiRuntimeConfig {
  const rawBaseUrl = readFirstSet(OPENAI_BASE_URL_ENV_KEYS) ?? DEFAULT_OPENAI_BASE_URL;
  const baseUrl = normalizeOpenAiBaseUrl(rawBaseUrl);
  const apiKey = readFirstSet(OPENAI_API_KEY_ENV_KEYS);
  const host = new URL(baseUrl).hostname.toLowerCase();
  const requiresApiKey = host === OPENAI_DEFAULT_HOST;
  return { apiKey, baseUrl, requiresApiKey };
}

export function isOpenAiRuntimeConfigured(): boolean {
  try {
    const config = resolveOpenAiRuntimeConfig();
    return !config.requiresApiKey || Boolean(config.apiKey);
  } catch {
    return false;
  }
}

const getOpenAIConfig = (): OpenAiRuntimeConfig => {
  const config = resolveOpenAiRuntimeConfig();
  if (config.requiresApiKey && !config.apiKey) {
    throw new Error("OPENAI_API_KEY is not configured for api.openai.com");
  }
  return config;
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

const buildRequestHeaders = (apiKey: string | null): Record<string, string> => ({
  "Content-Type": "application/json",
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
});

const requestOpenAi = async (
  endpointPath: string,
  payload: unknown,
  timeoutMs: number,
  timeoutLabel: string,
  errorLabel: string,
): Promise<Response> => {
  const { apiKey, baseUrl } = getOpenAIConfig();
  const { controller, timeout } = withTimeout(timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(buildOpenAiEndpointUrl(baseUrl, endpointPath), {
        method: "POST",
        headers: buildRequestHeaders(apiKey),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`${timeoutLabel} timed out after ${timeoutMs}ms`);
      }
      throw error;
    }

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      throw new Error(`${errorLabel} ${response.status}: ${snippet || "Request failed"}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
};

export async function openaiChatCompletions(payload: unknown) {
  const response = await requestOpenAi(
    "chat/completions",
    payload,
    DEFAULT_TIMEOUT_MS,
    "OpenAI request",
    "OpenAI error",
  );
  return await response.json();
}

export async function openaiChatCompletionsStream(payload: unknown) {
  return await requestOpenAi(
    "chat/completions",
    payload,
    DEFAULT_TIMEOUT_MS,
    "OpenAI request",
    "OpenAI error",
  );
}
