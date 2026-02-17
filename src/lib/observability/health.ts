import { sanitizeError } from "@/lib/observability/redact";

export interface HealthSnapshot {
  subsystem: string;
  status: "ok" | "error" | "unknown";
  last_success_at: number | null;
  last_error_at: number | null;
  last_latency_ms: number | null;
  last_error: string | null;
}

const registry = new Map<string, HealthSnapshot>();

function ensure(subsystem: string): HealthSnapshot {
  const existing = registry.get(subsystem);
  if (existing) return existing;
  const seed: HealthSnapshot = {
    subsystem,
    status: "unknown",
    last_success_at: null,
    last_error_at: null,
    last_latency_ms: null,
    last_error: null,
  };
  registry.set(subsystem, seed);
  return seed;
}

export function recordHealthSuccess(subsystem: string, latencyMs?: number | null) {
  const state = ensure(subsystem);
  state.status = "ok";
  state.last_success_at = Date.now();
  state.last_error = null;
  state.last_latency_ms = typeof latencyMs === "number" ? Math.max(0, Math.floor(latencyMs)) : state.last_latency_ms;
}

export function recordHealthFailure(subsystem: string, error: unknown, latencyMs?: number | null) {
  const state = ensure(subsystem);
  state.status = "error";
  state.last_error_at = Date.now();
  state.last_error = sanitizeError(error).message;
  state.last_latency_ms = typeof latencyMs === "number" ? Math.max(0, Math.floor(latencyMs)) : state.last_latency_ms;
}

export function getHealthSnapshot(): Record<string, HealthSnapshot> {
  return Object.fromEntries(Array.from(registry.entries()).map(([key, value]) => [key, { ...value }]));
}
