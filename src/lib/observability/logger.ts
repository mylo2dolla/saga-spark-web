import { redactValue, sanitizeError } from "@/lib/observability/redact";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogPayload {
  scope: string;
  message: string;
  at: string;
  level: LogLevel;
  meta?: Record<string, unknown>;
}

function emit(level: LogLevel, payload: LogPayload) {
  const redacted = redactValue(payload);
  const method = level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : level === "info"
        ? console.info
        : console.debug;
  method(JSON.stringify(redacted));
}

export function createLogger(scope: string) {
  const base = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    emit(level, {
      scope,
      level,
      message,
      at: new Date().toISOString(),
      meta,
    });
  };

  return {
    debug: (message: string, meta?: Record<string, unknown>) => base("debug", message, meta),
    info: (message: string, meta?: Record<string, unknown>) => base("info", message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => base("warn", message, meta),
    error: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
      const normalizedError = error ? sanitizeError(error) : null;
      base("error", message, {
        ...(meta ?? {}),
        ...(normalizedError ? { error: normalizedError } : {}),
      });
    },
  };
}

export const appLogger = createLogger("app");
