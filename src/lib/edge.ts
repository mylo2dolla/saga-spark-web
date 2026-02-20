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

interface AuthContext {
  accessToken: string | null;
  authError: Error | null;
}

const logger = createLogger("edge");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const RAW_FUNCTIONS_BASE_URL = (
  import.meta.env.VITE_MYTHIC_FUNCTIONS_BASE_URL
  ?? import.meta.env.NEXT_PUBLIC_MYTHIC_FUNCTIONS_BASE_URL
  ?? ""
).trim();
const FUNCTIONS_BASE_URL = RAW_FUNCTIONS_BASE_URL.replace(/\/+$/, "");
const SUPABASE_API_KEY = (
  import.meta.env.VITE_SUPABASE_ANON_KEY
  ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  ?? import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)?.trim();
const DEFAULT_EDGE_TIMEOUT_MS = 20_000;
const AUTH_CALL_TIMEOUT_MS = 4_000;
const REFRESH_BUFFER_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 350;
const MAX_CONCURRENT_EDGE_CALLS = 6;
const MAX_RESPONSE_SNIPPET = 2000;
const MAX_IDEMPOTENCY_KEY_LEN = 180;

let activeEdgeCalls = 0;
type QueuedEdgeCall = {
  resolve: () => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};
const edgeCallQueue: QueuedEdgeCall[] = [];

const inFlightJsonCalls = new Map<string, Promise<unknown>>();
const inFlightRawCalls = new Map<string, Promise<Response>>();

const fnv1a32Hex = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const asciiSlug = (value: string, maxLen = 96): string => {
  const normalized = value
    .normalize("NFKC")
    .replace(/[^\x20-\x7e]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._~-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) return "";
  return normalized.slice(0, maxLen);
};

const normalizeIdempotencyKey = (value?: string): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const clean = asciiSlug(trimmed, MAX_IDEMPOTENCY_KEY_LEN);
  if (clean && clean.length <= MAX_IDEMPOTENCY_KEY_LEN) return clean;

  const hash = fnv1a32Hex(trimmed);
  const prefix = asciiSlug(trimmed, 64);
  const fallback = prefix ? `${prefix}-${hash}` : `key-${hash}`;
  return fallback.slice(0, MAX_IDEMPOTENCY_KEY_LEN);
};

const ensureEnv = () => {
  if (!SUPABASE_URL || !SUPABASE_API_KEY || !FUNCTIONS_BASE_URL) {
    throw new Error(
      "Missing required env. Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY), and VITE_MYTHIC_FUNCTIONS_BASE_URL.",
    );
  }

  try {
    const url = new URL(FUNCTIONS_BASE_URL);
    if (url.hostname.endsWith(".supabase.co")) {
      throw new Error(
        "VITE_MYTHIC_FUNCTIONS_BASE_URL must point to your VM runtime, not Supabase Edge Functions.",
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("must point to your VM runtime")) {
      throw error;
    }
    throw new Error("VITE_MYTHIC_FUNCTIONS_BASE_URL must be a valid absolute URL.");
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
  const idempotencyKey = normalizeIdempotencyKey(options?.idempotencyKey);
  const { accessToken, authError } = await getAuthContext(options?.requireAuth);
  if (authError) {
    return {
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_API_KEY!,
        ...(options?.headers ?? {}),
      },
      skipped: true,
      authError,
    };
  }
  return {
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_API_KEY!,
      ...(options?.headers ?? {}),
      ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    skipped: false,
    authError: null,
  };
};

const buildUrl = (name: string) => {
  ensureEnv();
  const base = FUNCTIONS_BASE_URL.endsWith("/functions/v1")
    ? FUNCTIONS_BASE_URL
    : `${FUNCTIONS_BASE_URL}/functions/v1`;
  return `${base}/${name}`;
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
      recordHealthFailure(`edge:${name}`, timeoutError, Date.now() - startedAt);
      throw timeoutError;
    }
    recordHealthFailure(`edge:${name}`, error, Date.now() - startedAt);
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

const buildEdgeErrorMessage = (
  name: string,
  status: number,
  statusText: string | null,
  responseDetails: { text: string | null; json: unknown | null },
  fallback: string,
  requestId: string | null,
) => {
  const json = responseDetails.json as
    | {
      message?: string;
      error?: string;
      code?: string;
      retry_after_ms?: number;
      retryAfterMs?: number;
      details?: { message?: string };
    }
    | null;
  const baseMessage =
    json?.message
    ?? json?.error
    ?? json?.details?.message
    ?? responseDetails.text
    ?? fallback;
  const retryAfterMs = typeof json?.retry_after_ms === "number"
    ? json.retry_after_ms
    : typeof json?.retryAfterMs === "number"
      ? json.retryAfterMs
      : null;
  const retryHint = status === 429 && retryAfterMs && retryAfterMs > 0
    ? ` Retry in ${Math.max(1, Math.ceil(retryAfterMs / 1000))}s.`
    : "";
  const message = `${baseMessage}${retryHint}`;
  const codeSuffix = typeof json?.code === "string" && json.code.trim().length > 0
    ? ` [${json.code.trim()}]`
    : "";
  const requestSuffix = requestId ? ` (requestId: ${requestId})` : "";
  const statusSuffix = statusText ? ` ${statusText}` : "";
  return `Edge function ${name} failed (${status}${statusSuffix}): ${message}${codeSuffix}${requestSuffix}`;
};

const shouldRetryStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

const shouldRetryError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return message.includes("timed out") || message.includes("network") || message.includes("failed to fetch") || message.includes("edge_fetch_failed");
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

const withEdgeSlot = async <T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
  if (signal?.aborted) {
    throw new Error("Request cancelled");
  }

  if (activeEdgeCalls >= MAX_CONCURRENT_EDGE_CALLS) {
    await new Promise<void>((resolve, reject) => {
      const entry: QueuedEdgeCall = {
        resolve: () => {
          if (entry.signal && entry.onAbort) {
            entry.signal.removeEventListener("abort", entry.onAbort);
          }
          resolve();
        },
        signal,
      };
      const onAbort = () => {
        const queueIndex = edgeCallQueue.indexOf(entry);
        if (queueIndex >= 0) {
          edgeCallQueue.splice(queueIndex, 1);
        }
        reject(new Error("Request cancelled"));
      };
      entry.onAbort = onAbort;
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      edgeCallQueue.push(entry);
    });
  }

  if (signal?.aborted) {
    throw new Error("Request cancelled");
  }

  activeEdgeCalls += 1;
  try {
    return await run();
  } finally {
    activeEdgeCalls = Math.max(0, activeEdgeCalls - 1);
    const next = edgeCallQueue.shift();
    if (next) next.resolve();
  }
};

