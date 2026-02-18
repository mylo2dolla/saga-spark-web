/* eslint-disable react-refresh/only-export-components */

/**
 * React context for the unified physics + narrative engine.
 * Provides both game state and world state to all child components.
 */

import { createContext, useContext, type ReactNode, useState, useCallback } from "react";
import { useUnifiedEngine, type UseUnifiedEngineOptions } from "@/hooks/useUnifiedEngine";
import type { 
  Entity, 
  GameAction, 
  GameEvent, 
  Vec2, 
  Faction, 
  Board,
  EngineContext as EngineCtx,
} from "@/engine";
import type {
  CampaignSeed,
  WorldAction,
  WorldEvent,
  NPC,
  Quest,
  Item,
  CharacterProgression,
  Location,
} from "@/engine/narrative/types";
import type { TravelState } from "@/engine/narrative/Travel";
import type { UnifiedState } from "@/engine/UnifiedState";

interface UnifiedEngineContextValue {
  // Engine State
  entities: Entity[];
  currentTurn: Entity | null;
  isInCombat: boolean;
  roundNumber: number;
  board: Board;
  ctx: EngineCtx;
  
  // World State
  unified: UnifiedState;
  npcs: NPC[];
  activeQuests: Quest[];
  availableQuests: Quest[];
  completedQuests: Quest[];
  items: ReadonlyMap<string, Item>;
  campaignInfo: CampaignSeed;
  travelState: TravelState | null;
  locations: Location[];
  
  // Game Actions
  spawn: (params: {
    id?: string;
    name: string;
    faction: Faction;
    position: Vec2;
    hp: number;
    maxHp?: number;
    ac?: number;
    initiative?: number;
    isPlayer?: boolean;
  }) => void;
  dispatch: (action: GameAction) => void;
  tick: (actions?: GameAction[]) => void;
  beginCombat: () => void;
  finishCombat: () => void;
  
  // World Actions
  dispatchWorld: (action: WorldAction) => void;
  addNPC: (npc: NPC) => void;
  talkToNPC: (playerId: string, npcId: string) => void;
  addQuest: (quest: Quest) => void;
  acceptQuest: (playerId: string, questId: string) => void;
  completeQuest: (playerId: string, questId: string) => void;
  addItem: (item: Item) => void;
  discoverLocation: (playerId: string, locationId: string) => void;
  travelTo: (destinationId: string) => void;
  
  // Queries
  getValidMoves: (entityId: string) => Vec2[];
  worldToGrid: (pos: Vec2) => { row: number; col: number };
  gridToWorld: (pos: { row: number; col: number }) => Vec2;
  getProgression: (entityId: string) => CharacterProgression | undefined;
  getNPC: (npcId: string) => NPC | undefined;
  getQuest: (questId: string) => Quest | undefined;
  getItem: (itemId: string) => Item | undefined;
  
  // Event Log
  eventLog: Array<GameEvent | WorldEvent>;
}

const UnifiedEngineReactContext = createContext<UnifiedEngineContextValue | null>(null);

export interface UnifiedEngineProviderProps {
  children: ReactNode;
  campaignSeed: CampaignSeed;
  rows?: number;
  cols?: number;
}

export function UnifiedEngineProvider({ 
  children, 
  campaignSeed,
  rows = 10,
  cols = 12,
}: UnifiedEngineProviderProps) {
  const [eventLog, setEventLog] = useState<Array<GameEvent | WorldEvent>>([]);
  
  const handleGameEvent = useCallback((event: GameEvent) => {
    setEventLog(prev => [...prev.slice(-99), event]);
  }, []);
  
  const handleWorldEvent = useCallback((event: WorldEvent) => {
    setEventLog(prev => [...prev.slice(-99), event]);
  }, []);
  
  const engine = useUnifiedEngine({
    campaignSeed,
    rows,
    cols,
    onGameEvent: handleGameEvent,
    onWorldEvent: handleWorldEvent,
  });
  
  // Add default travel state and locations
  const contextValue: UnifiedEngineContextValue = {
    ...engine,
    eventLog,
    travelState: engine.travelState ?? null,
    locations: engine.locations ?? [],
    travelTo: engine.travelTo ?? (() => {}),
  };
  
  return (
    <UnifiedEngineReactContext.Provider value={contextValue}>
      {children}
    </UnifiedEngineReactContext.Provider>
  );
}

export function useUnifiedEngineContext(): UnifiedEngineContextValue {
  const ctx = useContext(UnifiedEngineReactContext);
  if (!ctx) {
    throw new Error("useUnifiedEngineContext must be used within a UnifiedEngineProvider");
  }
  return ctx;
}

export function useUnifiedEngineOptional(): UnifiedEngineContextValue | null {
  return useContext(UnifiedEngineReactContext);
}
