import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DiagnosticsContext, type AuthProbeSnapshot, type EngineSnapshot } from "@/ui/data/diagnosticsContext";
import type { OperationState } from "@/lib/ops/operationState";
import { getNetworkSnapshot } from "@/ui/data/networkHealth";
import { getHealthSnapshot } from "@/lib/observability/health";
import type { HealthSnapshot } from "@/lib/observability/health";
import { redactValue } from "@/lib/observability/redact";

const MAX_OPERATION_HISTORY = 120;
const MAX_ERROR_HISTORY = 80;

export function DiagnosticsProvider({ children }: { children: ReactNode }) {
  const [lastError, setLastErrorState] = useState<string | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<number | null>(null);
  const [errorHistory, setErrorHistory] = useState<Array<{ message: string; at: number }>>([]);
  const [engineSnapshot, setEngineSnapshot] = useState<EngineSnapshot | null>(null);
  const [operations, setOperations] = useState<OperationState[]>([]);
  const [healthChecks, setHealthChecks] = useState<Record<string, HealthSnapshot>>(
    getHealthSnapshot(),
  );
  const [authProbe, setAuthProbe] = useState<AuthProbeSnapshot | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      setHealthChecks(getHealthSnapshot());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const setLastError = useCallback((message: string | null) => {
    const at = message ? Date.now() : null;
    setLastErrorState(message);
    setLastErrorAt(at);
    if (message && at) {
      setErrorHistory((prev) => [{ message, at }, ...prev].slice(0, MAX_ERROR_HISTORY));
    }
  }, []);

  const recordOperation = useCallback((operation: OperationState) => {
    setOperations((prev) => {
      const idx = prev.findIndex((entry) => entry.id === operation.id);
      if (idx === -1) {
        return [operation, ...prev].slice(0, MAX_OPERATION_HISTORY);
      }
      const next = [...prev];
      next[idx] = operation;
      return next;
    });
  }, []);

  const exportDebugBundle = useCallback(() => {
    const network = getNetworkSnapshot();
    const healthChecks = getHealthSnapshot();
    const payload = redactValue({
      generated_at: new Date().toISOString(),
      app: {
        mode: import.meta.env.DEV ? "development" : "production",
        version: import.meta.env.VITE_APP_VERSION ?? "0.0.0",
        git_sha: import.meta.env.VITE_GIT_SHA ?? "unknown",
        build_time: import.meta.env.VITE_BUILD_TIME ?? null,
      },
      env: {
        supabase_url: import.meta.env.VITE_SUPABASE_URL ?? null,
        has_supabase_anon_key: Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY),
        has_openai_key: Boolean(import.meta.env.VITE_OPENAI_API_KEY),
        has_groq_key: Boolean(import.meta.env.VITE_GROQ_API_KEY),
      },
      runtime: {
        href: typeof window !== "undefined" ? window.location.href : null,
      },
      diagnostics: {
        last_error: lastError,
        last_error_at: lastErrorAt,
        error_history: errorHistory,
        engine_snapshot: engineSnapshot,
        auth_probe: authProbe,
        operations: operations.slice(0, 80),
        health_checks: getHealthSnapshot(),
        network,
      },
    });
    return JSON.stringify(payload, null, 2);
  }, [authProbe, engineSnapshot, errorHistory, lastError, lastErrorAt, operations]);

  const value = useMemo(() => ({
    lastError,
    lastErrorAt,
    setLastError,
    errorHistory,
    engineSnapshot,
    setEngineSnapshot,
    operations,
    recordOperation,
    healthChecks,
    authProbe,
    setAuthProbe,
    exportDebugBundle,
  }), [
    authProbe,
    errorHistory,
    engineSnapshot,
    exportDebugBundle,
    healthChecks,
    lastError,
    lastErrorAt,
    operations,
    recordOperation,
    setLastError,
  ]);

  return (
    <DiagnosticsContext.Provider value={value}>
      {children}
    </DiagnosticsContext.Provider>
  );
}
