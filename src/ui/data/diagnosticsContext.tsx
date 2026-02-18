import { createContext } from "react";
import type { OperationState } from "@/lib/ops/operationState";
import type { HealthSnapshot } from "@/lib/observability/health";

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

export interface AuthProbeSnapshot {
  endpoint: "auth_health" | "auth_token" | "auth_login";
  status: number | null;
  request_id: string | null;
  latency_ms: number | null;
  checked_at: number;
  code: string | null;
  message: string | null;
}

export interface DiagnosticsState {
  lastError: string | null;
  lastErrorAt: number | null;
  setLastError: (message: string | null) => void;
  errorHistory: Array<{ message: string; at: number }>;
  engineSnapshot: EngineSnapshot | null;
  setEngineSnapshot: (snapshot: EngineSnapshot | null) => void;
  operations: OperationState[];
  recordOperation: (operation: OperationState) => void;
  healthChecks: Record<string, HealthSnapshot>;
  authProbe: AuthProbeSnapshot | null;
  setAuthProbe: (snapshot: AuthProbeSnapshot | null) => void;
  exportDebugBundle: () => string;
}

export const DiagnosticsContext = createContext<DiagnosticsState | null>(null);
