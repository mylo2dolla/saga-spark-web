/**
 * React hook for the unified physics + narrative engine.
 * Bridges combat events to narrative systems automatically.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  createEngine,
  processAction,
  startCombat,
  endCombat,
  getEntities,
  getCurrentTurn,
  getValidMoves,
  getEvents,
  spawnEntity,
  gameTick,
  gridToWorld,
  worldToGrid,
  type EngineContext,
  type Entity,
  type GameAction,
  type GameEvent,
  type Vec2,
  type Faction,
} from "@/engine";
import {
  createUnifiedState,
  updateGameState,
  processCombatKill,
  processCombatDamage,
  processDiscovery,
  calculateEntityStats,
  addWorldEvents,
  clearWorldEvents,
  type UnifiedState,
  type CalculatedStats,
} from "@/engine/UnifiedState";
import type { 
  CampaignSeed, 
  WorldAction, 
  WorldEvent,
  NPC,
  Quest,
  Item,
  Inventory,
  Equipment,
  EnhancedStatus,
  CharacterProgression,
} from "@/engine/narrative/types";
import * as World from "@/engine/narrative/World";
import * as NPCModule from "@/engine/narrative/NPC";
import * as ItemModule from "@/engine/narrative/Item";
import * as StatusModule from "@/engine/narrative/Status";

export interface UseUnifiedEngineOptions {
  rows?: number;
  cols?: number;
  cellSize?: number;
  campaignSeed: CampaignSeed;
  onGameEvent?: (event: GameEvent) => void;
  onWorldEvent?: (event: WorldEvent) => void;
}

export function useUnifiedEngine(options: UseUnifiedEngineOptions) {
  const { 
    rows = 10, 
    cols = 12, 
    cellSize = 1, 
    campaignSeed,
    onGameEvent, 
    onWorldEvent 
  } = options;
  
  const [ctx, setCtx] = useState<EngineContext>(() => 
    createEngine([], rows, cols)
  );
  
  const [unified, setUnified] = useState<UnifiedState>(() =>
    createUnifiedState(campaignSeed, [], rows, cols)
  );
  
  // Keep unified game state in sync with engine context
  useEffect(() => {
    setUnified(prev => updateGameState(prev, ctx.state));
  }, [ctx.state]);
  
  // Process game events and bridge to narrative
  useEffect(() => {
    const events = getEvents(ctx);
    
    for (const event of events) {
      onGameEvent?.(event);
      
      // Bridge combat events to narrative
      if (event.type === "entity_died" && event.entityId) {
        const entity = ctx.state.entities.get(event.entityId);
        if (entity) {
          // Find who killed them (last attacker)
          const killer = Array.from(ctx.state.entities.values())
            .find(e => e.faction === "player" && e.isAlive);
          
          if (killer) {
            const result = processCombatKill(
              unified, 
              killer.id, 
              event.entityId, 
              entity.name
            );
            setUnified(result.state);
            result.narrativeEvents.forEach(e => onWorldEvent?.(e));
          }
        }
      }
      
      if (event.type === "entity_damaged" && event.entityId && event.value) {
        const result = processCombatDamage(
          unified,
          event.entityId,
          event.value,
          event.targetId
        );
        setUnified(result.state);
        result.narrativeEvents.forEach(e => onWorldEvent?.(e));
      }
    }
  }, [ctx, unified, onGameEvent, onWorldEvent]);
  
  // Spawn entity with narrative data
  const spawn = useCallback((params: {
    id?: string;
    name: string;
    faction: Faction;
    position: Vec2;
    hp: number;
    maxHp?: number;
    ac?: number;
    initiative?: number;
    isPlayer?: boolean;
  }) => {
    setCtx(prev => spawnEntity(prev, params));
    
    // Initialize player progression if this is a player
    if (params.isPlayer) {
      setUnified(prev => ({
        ...prev,
        world: World.initPlayerProgression(prev.world, params.id ?? params.name),
      }));
    }
  }, []);
  
  // Dispatch game action
  const dispatch = useCallback((action: GameAction) => {
    setCtx(prev => processAction(prev, action));
  }, []);
  
  // Dispatch world action
  const dispatchWorld = useCallback((action: WorldAction) => {
    setUnified(prev => {
      const result = World.processWorldAction(prev.world, action);
      result.events.forEach(e => onWorldEvent?.(e));
      return { ...prev, world: result.world };
    });
  }, [onWorldEvent]);
  
  // Combat controls
  const beginCombat = useCallback(() => {
    setCtx(prev => startCombat(prev));
  }, []);
  
  const finishCombat = useCallback(() => {
    setCtx(prev => endCombat(prev));
  }, []);
  
  // Run tick
  const tick = useCallback((actions: GameAction[] = []) => {
    setCtx(prev => gameTick(prev, actions));
    
    // Also tick world time and quests
    setUnified(prev => {
      const advancedWorld = World.advanceTime(prev.world, 1);
      const questResult = World.tickAllQuests(advancedWorld);
      questResult.events.forEach(e => onWorldEvent?.(e));
      return { ...prev, world: questResult.world };
    });
  }, [onWorldEvent]);
  
  // NPC Management
  const addNPC = useCallback((npc: NPC) => {
    setUnified(prev => ({
      ...prev,
      world: World.addNPC(prev.world, npc),
    }));
  }, []);
  
  const talkToNPC = useCallback((playerId: string, npcId: string) => {
    dispatchWorld({
      type: "talk",
      entityId: playerId,
      targetId: npcId,
    });
  }, [dispatchWorld]);
  
  // Quest Management
  const addQuest = useCallback((quest: Quest) => {
    setUnified(prev => ({
      ...prev,
      world: World.addQuest(prev.world, quest),
    }));
  }, []);
  
  const acceptQuest = useCallback((playerId: string, questId: string) => {
    dispatchWorld({
      type: "accept_quest",
      entityId: playerId,
      questId,
    });
  }, [dispatchWorld]);
  
  const completeQuest = useCallback((playerId: string, questId: string) => {
    dispatchWorld({
      type: "complete_quest",
      entityId: playerId,
      questId,
    });
  }, [dispatchWorld]);
  
  // Item Management
  const addItem = useCallback((item: Item) => {
    setUnified(prev => ({
      ...prev,
      world: World.addItem(prev.world, item),
    }));
  }, []);
  
  // Location discovery
  const discoverLocation = useCallback((playerId: string, locationId: string) => {
    const result = processDiscovery(unified, playerId, locationId);
    setUnified(result.state);
    result.narrativeEvents.forEach(e => onWorldEvent?.(e));
  }, [unified, onWorldEvent]);
  
  // Derived state
  const entities = getEntities(ctx);
  const currentTurn = getCurrentTurn(ctx);
  const isInCombat = ctx.state.isInCombat;
  const roundNumber = ctx.state.turnOrder.roundNumber;
  const board = ctx.state.board;
  
  // World state helpers
  const npcs = Array.from(unified.world.npcs.values());
  const activeQuests = World.getActiveQuests(unified.world);
  const availableQuests = World.getAvailableQuests(unified.world);
  const completedQuests = World.getCompletedQuests(unified.world);
  const items = unified.world.items;
  const campaignInfo = unified.world.campaignSeed;
  
  return {
    // Engine State
    entities,
    currentTurn,
    isInCombat,
    roundNumber,
    board,
    ctx,
    
    // World State
    unified,
    npcs,
    activeQuests,
    availableQuests,
    completedQuests,
    items,
    campaignInfo,
    
    // Game Actions
    spawn,
    dispatch,
    tick,
    beginCombat,
    finishCombat,
    
    // World Actions
    dispatchWorld,
    addNPC,
    talkToNPC,
    addQuest,
    acceptQuest,
    completeQuest,
    addItem,
    discoverLocation,
    
    // Queries
    getValidMoves: (entityId: string) => getValidMoves(ctx, entityId),
    worldToGrid: (pos: Vec2) => worldToGrid(pos, cellSize),
    gridToWorld: (pos: { row: number; col: number }) => gridToWorld(pos, cellSize),
    getProgression: (entityId: string) => unified.world.playerProgression.get(entityId),
    getNPC: (npcId: string) => unified.world.npcs.get(npcId),
    getQuest: (questId: string) => unified.world.quests.get(questId),
    getItem: (itemId: string) => unified.world.items.get(itemId),
  };
}
