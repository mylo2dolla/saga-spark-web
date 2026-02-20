import { formatError } from "@/ui/data/async";

export interface ParsedEdgeError {
  message: string;
  status: number | null;
  code: string | null;
  requestId: string | null;
  retryAfterMs: number | null;
  isAuth: boolean;
  isRateLimited: boolean;
}

export interface FriendlyEdgeError extends ParsedEdgeError {
  title: string;
  description: string;
}

const STATUS_PATTERN = /\((\d{3})(?:\s+[^)]*)?\)/;
const CODE_PATTERN = /\[([a-z0-9_]+)\]/i;
const REQUEST_ID_PATTERN = /\(requestId:\s*([^)]+)\)/i;
const RETRY_SECONDS_PATTERN = /retry in\s+(\d+)\s*s/i;
const RETRY_MS_PATTERN = /retry[_\s-]?after(?:_ms)?[:=\s]+(\d+)/i;

const normalizeCode = (value: string | null): string | null => {
  if (!value) return null;
  return value.trim().toLowerCase();
};

const summarizeMessage = (message: string, fallback: string): string => {
  const compact = message.trim();
  if (!compact) return fallback;
  const afterColon = compact.includes(":") ? compact.slice(compact.indexOf(":") + 1).trim() : compact;
  return afterColon
    .replace(REQUEST_ID_PATTERN, "")
    .replace(CODE_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim() || fallback;
};

export function parseEdgeError(error: unknown, fallback = "Request failed"): ParsedEdgeError {
  const message = formatError(error, fallback);
  const lower = message.toLowerCase();
  const status = Number(STATUS_PATTERN.exec(message)?.[1] ?? NaN);
  const codeMatch = CODE_PATTERN.exec(message)?.[1] ?? null;
  const code = normalizeCode(codeMatch);
  const requestId = REQUEST_ID_PATTERN.exec(message)?.[1]?.trim() ?? null;

  const retrySeconds = Number(RETRY_SECONDS_PATTERN.exec(message)?.[1] ?? NaN);
  const retryMsFromSeconds = Number.isFinite(retrySeconds) ? retrySeconds * 1000 : NaN;
  const retryMsDirect = Number(RETRY_MS_PATTERN.exec(message)?.[1] ?? NaN);
  const retryAfterMs = Number.isFinite(retryMsDirect)
    ? retryMsDirect
    : Number.isFinite(retryMsFromSeconds)
      ? retryMsFromSeconds
      : null;

  const normalizedStatus = Number.isFinite(status) ? status : null;
  const isAuth = code === "auth_required"
    || code === "auth_invalid"
    || normalizedStatus === 401
    || lower.includes("authentication required")
    || lower.includes("invalid or expired authentication token")
    || lower.includes("invalid jwt");
  const isRateLimited = code === "rate_limited"
    || normalizedStatus === 429
    || lower.includes("rate limit");

  return {
    message,
    status: normalizedStatus,
    code,
    requestId,
    retryAfterMs,
    isAuth,
    isRateLimited,
  };
}

export function toFriendlyEdgeError(error: unknown, fallback = "Request failed"): FriendlyEdgeError {
  const parsed = parseEdgeError(error, fallback);
  const lowerMessage = parsed.message.toLowerCase();

  if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("edge_fetch_failed")) {
    return {
      ...parsed,
      title: "Network/CORS blocked",
      description: "Browser could not reach the VM API. Check VITE_MYTHIC_FUNCTIONS_BASE_URL, VM availability, and allowed CORS origins.",
      code: parsed.code ?? "network_unreachable",
    };
  }

  if (parsed.code === "network_unreachable" || parsed.code === "upstream_timeout") {
    return {
      ...parsed,
      title: "Functions API unreachable",
      description: "Could not reach the VM functions API. Check VITE_MYTHIC_FUNCTIONS_BASE_URL and VM/Caddy health.",
    };
  }

  if (parsed.code === "auth_gateway_timeout") {
    return {
      ...parsed,
      title: "Auth gateway timeout",
      description: "Supabase auth timed out upstream. Retry once; if it repeats, check Supabase status and network route.",
    };
  }

  if (lowerMessage.includes("timed out")) {
    return {
      ...parsed,
      title: "Generation timed out",
      description: "Generation took too long. Retry once; if it keeps happening, we need to tune backend latency.",
      code: parsed.code ?? "timeout",
    };
  }

  if (parsed.isAuth) {
    return {
      ...parsed,
      title: "Sign in required",
      description: "Your session expired or is invalid. Sign in again, then retry.",
      code: parsed.code ?? "auth_required",
    };
  }

  if (parsed.isRateLimited) {
    const retrySeconds = parsed.retryAfterMs && parsed.retryAfterMs > 0
      ? Math.max(1, Math.ceil(parsed.retryAfterMs / 1000))
      : null;
    return {
      ...parsed,
      title: "Too many requests",
      description: retrySeconds
        ? `Rate limit reached. Wait about ${retrySeconds}s, then retry.`
        : "Rate limit reached. Wait a moment, then retry.",
      code: parsed.code ?? "rate_limited",
    };
  }

  return {
    ...parsed,
    title: "Request failed",
    description: summarizeMessage(parsed.message, fallback),
  };
}
