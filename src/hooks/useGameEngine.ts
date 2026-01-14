/**
 * React hook to integrate the physics-based combat engine with UI.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  createEngine,
  createEntity,
  gameTick,
  processAction,
  startCombat,
  endCombat,
  getEntities,
  getCurrentTurn,
  getValidMoves,
  getEvents,
  spawnEntity,
  gridToWorld,
  worldToGrid,
  type EngineContext,
  type Entity,
  type GameAction,
  type GameEvent,
  type Vec2,
  type Faction,
} from "@/engine";

export interface UseGameEngineOptions {
  rows?: number;
  cols?: number;
  cellSize?: number;
  onEvent?: (event: GameEvent) => void;
}

export function useGameEngine(options: UseGameEngineOptions = {}) {
  const { rows = 10, cols = 12, cellSize = 1, onEvent } = options;
  
  const [ctx, setCtx] = useState<EngineContext>(() => 
    createEngine([], rows, cols)
  );
  
  const animationRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  
  // Process events
  useEffect(() => {
    const events = getEvents(ctx);
    if (onEvent) {
      events.forEach(onEvent);
    }
  }, [ctx, onEvent]);
  
  // Spawn entity
  const spawn = useCallback((params: {
    id?: string;
    name: string;
    faction: Faction;
    position: Vec2;
    hp: number;
    maxHp?: number;
    ac?: number;
    initiative?: number;
  }) => {
    setCtx(prev => spawnEntity(prev, params));
  }, []);
  
  // Dispatch action
  const dispatch = useCallback((action: GameAction) => {
    setCtx(prev => processAction(prev, action));
  }, []);
  
  // Start/end combat
  const beginCombat = useCallback(() => {
    setCtx(prev => startCombat(prev));
  }, []);
  
  const finishCombat = useCallback(() => {
    setCtx(prev => endCombat(prev));
  }, []);
  
  // Run physics tick
  const tick = useCallback((actions: GameAction[] = []) => {
    setCtx(prev => gameTick(prev, actions));
  }, []);
  
  // Animation loop for continuous physics
  const startPhysicsLoop = useCallback(() => {
    const loop = (time: number) => {
      if (lastTimeRef.current) {
        const dt = Math.min((time - lastTimeRef.current) / 1000, 0.1);
        tick([]);
      }
      lastTimeRef.current = time;
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
  }, [tick]);
  
  const stopPhysicsLoop = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
  }, []);
  
  // Cleanup
  useEffect(() => {
    return () => stopPhysicsLoop();
  }, [stopPhysicsLoop]);
  
  // Derived state
  const entities = getEntities(ctx);
  const currentTurn = getCurrentTurn(ctx);
  const isInCombat = ctx.state.isInCombat;
  const roundNumber = ctx.state.turnOrder.roundNumber;
  const board = ctx.state.board;
  
  return {
    // State
    entities,
    currentTurn,
    isInCombat,
    roundNumber,
    board,
    ctx,
    
    // Actions
    spawn,
    dispatch,
    tick,
    beginCombat,
    finishCombat,
    
    // Physics loop
    startPhysicsLoop,
    stopPhysicsLoop,
    
    // Queries
    getValidMoves: (entityId: string) => getValidMoves(ctx, entityId),
    worldToGrid: (pos: Vec2) => worldToGrid(pos, cellSize),
    gridToWorld: (pos: { row: number; col: number }) => gridToWorld(pos, cellSize),
  };
}
