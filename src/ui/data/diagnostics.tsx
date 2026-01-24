import { useMemo, useState, type ReactNode } from "react";
import { DiagnosticsContext, type EngineSnapshot } from "@/ui/data/diagnosticsContext";

export function DiagnosticsProvider({ children }: { children: ReactNode }) {
  const [lastError, setLastErrorState] = useState<string | null>(null);
  const [lastErrorAt, setLastErrorAt] = useState<number | null>(null);
  const [engineSnapshot, setEngineSnapshot] = useState<EngineSnapshot | null>(null);

  const setLastError = (message: string | null) => {
    setLastErrorState(message);
    setLastErrorAt(message ? Date.now() : null);
  };

  const value = useMemo(() => ({
    lastError,
    lastErrorAt,
    setLastError,
    engineSnapshot,
    setEngineSnapshot,
  }), [lastError, lastErrorAt, engineSnapshot]);

  return (
    <DiagnosticsContext.Provider value={value}>
      {children}
    </DiagnosticsContext.Provider>
  );
}
