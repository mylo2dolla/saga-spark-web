/**
 * GameState module - the single source of truth.
 * Pure functions only - no mutations.
 */

import type { 
  GameState, 
  Entity, 
  Board, 
  TurnOrder, 
  GameEvent,
  GameAction,
  EngineConfig,
  Vec2
} from "./types";
import { createBoard } from "./Board";
import { getAliveEntities, tickStatusEffects } from "./Entity";

// ============= Initial State Factory =============

export function createInitialState(
  entities: Entity[],
  boardRows: number = 10,
  boardCols: number = 12,
  cellSize: number = 1
): GameState {
  const entityMap = new Map<string, Entity>();
  for (const entity of entities) {
    entityMap.set(entity.id, entity);
  }
  
  // Sort by initiative for turn order
  const sortedByInitiative = [...entities]
    .filter(e => e.isAlive)
    .sort((a, b) => b.initiative - a.initiative);
  
  return {
    tick: 0,
    entities: entityMap,
    board: createBoard(boardRows, boardCols, cellSize),
    turnOrder: {
      order: sortedByInitiative.map(e => e.id),
      currentIndex: 0,
      roundNumber: 1,
    },
    isInCombat: false,
    pendingEvents: [],
  };
}

// ============= State Updates =============

export function incrementTick(state: GameState): GameState {
  return { ...state, tick: state.tick + 1 };
}

export function updateEntity(state: GameState, entity: Entity): GameState {
  const newEntities = new Map(state.entities);
  newEntities.set(entity.id, entity);
  return { ...state, entities: newEntities };
}

export function updateEntities(state: GameState, entities: ReadonlyMap<string, Entity>): GameState {
  return { ...state, entities };
}

export function removeEntity(state: GameState, entityId: string): GameState {
  const newEntities = new Map(state.entities);
  newEntities.delete(entityId);
  
  // Remove from turn order
  const newOrder = state.turnOrder.order.filter(id => id !== entityId);
  let newIndex = state.turnOrder.currentIndex;
  if (newIndex >= newOrder.length) {
    newIndex = 0;
  }
  
  return {
    ...state,
    entities: newEntities,
    turnOrder: { ...state.turnOrder, order: newOrder, currentIndex: newIndex },
  };
}

export function addEntity(state: GameState, entity: Entity): GameState {
  const newEntities = new Map(state.entities);
  newEntities.set(entity.id, entity);
  
  // Add to turn order in initiative order
  const newOrder = [...state.turnOrder.order, entity.id];
  const aliveEntities = Array.from(newEntities.values()).filter(e => e.isAlive);
  const sortedOrder = newOrder.sort((a, b) => {
    const entityA = newEntities.get(a);
    const entityB = newEntities.get(b);
    return (entityB?.initiative ?? 0) - (entityA?.initiative ?? 0);
  });
  
  return {
    ...state,
    entities: newEntities,
    turnOrder: { ...state.turnOrder, order: sortedOrder },
  };
}

export function updateBoard(state: GameState, board: Board): GameState {
  return { ...state, board };
}

export function setCombatActive(state: GameState, active: boolean): GameState {
  if (active && !state.isInCombat) {
    // Starting combat - re-roll initiative order
    const aliveEntities = getAliveEntities(state.entities);
    const sortedByInitiative = [...aliveEntities].sort((a, b) => b.initiative - a.initiative);
    
    return {
      ...state,
      isInCombat: true,
      turnOrder: {
        order: sortedByInitiative.map(e => e.id),
        currentIndex: 0,
        roundNumber: 1,
      },
    };
  }
  
  return { ...state, isInCombat: active };
}

export function addEvents(state: GameState, events: readonly GameEvent[]): GameState {
  return { ...state, pendingEvents: [...state.pendingEvents, ...events] };
}

export function clearEvents(state: GameState): GameState {
  return { ...state, pendingEvents: [] };
}

// ============= Turn Management =============

export function getCurrentTurnEntity(state: GameState): Entity | null {
  if (!state.isInCombat) return null;
  const id = state.turnOrder.order[state.turnOrder.currentIndex];
  return state.entities.get(id) ?? null;
}

