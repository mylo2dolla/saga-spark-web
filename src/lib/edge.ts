import { supabase } from "@/integrations/supabase/client";
import { createLogger } from "@/lib/observability/logger";
import { recordHealthFailure, recordHealthSuccess } from "@/lib/observability/health";
import { recordEdgeCall, recordEdgeResponse } from "@/ui/data/networkHealth";

type EdgeHeaders = Record<string, string>;

interface EdgeOptions {
  body?: unknown;
  headers?: EdgeHeaders;
  method?: string;
  requireAuth?: boolean;
  accessToken?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  idempotencyKey?: string;
}

interface EdgeRawOptions extends EdgeOptions {
  body?: unknown;
}

export class EdgeFunctionError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly details: unknown;
  readonly route: string;

  constructor(args: {
    route: string;
    status: number;
    message: string;
    code?: string | null;
    requestId?: string | null;
    details?: unknown;
  }) {
    super(args.message);
    this.name = "EdgeFunctionError";
    this.route = args.route;
    this.status = args.status;
    this.code = args.code ?? null;
    this.requestId = args.requestId ?? null;
    this.details = args.details ?? null;
  }
}

interface AuthContext {
  accessToken: string | null;
  authError: Error | null;
}

const logger = createLogger("edge");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// Optional override to route all /functions/v1/* calls through a self-hosted API.
// Must include the /functions/v1 prefix (example: https://api.example.com/functions/v1).
const MYTHIC_FUNCTIONS_BASE_URL = (import.meta.env.VITE_MYTHIC_FUNCTIONS_BASE_URL ?? "").trim();
const DEFAULT_EDGE_TIMEOUT_MS = 20_000;
const AUTH_CALL_TIMEOUT_MS = 4_000;
const REFRESH_BUFFER_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 350;
const MAX_CONCURRENT_EDGE_CALLS = 6;
const MAX_RESPONSE_SNIPPET = 2000;

let activeEdgeCalls = 0;
type EdgeQueueItem = {
  id: string;
  release: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  aborted: boolean;
  onAbort?: () => void;
};
const edgeCallQueue: EdgeQueueItem[] = [];

const inFlightJsonCalls = new Map<string, Promise<unknown>>();
const inFlightRawCalls = new Map<string, Promise<Response>>();

const ensureEnv = () => {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error("Supabase env is not configured");
  }
};

