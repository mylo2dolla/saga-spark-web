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

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

const buildInvokeHeaders = (accessToken: string | null, headers?: EdgeHeaders) => ({
  ...(ANON_KEY ? { apikey: ANON_KEY } : {}),
  ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  ...(headers ?? {}),
});

const MAX_RESPONSE_SNIPPET = 2000;

const extractRequestId = (response?: Response | null, json?: unknown): string | null => {
  if (response) {
    const headerId =
      response.headers.get("x-request-id")
      ?? response.headers.get("x-correlation-id")
      ?? response.headers.get("x-vercel-id");
    if (headerId) return headerId;
  }
  if (json && typeof json === "object" && "requestId" in json) {
    const value = (json as { requestId?: string }).requestId;
    return value ?? null;
  }
  return null;
};

const readResponseBody = async (
  response?: Response | null
): Promise<{ text: string | null; json: unknown | null }> => {
  if (!response) return { text: null, json: null };
  let text: string | null = null;
  try {
    const raw = await response.clone().text();
    text = raw.slice(0, MAX_RESPONSE_SNIPPET);
  } catch {
    text = null;
  }
  if (!text) return { text, json: null };
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
};

const buildEdgeErrorMessage = (
  name: string,
  status: number,
  statusText: string | null,
  responseDetails: { text: string | null; json: unknown | null },
  fallback: string,
  requestId: string | null
) => {
  const json = responseDetails.json as
    | { message?: string; error?: string; details?: { message?: string } }
    | null;
  const message =
    json?.message
    ?? json?.error
    ?? json?.details?.message
    ?? responseDetails.text
    ?? fallback;
  const requestSuffix = requestId ? ` (requestId: ${requestId})` : "";
  const statusSuffix = statusText ? ` ${statusText}` : "";
  return `Edge function ${name} failed (${status}${statusSuffix}): ${message}${requestSuffix}`;
};

const logEdgeFailure = async (
  name: string,
  status: number,
  error: Error,
  response?: Response | null
) => {
  const responseDetails = await readResponseBody(response);
  const requestId = extractRequestId(response, responseDetails.json);
  console.error("[edge] invoke failed", {
    name,
    status,
    message: error.message,
    requestId,
    responseText: responseDetails.text,
    responseJson: responseDetails.json,
  });
};

export async function callEdgeFunction<T>(
  name: string,
  options?: EdgeOptions
): Promise<{ data: T | null; error: Error | null; status: number; raw: Response; skipped: boolean }> {
  ensureEnv();
  const { authError, accessToken } = await getAuthContext(options?.requireAuth);
  if (authError) {
    await logEdgeFailure(name, 401, authError, null);
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
    headers: buildInvokeHeaders(accessToken, options?.headers),
    method: options?.method ?? "POST",
  });

  if (error) {
    const errorContext = (error as { context?: Response }).context ?? null;
    const status = errorContext?.status ?? 500;
    const responseDetails = await readResponseBody(errorContext);
    const requestId = extractRequestId(errorContext, responseDetails.json);
    const message = buildEdgeErrorMessage(
      name,
      status,
      errorContext?.statusText ?? null,
      responseDetails,
      error.message,
      requestId
    );
    await logEdgeFailure(name, status, new Error(message), errorContext);
    return {
      data: null,
      error: new Error(message),
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
    if (authError) {
      await logEdgeFailure(name, 401, authError, null);
    }
    return new Response(null, { status: 401, statusText: "auth_required" });
  }
  const response = await fetch(buildUrl(name), {
    method: options?.method ?? "POST",
    headers,
    body: options?.body ? JSON.stringify(options.body) : undefined,
    signal: options?.signal,
  });
  if (!response.ok) {
    const responseDetails = await readResponseBody(response);
    const requestId = extractRequestId(response, responseDetails.json);
    const message = buildEdgeErrorMessage(
      name,
      response.status,
      response.statusText,
      responseDetails,
      "Edge function request failed",
      requestId
    );
    await logEdgeFailure(name, response.status, new Error(message), response);
    throw new Error(message);
  }
  return response;
}