const responseForAuthError = (authError: Error) => ({
  data: null,
  error: authError,
  status: 401,
  raw: new Response(null, { status: 401, statusText: "auth_required" }),
  skipped: true,
});

const buildRequestHeaders = (options: EdgeOptions | undefined, token: string | null): EdgeHeaders => {
  const idempotencyKey = normalizeIdempotencyKey(options?.idempotencyKey);
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_API_KEY!,
    ...(options?.headers ? buildInvokeHeaders(options.headers) ?? {} : {}),
    ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

export async function callEdgeFunction<T>(
  name: string,
  options?: EdgeOptions,
): Promise<{ data: T | null; error: Error | null; status: number; raw: Response; skipped: boolean }> {
  ensureEnv();

  const normalizedIdempotencyKey = normalizeIdempotencyKey(options?.idempotencyKey);
  const dedupeKey = normalizedIdempotencyKey ? `${name}:${normalizedIdempotencyKey}` : null;
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
      logger.error("auth.required", baseAuth.authError, { name });
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
        const edgeError = error instanceof Error ? error : new Error("Edge function request failed");
        lastError = edgeError;
        logger.error("invoke.error", edgeError, { name, attempt, method });
        if (attempt <= maxRetries && shouldRetryError(edgeError)) {
          const waitMs = await waitBackoff(attempt, retryBaseMs, options?.signal);
          logger.warn("invoke.retry", { name, attempt, wait_ms: waitMs, reason: edgeError.message });
          continue;
        }
        return {
          data: null,
          error: edgeError,
          status: 599,
          raw: new Response(null, { status: 599, statusText: "edge_fetch_failed" }),
          skipped: false,
        };
      }

      const responseDetails = await readResponseBody(response);
      const requestId = extractRequestId(response, responseDetails.json);

      if (!response.ok) {
        const fallbackMessage = responseDetails.text ?? "Edge function request failed";
        const message = buildEdgeErrorMessage(
          name,
          response.status,
          response.statusText,
          responseDetails,
          fallbackMessage,
          requestId,
        );

        // Retry once on auth invalid after refresh.
        const shouldRefresh = response.status === 401 || message.toLowerCase().includes("invalid jwt");
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
              const refreshFetchError = error instanceof Error ? error : new Error("Edge function request failed");
              logger.error("invoke.refresh.error", refreshFetchError, { name, attempt });
              return {
                data: null,
                error: refreshFetchError,
                status: 599,
                raw: new Response(null, { status: 599, statusText: "edge_fetch_failed" }),
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

        const error = new Error(message);
        lastError = error;
        logger.error("invoke.bad_status", error, {
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

        recordHealthFailure(`edge:${name}`, error, Date.now() - startedAt);
        return {
          data: null,
          error,
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
    return {
      data: null,
      error: fallbackError,
      status: 599,
      raw: new Response(null, { status: 599, statusText: "edge_fetch_failed" }),
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
  const normalizedIdempotencyKey = normalizeIdempotencyKey(options?.idempotencyKey);
  const dedupeKey = normalizedIdempotencyKey ? `${name}:${normalizedIdempotencyKey}` : null;
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
          const message = buildEdgeErrorMessage(
            name,
            response.status,
            response.statusText,
            responseDetails,
            "Edge function request failed",
            requestId,
          );
          logger.error("raw.bad_status", new Error(message), {
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
          throw new Error(message);
        }
        return response;
      } catch (error) {
        const edgeError = error instanceof Error ? error : new Error("Edge function request failed");
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
