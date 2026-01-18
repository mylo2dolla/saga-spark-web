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

const buildHeaders = async (options?: EdgeOptions): Promise<EdgeHeaders> => {
  ensureEnv();
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? null;
  if (options?.requireAuth && !accessToken) {
    throw new Error("Authentication required");
  }
  return {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    ...(options?.headers ?? {}),
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
};

const buildUrl = (name: string) => {
  ensureEnv();
  return `${SUPABASE_URL}/functions/v1/${name}`;
};

export async function callEdgeFunction<T>(
  name: string,
  options?: EdgeOptions
): Promise<{ data: T | null; error: Error | null; status: number; raw: Response }> {
  const headers = await buildHeaders(options);
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
    return { data: null, error: new Error(message), status: response.status, raw: response };
  }

  if (!text) {
    return { data: null, error: null, status: response.status, raw: response };
  }

  try {
    const parsed = JSON.parse(text) as T;
    return { data: parsed, error: null, status: response.status, raw: response };
  } catch {
    return { data: null, error: new Error("Invalid JSON response"), status: response.status, raw: response };
  }
}

export async function callEdgeFunctionRaw(
  name: string,
  options?: EdgeRawOptions
): Promise<Response> {
  const headers = await buildHeaders(options);
  return fetch(buildUrl(name), {
    method: options?.method ?? "POST",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });
}
