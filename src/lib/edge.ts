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

interface AuthContext {
  accessToken: string | null;
  authError: Error | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const ensureEnv = () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Supabase env is not configured");
  }
};

const getAuthContext = async (requireAuth?: boolean): Promise<AuthContext> => {
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? null;
  if (requireAuth && !accessToken) {
    return {
      accessToken: null,
      authError: new Error("You must be signed in to continue."),
    };
  }
  return { accessToken, authError: null };
};

const buildHeaders = async (
  options?: EdgeOptions,
): Promise<{ headers: EdgeHeaders; skipped: boolean; authError: Error | null }> => {
  ensureEnv();
  const { accessToken, authError } = await getAuthContext(options?.requireAuth);
  if (authError) {
    return {
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
        ...(options?.headers ?? {}),
      },
      skipped: true,
      authError,
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
    authError: null,
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
  ensureEnv();
  const { authError } = await getAuthContext(options?.requireAuth);
  if (authError) {
    return {
      data: null,
      error: authError,
      status: 401,
      raw: new Response(null, { status: 401, statusText: "auth_required" }),
      skipped: true,
    };
  }

  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: options?.body,
    headers: options?.headers,
    method: options?.method ?? "POST",
  });

  if (error) {
    const errorContext = (error as { context?: Response }).context ?? null;
    const status = errorContext?.status ?? 500;
    return {
      data: null,
      error: new Error(error.message),
      status,
      raw: errorContext ?? new Response(null, { status }),
      skipped: false,
    };
  }

  return {
    data: data ?? null,
    error: null,
    status: 200,
    raw: new Response(data ? JSON.stringify(data) : null, {
      status: 200,
      headers: data ? { "Content-Type": "application/json" } : undefined,
    }),
    skipped: false,
  };
}

export async function callEdgeFunctionRaw(
  name: string,
  options?: EdgeRawOptions
): Promise<Response> {
  const { headers, skipped, authError } = await buildHeaders(options);
  if (skipped || authError) {
    return new Response(null, { status: 401, statusText: "auth_required" });
  }
  return fetch(buildUrl(name), {
    method: options?.method ?? "POST",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });
}
