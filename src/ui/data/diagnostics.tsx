import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface EngineSnapshot {
  state?: string;
  locationId?: string | null;
  locationName?: string | null;
  destinationsCount?: number;
  campaignId?: string | null;
  campaignSeedId?: string | null;
  campaignSeedTitle?: string | null;
  knownLocations?: string[];
  storyFlags?: string[];
  activeQuests?: string[];
  travel?: {
    currentLocationId: string | null;
    isInTransit: boolean;
    transitProgress: number;
  };
  combatState?: string | null;
}

interface DiagnosticsState {
  lastError: string | null;
  lastErrorAt: number | null;
  setLastError: (message: string | null) => void;
  engineSnapshot: EngineSnapshot | null;
  setEngineSnapshot: (snapshot: EngineSnapshot | null) => void;
}

const DiagnosticsContext = createContext<DiagnosticsState | null>(null);

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

export function useDiagnostics() {
  const ctx = useContext(DiagnosticsContext);
  if (!ctx) {
    throw new Error("useDiagnostics must be used within DiagnosticsProvider");
  }
  return ctx;
}
