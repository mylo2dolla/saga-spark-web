import { appLogger } from "@/lib/observability/logger";
import { sanitizeError } from "@/lib/observability/redact";
import { createPendingOperation, type OperationState, withOperationStatus } from "@/lib/ops/operationState";

export interface RunOperationOptions<T> {
  id?: string;
  name: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  signal?: AbortSignal;
  retryable?: (error: unknown) => boolean;
  onUpdate?: (state: OperationState) => void;
  run: (context: { attempt: number; signal: AbortSignal }) => Promise<T>;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 350;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new DOMException("Operation aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });

function createTimeoutController(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timeoutTriggered = false;
  const timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    wasTimeout: () => timeoutTriggered,
    cleanup: () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

function defaultRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("edge_fetch_failed") ||
    message.includes("temporary")
  );
}

export async function runOperation<T>(options: RunOperationOptions<T>): Promise<{ result: T; state: OperationState }> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES));
  const retryBaseMs = Math.max(100, Math.floor(options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS));
  const retryable = options.retryable ?? defaultRetryable;
  const baseOperation = createPendingOperation(options.name, options.id);

  let operation = baseOperation;
  options.onUpdate?.(operation);
  appLogger.info("operation.pending", { id: operation.id, name: operation.name });

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const timeoutController = createTimeoutController(options.signal, timeoutMs);
    const signal = timeoutController.signal;
    operation = withOperationStatus(operation, {
      status: "RUNNING",
      attempt,
      error_code: null,
      error_message: null,
      next_retry_at: null,
    });
    options.onUpdate?.(operation);

    try {
      const result = await options.run({ attempt, signal });
      operation = withOperationStatus(operation, {
        status: "SUCCESS",
        ended_at: Date.now(),
        next_retry_at: null,
      });
      options.onUpdate?.(operation);
      appLogger.info("operation.success", {
        id: operation.id,
        name: operation.name,
        attempt,
        duration_ms: operation.ended_at ? operation.ended_at - operation.started_at : null,
      });
      return { result, state: operation };
    } catch (error) {
      if (signal.aborted) {
        const timeoutHit = timeoutController.wasTimeout();
        operation = withOperationStatus(operation, {
          status: timeoutHit ? "FAILED" : "CANCELLED",
          ended_at: Date.now(),
          error_code: timeoutHit ? "timeout" : "cancelled",
          error_message: timeoutHit ? `Operation timed out after ${timeoutMs}ms` : "Operation cancelled",
          next_retry_at: null,
        });
        options.onUpdate?.(operation);
        appLogger.warn("operation.cancelled", { id: operation.id, name: operation.name, attempt, timeout: timeoutHit });
        throw new Error(timeoutHit ? `Operation timed out after ${timeoutMs}ms` : "Operation cancelled");
      }

      const normalized = sanitizeError(error);
      const isRetryable = attempt <= maxRetries && retryable(error);
      if (!isRetryable) {
        operation = withOperationStatus(operation, {
          status: "FAILED",
          ended_at: Date.now(),
          error_code: normalized.code,
          error_message: normalized.message,
          next_retry_at: null,
        });
        options.onUpdate?.(operation);
        appLogger.error("operation.failed", error, {
          id: operation.id,
          name: operation.name,
          attempt,
        });
        throw error instanceof Error ? error : new Error(normalized.message);
      }

      const waitMs = Math.min(8_000, retryBaseMs * 2 ** (attempt - 1));
      operation = withOperationStatus(operation, {
        status: "RUNNING",
        error_code: normalized.code,
        error_message: normalized.message,
        next_retry_at: Date.now() + waitMs,
      });
      options.onUpdate?.(operation);
      appLogger.warn("operation.retrying", {
        id: operation.id,
        name: operation.name,
        attempt,
        wait_ms: waitMs,
      });
      await sleep(waitMs, signal);
    } finally {
      timeoutController.cleanup();
    }
  }

  throw new Error("Operation failed after retries");
}