export function advanceTurn(state: GameState): { state: GameState; events: GameEvent[] } {
  if (!state.isInCombat) return { state, events: [] };
  
  const events: GameEvent[] = [];
  const currentEntity = getCurrentTurnEntity(state);
  
  if (currentEntity) {
    events.push({
      type: "turn_ended",
      entityId: currentEntity.id,
      description: `${currentEntity.name}'s turn ended`,
    });
  }
  
  let newIndex = state.turnOrder.currentIndex + 1;
  let newRound = state.turnOrder.roundNumber;
  
  // Skip dead entities
  while (newIndex < state.turnOrder.order.length) {
    const entityId = state.turnOrder.order[newIndex];
    const entity = state.entities.get(entityId);
    if (entity?.isAlive) break;
    newIndex++;
  }
  
  // Check for new round
  if (newIndex >= state.turnOrder.order.length) {
    newIndex = 0;
    newRound++;
    
    // Skip dead entities at start of round
    while (newIndex < state.turnOrder.order.length) {
      const entityId = state.turnOrder.order[newIndex];
      const entity = state.entities.get(entityId);
      if (entity?.isAlive) break;
      newIndex++;
    }
    
    events.push({
      type: "round_started",
      value: newRound,
      description: `Round ${newRound} begins!`,
    });
  }
  
  const newTurnEntity = state.entities.get(state.turnOrder.order[newIndex]);
  if (newTurnEntity) {
    events.push({
      type: "turn_started",
      entityId: newTurnEntity.id,
      description: `${newTurnEntity.name}'s turn`,
    });
  }
  
  return {
    state: {
      ...state,
      turnOrder: {
        ...state.turnOrder,
        currentIndex: newIndex,
        roundNumber: newRound,
      },
    },
    events,
  };
}

// ============= Status Effect Processing =============

export function processStartOfTurn(state: GameState): { state: GameState; events: GameEvent[] } {
  const currentEntity = getCurrentTurnEntity(state);
  if (!currentEntity) return { state, events: [] };
  
  const events: GameEvent[] = [];
  const { entity: updatedEntity, damage, healing } = tickStatusEffects(currentEntity);
  
  if (damage > 0) {
    events.push({
      type: "entity_damaged",
      entityId: currentEntity.id,
      value: damage,
      description: `${currentEntity.name} takes ${damage} damage from status effects`,
    });
  }
  
  if (healing > 0) {
    events.push({
      type: "entity_healed",
      entityId: currentEntity.id,
      value: healing,
      description: `${currentEntity.name} heals ${healing} from status effects`,
    });
  }
  
  if (!updatedEntity.isAlive) {
    events.push({
      type: "entity_died",
      entityId: currentEntity.id,
      description: `${currentEntity.name} has been defeated!`,
    });
  }
  
  return {
    state: updateEntity(state, updatedEntity),
    events,
  };
}

// ============= Validation =============

export function isValidAction(state: GameState, action: GameAction): boolean {
  const currentEntity = getCurrentTurnEntity(state);
  
  switch (action.type) {
    case "move":
    case "attack":
    case "ability":
      // Only the current turn entity can act
      if (!state.isInCombat) return true;
      if (!currentEntity) return false;
      return action.type === "move" 
        ? action.entityId === currentEntity.id
        : action.type === "attack"
        ? action.attackerId === currentEntity.id
        : action.casterId === currentEntity.id;
    
    case "end_turn":
      if (!state.isInCombat) return false;
      return action.entityId === currentEntity?.id;
    
    default:
      return false;
  }
}

// ============= Serialization =============

export function serializeState(state: GameState): string {
  return JSON.stringify({
    tick: state.tick,
    entities: Array.from(state.entities.entries()),
    board: state.board,
    turnOrder: state.turnOrder,
    isInCombat: state.isInCombat,
  });
}

export function deserializeState(json: string): GameState {
  const data = JSON.parse(json);
  return {
    tick: data.tick,
    entities: new Map(data.entities),
    board: data.board,
    turnOrder: data.turnOrder,
    isInCombat: data.isInCombat,
    pendingEvents: [],
  };
}
