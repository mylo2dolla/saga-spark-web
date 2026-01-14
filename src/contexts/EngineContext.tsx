/**
 * React context for the physics-based combat engine.
 * Provides engine state and actions to all child components.
 */

import { createContext, useContext, type ReactNode } from "react";
import { useGameEngine, type UseGameEngineOptions } from "@/hooks/useGameEngine";
import type { Entity, GameAction, GameEvent, Vec2, Faction, Board, EngineContext as EngineCtx } from "@/engine";

interface EngineContextValue {
  // State (derived from engine)
  entities: Entity[];
  currentTurn: Entity | undefined;
  isInCombat: boolean;
  roundNumber: number;
  board: Board;
  ctx: EngineCtx;
  
  // Actions
  spawn: (params: {
    id?: string;
    name: string;
    faction: Faction;
    position: Vec2;
    hp: number;
    maxHp?: number;
    ac?: number;
    initiative?: number;
  }) => void;
  dispatch: (action: GameAction) => void;
  beginCombat: () => void;
  finishCombat: () => void;
  tick: (actions?: GameAction[]) => void;
  
  // Queries
  getValidMoves: (entityId: string) => Vec2[];
  worldToGrid: (pos: Vec2) => { row: number; col: number };
  gridToWorld: (pos: { row: number; col: number }) => Vec2;
}

const EngineReactContext = createContext<EngineContextValue | null>(null);

export interface EngineProviderProps {
  children: ReactNode;
  options?: UseGameEngineOptions;
  onEvent?: (event: GameEvent) => void;
}

export function EngineProvider({ children, options, onEvent }: EngineProviderProps) {
  const engine = useGameEngine({
    ...options,
    onEvent,
  });
  
  return (
    <EngineReactContext.Provider value={engine}>
      {children}
    </EngineReactContext.Provider>
  );
}

export function useEngine(): EngineContextValue {
  const ctx = useContext(EngineReactContext);
  if (!ctx) {
    throw new Error("useEngine must be used within an EngineProvider");
  }
  return ctx;
}

export function useEngineOptional(): EngineContextValue | null {
  return useContext(EngineReactContext);
}
