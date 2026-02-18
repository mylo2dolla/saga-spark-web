import { redactValue, sanitizeError } from "./redact.ts";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogPayload {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
  data?: Record<string, unknown>;
  error?: {
    message: string;
    code: string | null;
  };
}

function emit(payload: LogPayload) {
  const serialized = JSON.stringify(redactValue(payload));
  switch (payload.level) {
    case "error":
      console.error(serialized);
      return;
    case "warn":
      console.warn(serialized);
      return;
    default:
      console.log(serialized);
  }
}

export function createLogger(scope: string) {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      emit({ ts: new Date().toISOString(), level: "debug", scope, message, data });
    },
    info(message: string, data?: Record<string, unknown>) {
      emit({ ts: new Date().toISOString(), level: "info", scope, message, data });
    },
    warn(message: string, data?: Record<string, unknown>) {
      emit({ ts: new Date().toISOString(), level: "warn", scope, message, data });
    },
    error(message: string, error: unknown, data?: Record<string, unknown>) {
      emit({
        ts: new Date().toISOString(),
        level: "error",
        scope,
        message,
        data,
        error: sanitizeError(error),
      });
    },
  };
}