const withAuthTimeout = async <T>(
  operation: () => Promise<T>,
  label: string,
  timeoutMs = AUTH_CALL_TIMEOUT_MS,
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

const getSessionSafe = async (): Promise<{ session: SessionLike | null; error: Error | null }> => {
  try {
    const { data: { session }, error } = await withAuthTimeout(
      () => supabase.auth.getSession(),
      "Auth session fetch",
    );
    if (error && !session) {
      return { session: null, error };
    }
    return { session: session ?? null, error: null };
  } catch (error) {
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
      || (expiresAt && expiresAt - Date.now() < REFRESH_BUFFER_MS),
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
      ...(options?.idempotencyKey ? { "x-idempotency-key": options.idempotencyKey } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    skipped: false,
    authError: null,
  };
};

const buildUrl = (name: string) => {
  ensureEnv();
  if (MYTHIC_FUNCTIONS_BASE_URL) {
    const base = MYTHIC_FUNCTIONS_BASE_URL.endsWith("/")
      ? MYTHIC_FUNCTIONS_BASE_URL.slice(0, -1)
      : MYTHIC_FUNCTIONS_BASE_URL;
    return `${base}/${name}`;
  }
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
  init: RequestInit,
): Promise<Response> => {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
  const signal = init.signal
    ? combineSignals(init.signal, timeoutController.signal)
    : timeoutController.signal;

  const startedAt = Date.now();
  try {
    recordEdgeCall();
    const response = await fetch(input, { ...init, signal });
    recordEdgeResponse();
    recordHealthSuccess(`edge:${name}`, Date.now() - startedAt);
    return response;
  } catch (error) {
    if (timeoutController.signal.aborted) {
      const timeoutError = new Error(`Edge function ${name} timed out after ${timeoutMs}ms`);
      recordHealthFailure(`edge:${name}`, timeoutError, Date.now() - startedAt, {
        route: name,
        code: "upstream_timeout",
      });
      throw timeoutError;
    }
    const classified = classifyTransportError(name, error);
    recordHealthFailure(`edge:${name}`, classified, Date.now() - startedAt, {
      route: name,
      code: classified.code,
    });
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildInvokeHeaders = (headers?: EdgeHeaders) => {
  if (!headers) return undefined;
  const normalized: EdgeHeaders = { ...headers };
  delete normalized.Authorization;
  delete normalized.authorization;
  delete normalized.apikey;
  return normalized;
};

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
      ?? response.headers.get("x-vercel-id")
      ?? response.headers.get("sb-request-id")
      ?? response.headers.get("cf-ray");
    if (headerId) return headerId;
  }
  if (json && typeof json === "object" && "requestId" in json) {
    const value = (json as { requestId?: string }).requestId;
    return value ?? null;
  }
  if (json && typeof json === "object" && "request_id" in json) {
    const value = (json as { request_id?: string }).request_id;
    return value ?? null;
  }
  return null;
};

const readResponseBody = async (
  response?: Response | null,
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

type EdgeErrorPayload = {
  message?: string;
  error?: string;
  code?: string;
  details?: unknown;
};

const extractRequestIdFromDetails = (details: unknown): string | null => {
  if (!details || typeof details !== "object") return null;
  const payload = details as Record<string, unknown>;
  return (
    (typeof payload.requestId === "string" ? payload.requestId : null)
    ?? (typeof payload.request_id === "string" ? payload.request_id : null)
    ?? (typeof payload.sb_request_id === "string" ? payload.sb_request_id : null)
    ?? null
  );
};

const classifyTransportFromMessage = (message: string): { status: number; code: string } => {
  const lower = message.toLowerCase();
  const has522Signal =
    lower.includes("error code 522")
    || lower.includes("cloudflare 522")
    || lower.includes("connection timed out")
    || lower.includes("sb-request-id");
  if (has522Signal) {
    return { status: 522, code: "auth_gateway_timeout" };
  }
  if (lower.includes("timed out") || lower.includes("timeout")) {
    return { status: 504, code: "upstream_timeout" };
  }
  if (lower.includes("failed to fetch") || lower.includes("network") || lower.includes("load failed")) {
    return { status: 503, code: "network_unreachable" };
  }
  if (lower.includes("cancelled") || lower.includes("aborted") || lower.includes("aborterror")) {
    return { status: 499, code: "request_cancelled" };
  }
  return { status: 599, code: "edge_fetch_failed" };
};

const classifyTransportError = (
  route: string,
  error: unknown,
): EdgeFunctionError => {
  if (error instanceof EdgeFunctionError) {
    return error;
  }
  const fallback = error instanceof Error ? error.message : "Edge function request failed";
  const message = fallback.trim().length > 0 ? fallback : "Edge function request failed";
  const { status, code } = classifyTransportFromMessage(message);
  const requestId = extractRequestIdFromDetails((error as { details?: unknown })?.details);

  return new EdgeFunctionError({
    route,
    status,
    code,
    requestId,
    details: { classifier: code, route },
    message: `Edge function ${route} failed (${status}): ${message} [${code}]`,
  });
};

const normalizeAuthContextError = (error: Error): EdgeFunctionError => {
  const lower = error.message.toLowerCase();
  if (lower.includes("timed out")) {
    return new EdgeFunctionError({
      route: "supabase-auth",
      status: 522,
      code: "auth_gateway_timeout",
      requestId: null,
      details: { classifier: "auth_gateway_timeout", route: "supabase-auth" },
      message: `Supabase auth gateway unreachable: ${error.message}`,
    });
  }
  if (lower.includes("failed to fetch") || lower.includes("network")) {
    return new EdgeFunctionError({
      route: "supabase-auth",
      status: 503,
      code: "network_unreachable",
      requestId: null,
      details: { classifier: "network_unreachable", route: "supabase-auth" },
      message: `Supabase auth network path failed: ${error.message}`,
    });
  }
  return new EdgeFunctionError({
    route: "supabase-auth",
    status: 401,
    code: "auth_required",
    requestId: null,
    details: { classifier: "auth_required", route: "supabase-auth" },
    message: error.message,
  });
};

const buildEdgeError = (
  name: string,
  status: number,
  statusText: string | null,
  responseDetails: { text: string | null; json: unknown | null },
  fallback: string,
  requestId: string | null,
) => {
  const json = responseDetails.json as EdgeErrorPayload | null;
  const responseText = responseDetails.text?.toLowerCase() ?? "";
  const has522Signal =
    responseText.includes("error code 522")
    || responseText.includes("connection timed out")
    || (responseText.includes("cloudflare") && responseText.includes("timed out"));
  const normalizedStatus = has522Signal && status >= 500 ? 522 : status;
  const derivedCode =
    json?.code
    ?? (normalizedStatus === 522 ? "auth_gateway_timeout" : null)
    ?? (normalizedStatus === 504 ? "upstream_timeout" : null)
    ?? (normalizedStatus === 503 ? "network_unreachable" : null);
  const message =
    json?.message
    ?? json?.error
    ?? responseDetails.text
    ?? fallback;
  const requestSuffix = requestId ? ` (requestId: ${requestId})` : "";
  const statusSuffix = statusText ? ` ${statusText}` : "";
  const codeSuffix = derivedCode ? ` [${derivedCode}]` : "";
  return new EdgeFunctionError({
    route: name,
    status: normalizedStatus,
    code: derivedCode ?? null,
    requestId,
    details: json?.details ?? { edge_status: status, route: name },
    message: `Edge function ${name} failed (${normalizedStatus}${statusSuffix}): ${message}${codeSuffix}${requestSuffix}`,
  });
};

const shouldRetryStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504 || status === 522;

const shouldRetryError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error instanceof EdgeFunctionError) {
    return error.code === "network_unreachable"
      || error.code === "upstream_timeout"
      || error.code === "auth_gateway_timeout"
      || error.code === "edge_fetch_failed";
  }
  const message = error.message.toLowerCase();
  return message.includes("timed out")
    || message.includes("network")
    || message.includes("failed to fetch")
    || message.includes("edge_fetch_failed");
};

const waitBackoff = async (attempt: number, baseMs: number, signal?: AbortSignal) => {
  const ms = Math.min(8_000, baseMs * 2 ** Math.max(0, attempt - 1));
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error("Request cancelled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  return ms;
};

const dequeueNextEdgeSlot = () => {
  while (edgeCallQueue.length > 0) {
    const next = edgeCallQueue.shift();
    if (!next) return;
    if (next.onAbort && next.signal) {
      next.signal.removeEventListener("abort", next.onAbort);
      next.onAbort = undefined;
    }
    if (next.aborted || next.signal?.aborted) continue;
    activeEdgeCalls += 1;
    next.release();
    return;
  }
};

const waitForEdgeSlot = (signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Request cancelled"));
      return;
    }

    const item: EdgeQueueItem = {
      id: crypto.randomUUID(),
      release: resolve,
      reject,
      signal,
      aborted: false,
    };

    item.onAbort = () => {
      item.aborted = true;
      const index = edgeCallQueue.findIndex((entry) => entry.id === item.id);
      if (index >= 0) edgeCallQueue.splice(index, 1);
      reject(new Error("Request cancelled"));
    };

    if (signal) {
      signal.addEventListener("abort", item.onAbort, { once: true });
    }

    edgeCallQueue.push(item);
  });

