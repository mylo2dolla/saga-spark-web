const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const idempotencyResponses = new Map<string, { response: Response; expiresAt: number }>();

function now() {
  return Date.now();
}

function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() ?? "unknown";
  return req.headers.get("cf-connecting-ip") ?? "unknown";
}

export function enforceRateLimit(args: {
  req: Request;
  route: string;
  limit: number;
  windowMs: number;
  corsHeaders: Record<string, string>;
}): Response | null {
  const { req, route, limit, windowMs, corsHeaders } = args;
  const clientIp = getClientIp(req);
  const key = `${route}:${clientIp}`;
  const ts = now();
  const bucket = rateBuckets.get(key);
  if (!bucket || ts >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: ts + windowMs });
    return null;
  }
  if (bucket.count >= limit) {
    const retryAfterMs = Math.max(0, bucket.resetAt - ts);
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Rate limit exceeded. Retry shortly.",
        code: "rate_limited",
        retry_after_ms: retryAfterMs,
      }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
      },
    );
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return null;
}

export function idempotencyKeyFromRequest(req: Request): string | null {
  const value = req.headers.get("x-idempotency-key");
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getIdempotentResponse(key: string): Response | null {
  const found = idempotencyResponses.get(key);
  if (!found) return null;
  if (now() > found.expiresAt) {
    idempotencyResponses.delete(key);
    return null;
  }
  return found.response.clone();
}

export function storeIdempotentResponse(key: string, response: Response, ttlMs = 30_000) {
  idempotencyResponses.set(key, { response: response.clone(), expiresAt: now() + ttlMs });
}

