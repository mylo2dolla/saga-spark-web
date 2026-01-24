import { createContext } from "react";

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

export interface DiagnosticsState {
  lastError: string | null;
  lastErrorAt: number | null;
  setLastError: (message: string | null) => void;
  engineSnapshot: EngineSnapshot | null;
  setEngineSnapshot: (snapshot: EngineSnapshot | null) => void;
}

export const DiagnosticsContext = createContext<DiagnosticsState | null>(null);
