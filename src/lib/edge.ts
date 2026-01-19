import { supabase } from "@/integrations/supabase/client";

type EdgeHeaders = Record<string, string>;

interface EdgeOptions {
  body?: unknown;
  headers?: EdgeHeaders;
  method?: string;
  requireAuth?: boolean;
  signal?: AbortSignal;
}

interface EdgeRawOptions extends EdgeOptions {
  body?: unknown;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const ensureEnv = () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Supabase env is not configured");
  }
};

const buildHeaders = async (
  options?: EdgeOptions,
): Promise<{ headers: EdgeHeaders; skipped: boolean }> => {
  ensureEnv();
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? null;
  if (options?.requireAuth && !accessToken) {
    return {
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        ...(options?.headers ?? {}),
      },
      skipped: true,
    };
  }
  return {
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      ...(options?.headers ?? {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    skipped: false,
  };
};

const buildUrl = (name: string) => {
  ensureEnv();
  return `${SUPABASE_URL}/functions/v1/${name}`;
};

export async function callEdgeFunction<T>(
  name: string,
  options?: EdgeOptions
): Promise<{ data: T | null; error: Error | null; status: number; raw: Response; skipped: boolean }> {
  const { headers, skipped } = await buildHeaders(options);
  if (skipped) {
    return {
      data: null,
      error: null,
      status: 0,
      raw: new Response(null, { status: 0, statusText: "auth_skipped" }),
      skipped: true,
    };
  }
  const response = await fetch(buildUrl(name), {
    method: options?.method ?? "POST",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });

  const text = await response.text();
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      message = parsed.error || parsed.message || message;
    } catch {
      // ignore parse error
    }
    return { data: null, error: new Error(message), status: response.status, raw: response, skipped: false };
  }

  if (!text) {
    return { data: null, error: null, status: response.status, raw: response, skipped: false };
  }

  try {
    const parsed = JSON.parse(text) as T;
    return { data: parsed, error: null, status: response.status, raw: response, skipped: false };
  } catch {
    return { data: null, error: new Error("Invalid JSON response"), status: response.status, raw: response, skipped: false };
  }
}

export async function callEdgeFunctionRaw(
  name: string,
  options?: EdgeRawOptions
): Promise<Response> {
  const { headers, skipped } = await buildHeaders(options);
  if (skipped) {
    return new Response(null, { status: 0, statusText: "auth_skipped" });
  }
  return fetch(buildUrl(name), {
    method: options?.method ?? "POST",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });
}