const withEdgeSlot = async <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (activeEdgeCalls >= MAX_CONCURRENT_EDGE_CALLS) {
    await waitForEdgeSlot(signal);
  } else {
    activeEdgeCalls += 1;
  }

  try {
    return await run();
  } finally {
    activeEdgeCalls = Math.max(0, activeEdgeCalls - 1);
    dequeueNextEdgeSlot();
  }
};

const responseForAuthError = (authError: Error) => {
  const normalized = normalizeAuthContextError(authError);
  return {
    data: null,
    error: normalized,
    status: normalized.status,
    raw: new Response(null, { status: normalized.status, statusText: normalized.code ?? "auth_required" }),
    skipped: true,
  };
};

const buildRequestHeaders = (options: EdgeOptions | undefined, token: string | null): EdgeHeaders => ({
  "Content-Type": "application/json",
  apikey: ANON_KEY,
  ...(options?.headers ? buildInvokeHeaders(options.headers) ?? {} : {}),
  ...(options?.idempotencyKey ? { "x-idempotency-key": options.idempotencyKey } : {}),
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

export async function callEdgeFunction<T>(
  name: string,
  options?: EdgeOptions,
): Promise<{ data: T | null; error: Error | null; status: number; raw: Response; skipped: boolean }> {
  ensureEnv();

  const dedupeKey = options?.idempotencyKey ? `${name}:${options.idempotencyKey}` : null;
  if (dedupeKey && inFlightJsonCalls.has(dedupeKey)) {
    const existing = inFlightJsonCalls.get(dedupeKey) as Promise<{ data: T | null; error: Error | null; status: number; raw: Response; skipped: boolean }>;
    return await existing;
  }

  const runPromise = withEdgeSlot(async () => {
    const overrideToken = options?.accessToken ?? null;
    const baseAuth = overrideToken
      ? { authError: null as Error | null, accessToken: overrideToken }
      : await getAuthContext(options?.requireAuth);

    if (baseAuth.authError) {
      const authError = normalizeAuthContextError(baseAuth.authError);
      logger.error("auth.required", authError, { name, code: authError.code });
      recordHealthFailure("auth", authError, null, { route: "supabase-auth", code: authError.code });
      return responseForAuthError(baseAuth.authError);
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_EDGE_TIMEOUT_MS;
    const maxRetries = Math.max(0, Math.floor(options?.maxRetries ?? DEFAULT_MAX_RETRIES));
    const retryBaseMs = Math.max(100, Math.floor(options?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS));
    const url = buildUrl(name);
    const method = options?.method ?? "POST";

    let response: Response | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const startedAt = Date.now();
      try {
        response = await fetchWithTimeout(name, timeoutMs, url, {
          method,
          headers: buildRequestHeaders(options, baseAuth.accessToken),
          body: options?.body ? JSON.stringify(options.body) : undefined,
          signal: options?.signal,
        });
      } catch (error) {
        const edgeError = classifyTransportError(name, error);
        lastError = edgeError;
        logger.error("invoke.error", edgeError, { name, attempt, method, code: edgeError.code });
        if (attempt <= maxRetries && shouldRetryError(edgeError)) {
          const waitMs = await waitBackoff(attempt, retryBaseMs, options?.signal);
          logger.warn("invoke.retry", { name, attempt, wait_ms: waitMs, reason: edgeError.message });
          continue;
        }
        recordHealthFailure(`edge:${name}`, edgeError, Date.now() - startedAt, { route: name, code: edgeError.code });
        return {
          data: null,
          error: edgeError,
          status: edgeError.status,
          raw: new Response(null, { status: edgeError.status, statusText: edgeError.code ?? "edge_fetch_failed" }),
          skipped: false,
        };
      }

      const responseDetails = await readResponseBody(response);
      const requestId = extractRequestId(response, responseDetails.json);

      if (!response.ok) {
        const fallbackMessage = responseDetails.text ?? "Edge function request failed";
        const edgeError = buildEdgeError(
          name,
          response.status,
          response.statusText,
          responseDetails,
          fallbackMessage,
          requestId,
        );

        // Retry once on auth invalid after refresh.
        const shouldRefresh =
          response.status === 401
          || edgeError.message.toLowerCase().includes("invalid jwt")
          || edgeError.code === "auth_invalid";
        if (shouldRefresh) {
          const { session: refreshedSession, error: refreshError } = await refreshSessionSafe();
          if (!refreshError && refreshedSession?.access_token) {
            try {
              response = await fetchWithTimeout(name, timeoutMs, url, {
                method,
                headers: buildRequestHeaders(options, refreshedSession.access_token),
                body: options?.body ? JSON.stringify(options.body) : undefined,
                signal: options?.signal,
              });
            } catch (error) {
              const refreshFetchError = classifyTransportError(name, error);
              logger.error("invoke.refresh.error", refreshFetchError, { name, attempt, code: refreshFetchError.code });
              recordHealthFailure(`edge:${name}`, refreshFetchError, Date.now() - startedAt, { route: name, code: refreshFetchError.code });
              return {
                data: null,
                error: refreshFetchError,
                status: refreshFetchError.status,
                raw: new Response(null, { status: refreshFetchError.status, statusText: refreshFetchError.code ?? "edge_fetch_failed" }),
                skipped: false,
              };
            }
            if (response.ok) {
              const refreshedPayload = await readResponseBody(response);
              if (refreshedPayload.json) {
                recordHealthSuccess(`edge:${name}`, Date.now() - startedAt);
                return { data: refreshedPayload.json as T, error: null, status: response.status, raw: response, skipped: false };
              }
            }
          }
        }

        lastError = edgeError;
        logger.error("invoke.bad_status", edgeError, {
          name,
          attempt,
          status: response.status,
          requestId,
          responseText: responseDetails.text,
        });

        if (attempt <= maxRetries && shouldRetryStatus(response.status)) {
          const waitMs = await waitBackoff(attempt, retryBaseMs, options?.signal);
          logger.warn("invoke.retry", { name, attempt, wait_ms: waitMs, status: response.status });
          continue;
        }

        recordHealthFailure(`edge:${name}`, edgeError, Date.now() - startedAt, { route: name, code: edgeError.code });
        return {
          data: null,
          error: edgeError,
          status: response.status,
          raw: response,
          skipped: false,
        };
      }

      const payload = responseDetails.json as T | null;
      if (payload) {
        recordHealthSuccess(`edge:${name}`, Date.now() - startedAt);
        return { data: payload, error: null, status: response.status, raw: response, skipped: false };
      }

      if (!responseDetails.text || responseDetails.text.trim().length === 0) {
        recordHealthSuccess(`edge:${name}`, Date.now() - startedAt);
        return { data: null, error: null, status: response.status, raw: response, skipped: false };
      }

      try {
        const parsed = JSON.parse(responseDetails.text) as T;
        recordHealthSuccess(`edge:${name}`, Date.now() - startedAt);
        return { data: parsed, error: null, status: response.status, raw: response, skipped: false };
      } catch (parseError) {
        const parseErr = parseError instanceof Error ? parseError : new Error("Failed to parse edge response");
        lastError = parseErr;
        logger.error("invoke.parse_error", parseErr, { name, attempt, snippet: responseDetails.text });
        if (attempt <= maxRetries) {
          const waitMs = await waitBackoff(attempt, retryBaseMs, options?.signal);
          logger.warn("invoke.retry", { name, attempt, wait_ms: waitMs, reason: "parse_error" });
          continue;
        }
        return {
          data: null,
          error: parseErr,
          status: response.status,
          raw: response,
          skipped: false,
        };
      }
    }

    const fallbackError = lastError ?? new Error("Edge function request failed after retries");
    const fallbackStatus = fallbackError instanceof EdgeFunctionError ? fallbackError.status : 599;
    const fallbackCode = fallbackError instanceof EdgeFunctionError ? fallbackError.code : "edge_fetch_failed";
    return {
      data: null,
      error: fallbackError,
      status: fallbackStatus,
      raw: new Response(null, { status: fallbackStatus, statusText: fallbackCode ?? "edge_fetch_failed" }),
      skipped: false,
    };
  }, options?.signal);

  if (dedupeKey) {
    inFlightJsonCalls.set(dedupeKey, runPromise as Promise<unknown>);
  }

  try {
    return await runPromise;
  } finally {
    if (dedupeKey) inFlightJsonCalls.delete(dedupeKey);
  }
}

export async function callEdgeFunctionRaw(
  name: string,
  options?: EdgeRawOptions,
): Promise<Response> {
  const dedupeKey = options?.idempotencyKey ? `${name}:${options.idempotencyKey}` : null;
  if (dedupeKey && inFlightRawCalls.has(dedupeKey)) {
    return await inFlightRawCalls.get(dedupeKey)!;
  }

  const runPromise = withEdgeSlot(async () => {
    const { headers, skipped, authError } = await buildHeaders(options);
    if (skipped || authError) {
      if (authError) {
        logger.error("raw.auth.required", authError, { name });
      }
      return new Response(null, { status: 401, statusText: "auth_required" });
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_EDGE_TIMEOUT_MS;
    const maxRetries = Math.max(0, Math.floor(options?.maxRetries ?? DEFAULT_MAX_RETRIES));
    const retryBaseMs = Math.max(100, Math.floor(options?.retryBaseMs ?? DEFAULT_RETRY_BASE_MS));

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        const response = await fetchWithTimeout(name, timeoutMs, buildUrl(name), {
          method: options?.method ?? "POST",
          headers,
          body: options?.body ? JSON.stringify(options.body) : undefined,
          signal: options?.signal,
        });
        if (!response.ok) {
          const responseDetails = await readResponseBody(response);
          const requestId = extractRequestId(response, responseDetails.json);
          const edgeError = buildEdgeError(
            name,
            response.status,
            response.statusText,
            responseDetails,
            "Edge function request failed",
            requestId,
          );
          logger.error("raw.bad_status", edgeError, {
            name,
            attempt,
            status: response.status,
            requestId,
          });
          if (attempt <= maxRetries && shouldRetryStatus(response.status)) {
            const waitMs = await waitBackoff(attempt, retryBaseMs, options?.signal);
            logger.warn("raw.retry", { name, attempt, wait_ms: waitMs, status: response.status });
            continue;
          }
          throw edgeError;
        }
        return response;
      } catch (error) {
        const edgeError = classifyTransportError(name, error);
        if (attempt <= maxRetries && shouldRetryError(edgeError)) {
          const waitMs = await waitBackoff(attempt, retryBaseMs, options?.signal);
          logger.warn("raw.retry", { name, attempt, wait_ms: waitMs, reason: edgeError.message });
          continue;
        }
        logger.error("raw.invoke.error", edgeError, { name, attempt });
        throw edgeError;
      }
    }

    throw new Error(`Edge function ${name} failed after retries`);
  }, options?.signal);

  if (dedupeKey) inFlightRawCalls.set(dedupeKey, runPromise);
  try {
    return await runPromise;
  } finally {
    if (dedupeKey) inFlightRawCalls.delete(dedupeKey);
  }
}
