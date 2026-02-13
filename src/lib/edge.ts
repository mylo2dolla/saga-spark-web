import { supabase } from "@/integrations/supabase/client";

type EdgeHeaders = Record<string, string>;

interface EdgeOptions {
  body?: unknown;
  headers?: EdgeHeaders;
  method?: string;
  requireAuth?: boolean;
  accessToken?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
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
const DEFAULT_EDGE_TIMEOUT_MS = 20_000;
const AUTH_CALL_TIMEOUT_MS = 4_000;

const ensureEnv = () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Supabase env is not configured");
  }
};

const REFRESH_BUFFER_MS = 60_000;

const withAuthTimeout = async <T>(
  operation: () => Promise<T>,
  label: string,
  timeoutMs = AUTH_CALL_TIMEOUT_MS
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

type SessionLike = {
  access_token?: string | null;
  expires_at?: number | null;
};

const getStoredSession = (): SessionLike | null => {
  if (typeof window === "undefined" || !window.localStorage || !SUPABASE_URL) return null;
  const projectRef = SUPABASE_URL.replace("https://", "").split(".")[0];
  if (!projectRef) return null;
  const raw = window.localStorage.getItem(`sb-${projectRef}-auth-token`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as
      | { currentSession?: SessionLike | null }
      | SessionLike
      | null;
    const candidate = parsed && typeof parsed === "object" && "currentSession" in parsed
      ? parsed.currentSession
      : parsed;
    if (!candidate || typeof candidate !== "object") return null;
    return candidate.access_token ? candidate : null;
  } catch {
    return null;
  }
};

const getSessionSafe = async (): Promise<{ session: SessionLike | null; error: Error | null }> => {
  try {
    const { data: { session }, error } = await withAuthTimeout(
      () => supabase.auth.getSession(),
      "Auth session fetch",
    );
    if (error && !session) {
      const fallback = getStoredSession();
      if (fallback) return { session: fallback, error: null };
      return { session: null, error };
    }
    return { session: session ?? null, error: null };
  } catch (error) {
    const fallback = getStoredSession();
    if (fallback) return { session: fallback, error: null };
    return {
      session: null,
      error: error instanceof Error ? error : new Error("Auth session fetch failed"),
    };
  }
};

const refreshSessionSafe = async (): Promise<{ session: SessionLike | null; error: Error | null }> => {
  try {
    const { data, error } = await withAuthTimeout(
      () => supabase.auth.refreshSession(),
      "Auth session refresh",
    );
    if (error) {
      return { session: null, error };
    }
    return { session: data.session ?? null, error: null };
  } catch (error) {
    return {
      session: null,
      error: error instanceof Error ? error : new Error("Auth session refresh failed"),
    };
  }
};

const getAuthContext = async (requireAuth?: boolean): Promise<AuthContext> => {
  const { session: initialSession, error: sessionError } = await getSessionSafe();
  let activeSession = initialSession;
  if (sessionError && !activeSession?.access_token) {
    return { accessToken: null, authError: sessionError };
  }
  const expiresAt = activeSession?.expires_at ? activeSession.expires_at * 1000 : null;
  const shouldRefresh = Boolean(
    (requireAuth && !activeSession?.access_token)
      || (expiresAt && expiresAt - Date.now() < REFRESH_BUFFER_MS)
  );

  if (shouldRefresh) {
    const { session: refreshedSession, error: refreshError } = await refreshSessionSafe();
    if (refreshError) {
      if (!activeSession?.access_token) {
        return { accessToken: null, authError: refreshError };
      }
    } else if (refreshedSession?.access_token) {
      activeSession = refreshedSession;
    }
  }

  const accessToken = activeSession?.access_token ?? null;
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

const combineSignals = (a: AbortSignal, b: AbortSignal): AbortSignal => {
  const anyFn = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (anyFn) return anyFn([a, b]);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
};

const fetchWithTimeout = async (
  name: string,
  timeoutMs: number,
  input: string,
  init: RequestInit
): Promise<Response> => {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = init.signal
    ? combineSignals(init.signal, timeoutController.signal)
    : timeoutController.signal;

  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (timeoutController.signal.aborted) {
      throw new Error(`Edge function ${name} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildInvokeHeaders = (headers?: EdgeHeaders) => {
  if (!headers) return undefined;
  const normalized: EdgeHeaders = { ...headers };
  // supabase.functions.invoke already manages apikey/auth headers.
  delete normalized.Authorization;
  delete normalized.authorization;
  delete normalized.apikey;
  return normalized;
};

const MAX_RESPONSE_SNIPPET = 2000;

const hasHeaderGetter = (value: unknown): value is { headers: { get: (name: string) => string | null } } => {
  if (!value || typeof value !== "object") return false;
  const headers = (value as { headers?: unknown }).headers;
  return Boolean(headers && typeof (headers as { get?: unknown }).get === "function");
};

const extractRequestId = (response?: Response | null, json?: unknown): string | null => {
  if (response && hasHeaderGetter(response)) {
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
  if (!response || typeof (response as { clone?: unknown }).clone !== "function") {
    return { text: null, json: null };
  }
  let text: string | null = null;
  let raw: string | null = null;
  try {
    raw = await response.clone().text();
    text = raw.slice(0, MAX_RESPONSE_SNIPPET);
  } catch {
    text = null;
  }
  if (!raw) return { text, json: null };
  try {
    return { text, json: JSON.parse(raw) };
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
  const overrideToken = options?.accessToken ?? null;
  const baseAuth = overrideToken
    ? { authError: null as Error | null, accessToken: overrideToken }
    : await getAuthContext(options?.requireAuth);
  if (baseAuth.authError) {
    await logEdgeFailure(name, 401, baseAuth.authError, null);
    return {
      data: null,
      error: baseAuth.authError,
      status: 401,
      raw: new Response(null, { status: 401, statusText: "auth_required" }),
      skipped: true,
    };
  }

  const buildRequestHeaders = (token: string | null): EdgeHeaders => ({
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    ...(options?.headers ? buildInvokeHeaders(options.headers) ?? {} : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const runFetch = async (headers: EdgeHeaders): Promise<Response> =>
    fetchWithTimeout(name, options?.timeoutMs ?? DEFAULT_EDGE_TIMEOUT_MS, buildUrl(name), {
      method: options?.method ?? "POST",
      headers,
      body: options?.body ? JSON.stringify(options.body) : undefined,
      signal: options?.signal,
    });

  let response: Response;
  try {
    response = await runFetch(buildRequestHeaders(baseAuth.accessToken));
  } catch (error) {
    const edgeError = error instanceof Error ? error : new Error("Edge function request failed");
    await logEdgeFailure(name, 599, edgeError, null);
    return {
      data: null,
      error: edgeError,
      status: 599,
      raw: new Response(null, { status: 599, statusText: "edge_fetch_failed" }),
      skipped: false,
    };
  }
  let responseDetails = await readResponseBody(response);
  let requestId = extractRequestId(response, responseDetails.json);

  if (!response.ok) {
    const fallbackMessage = responseDetails.text ?? "Edge function request failed";
    const currentMessage = buildEdgeErrorMessage(
      name,
      response.status,
      response.statusText,
      responseDetails,
      fallbackMessage,
      requestId
    );
    const shouldRefresh = response.status === 401 || currentMessage.toLowerCase().includes("invalid jwt");
    if (shouldRefresh) {
      const { session: refreshedSession, error: refreshError } = await refreshSessionSafe();
      const refreshedToken = refreshedSession?.access_token ?? null;
      if (!refreshError && refreshedToken) {
        try {
          response = await runFetch(buildRequestHeaders(refreshedToken));
        } catch (error) {
          const edgeError = error instanceof Error ? error : new Error("Edge function request failed");
          await logEdgeFailure(name, 599, edgeError, null);
          return {
            data: null,
            error: edgeError,
            status: 599,
            raw: new Response(null, { status: 599, statusText: "edge_fetch_failed" }),
            skipped: false,
          };
        }
        responseDetails = await readResponseBody(response);
        requestId = extractRequestId(response, responseDetails.json);
      }
    }
  }

  if (!response.ok) {
    const fallbackMessage = responseDetails.text ?? "Edge function request failed";
    const message = buildEdgeErrorMessage(
      name,
      response.status,
      response.statusText,
      responseDetails,
      fallbackMessage,
      requestId
    );
    await logEdgeFailure(name, response.status, new Error(message), response);
    return {
      data: null,
      error: new Error(message),
      status: response.status,
      raw: response,
      skipped: false,
    };
  }

  const payload = responseDetails.json as T | null;
  if (payload) {
    return { data: payload, error: null, status: response.status, raw: response, skipped: false };
  }

  if (!responseDetails.text || responseDetails.text.trim().length === 0) {
    return { data: null, error: null, status: response.status, raw: response, skipped: false };
  }

  try {
    return {
      data: JSON.parse(responseDetails.text) as T,
      error: null,
      status: response.status,
      raw: response,
      skipped: false,
    };
  } catch (parseError) {
    const error = parseError instanceof Error ? parseError : new Error("Failed to parse edge response");
    await logEdgeFailure(name, response.status, error, response);
    return {
      data: null,
      error,
      status: response.status,
      raw: response,
      skipped: false,
    };
  }
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
  const response = await fetchWithTimeout(name, options?.timeoutMs ?? DEFAULT_EDGE_TIMEOUT_MS, buildUrl(name), {
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
