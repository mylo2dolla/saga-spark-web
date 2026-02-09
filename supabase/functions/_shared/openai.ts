const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";

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
  const { controller, timeout } = withTimeout(25_000);

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

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
  const { controller, timeout } = withTimeout(25_000);

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const snippet = await readErrorSnippet(response);
      throw new Error(`OpenAI error ${response.status}: ${snippet || "Request failed"}`);
    }

    return response;
  } finally {
    clearTimeout(timeout);
  }
}
