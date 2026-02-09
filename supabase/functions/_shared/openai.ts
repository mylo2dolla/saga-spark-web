const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const getOpenAIConfig = () => {
  const apiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  const baseUrl = Deno.env.get("OPENAI_BASE_URL") ?? DEFAULT_BASE_URL;
  const model = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
  return { apiKey, baseUrl, model };
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

export async function openAIChatCompletions(payload: Record<string, unknown>) {
  const { apiKey, baseUrl, model } = getOpenAIConfig();
  const { controller, timeout } = withTimeout(25_000);

  const finalPayload = {
    model,
    ...payload,
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(finalPayload),
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

export async function openAIChatCompletionsStream(payload: Record<string, unknown>) {
  const { apiKey, baseUrl, model } = getOpenAIConfig();
  const { controller, timeout } = withTimeout(25_000);

  const finalPayload = {
    model,
    ...payload,
  };

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(finalPayload),
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
