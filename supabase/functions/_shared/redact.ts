const SECRET_KEY_PATTERN = /(token|secret|password|apikey|api_key|authorization|cookie|session|jwt|key)/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+\b/g;
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]+/gi;
const API_KEY_PATTERN = /\b(sk-[A-Za-z0-9_-]{16,}|sb_publishable_[A-Za-z0-9_-]{20,})\b/g;
// OpenAI sometimes returns an error string that includes a partially shown key fragment.
// Example: "Incorrect API key provided: abcd****wxyz. You can find your API key at …"
const OPENAI_KEY_FRAGMENT_PATTERN = /Incorrect API key provided:\s*[A-Za-z0-9_*.-]+/gi;

export function redactText(input: string): string {
  return input
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .replace(JWT_PATTERN, "[REDACTED_JWT]")
    .replace(API_KEY_PATTERN, "[REDACTED_KEY]")
    .replace(OPENAI_KEY_FRAGMENT_PATTERN, "Incorrect API key provided: [REDACTED]");
}

function redactPrimitive(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  return value;
}

export function redactValue<T>(value: T, depth = 0): T {
  if (depth > 6) return value;
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return redactPrimitive(value) as T;
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, depth + 1)) as T;

  const source = value as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      next[key] = "[REDACTED]";
      continue;
    }
    next[key] = redactValue(redactPrimitive(raw), depth + 1);
  }
  return next as T;
}

export function sanitizeError(error: unknown): { message: string; code: string | null } {
  if (error instanceof Error) {
    const maybeCode = typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code?: string }).code)
      : null;
    return { message: redactText(error.message), code: maybeCode };
  }
  if (typeof error === "string") {
    return { message: redactText(error), code: null };
  }
  if (error && typeof error === "object") {
    const message = typeof (error as { message?: unknown }).message === "string"
      ? String((error as { message?: string }).message)
      : "Unknown error";
    const code = typeof (error as { code?: unknown }).code === "string"
      ? String((error as { code?: string }).code)
      : null;
    return { message: redactText(message), code };
  }
  return { message: "Unknown error", code: null };
}
