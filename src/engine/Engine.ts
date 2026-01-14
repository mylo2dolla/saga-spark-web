/**
 * Engine - the main orchestrator that processes actions and updates state.
 * Pure functions only - no mutations.
 */

import type { 
  GameState, 
  GameAction, 
  GameEvent, 
  EngineConfig,
  Vec2,
  Entity
} from "./types";
import { DEFAULT_CONFIG, vec2, worldToGrid, gridToWorld } from "./types";
import { 
  createInitialState, 
  updateEntity, 
  updateEntities, 
  addEvents, 
  clearEvents,
  advanceTurn,
  processStartOfTurn,
  getCurrentTurnEntity,
  setCombatActive,
  incrementTick,
  isValidAction
} from "./GameState";
import { findPath, getReachableTiles, getTileAt } from "./Board";
import { moveTowards, physicsStep, applyImpulse } from "./Physics";
import { resolveCombatAttack, isCombatOver } from "./Combat";
import { createEntity, getMovementSpeed } from "./Entity";

// ============= Engine State =============

export interface EngineContext {
  readonly state: GameState;
  readonly config: EngineConfig;
  readonly seed: number;
}

export function createEngine(
  entities: Entity[],
  rows?: number,
  cols?: number,
  config: EngineConfig = DEFAULT_CONFIG
): EngineContext {
  return {
    state: createInitialState(entities, rows, cols),
    config,
    seed: Date.now(),
  };
}

// ============= Action Processing =============

export function processAction(
  ctx: EngineContext,
  action: GameAction
): EngineContext {
  if (!isValidAction(ctx.state, action)) {
    console.warn("Invalid action:", action);
    return ctx;
  }
  
  let state = ctx.state;
  let events: GameEvent[] = [];
  
  switch (action.type) {
    case "move": {
      const entity = state.entities.get(action.entityId);
      if (!entity) break;
      
      // Calculate path and move towards target
      const currentGrid = worldToGrid(entity.position, state.board.cellSize);
      const targetGrid = worldToGrid(action.targetPosition, state.board.cellSize);
      
      const path = findPath(state.board, currentGrid, targetGrid, state.entities, entity.id);
      
      if (path && path.length > 1) {
        // Move to next tile in path
        const nextTile = path[1];
        const targetPos = gridToWorld(nextTile, state.board.cellSize);
        const updatedEntity = moveTowards(entity, targetPos, getMovementSpeed(entity));
        state = updateEntity(state, updatedEntity);
        
        events.push({
          type: "entity_moved",
          entityId: entity.id,
          position: updatedEntity.position,
          description: `${entity.name} moved`,
        });
        
        // Check for terrain damage
        const tile = getTileAt(state.board, nextTile);
        if (tile?.damageOnEnter) {
          const damaged = { ...updatedEntity, hp: updatedEntity.hp - tile.damageOnEnter };
          state = updateEntity(state, damaged);
          events.push({
            type: "entity_damaged",
            entityId: entity.id,
            value: tile.damageOnEnter,
            description: `${entity.name} takes ${tile.damageOnEnter} damage from ${tile.terrain}!`,
          });
        }
      }
      break;
    }
    
    case "attack": {
      const result = resolveCombatAttack(
        state.entities,
        action.attackerId,
        action.targetId,
        action.damageRoll,
        ctx.seed,
        ctx.config
      );
      state = updateEntities(state, result.entities);
      events.push(...result.events);
      break;
    }
    
    case "ability": {
      // Placeholder for ability system
      events.push({
        type: "entity_moved",
        entityId: action.casterId,
        description: `${action.casterId} used ability ${action.abilityId}`,
      });
      break;
    }
    
    case "end_turn": {
      const result = advanceTurn(state);
      state = result.state;
      events.push(...result.events);
      
      // Process start of new turn
      const turnStart = processStartOfTurn(state);
      state = turnStart.state;
      events.push(...turnStart.events);
      break;
    }
  }
  
  // Check for combat end
  if (state.isInCombat) {
    const combatResult = isCombatOver(state.entities);
    if (combatResult.over) {
      state = setCombatActive(state, false);
      events.push({
        type: "combat_ended",
        description: combatResult.winner 
          ? `Combat ended! ${combatResult.winner === "player" ? "Players" : "Enemies"} win!`
          : "Combat ended in a draw!",
      });
    }
  }
  
  state = addEvents(state, events);
  
  return {
    ...ctx,
    state,
    seed: ctx.seed + 1,
  };
}

// ============= Physics Tick =============

export function physicsTick(ctx: EngineContext, dt: number = 1/60): EngineContext {
  const { entities, events } = physicsStep(
    ctx.state.entities,
    ctx.state.board,
    dt,
    ctx.config
  );
  
  let state = updateEntities(ctx.state, entities);
  state = incrementTick(state);
  
  if (events.length > 0) {
    state = addEvents(state, events);
  }
  
  return { ...ctx, state };
}

// ============= Game Loop =============

export function gameTick(ctx: EngineContext, actions: GameAction[]): EngineContext {
  // Clear previous events
  let newCtx: EngineContext = { ...ctx, state: clearEvents(ctx.state) };
  
  // Process all pending actions
  for (const action of actions) {
    newCtx = processAction(newCtx, action);
  }
  
  // Run physics
  newCtx = physicsTick(newCtx);
  
  return newCtx;
}

// ============= State Queries =============

export function getState(ctx: EngineContext): GameState {
  return ctx.state;
}

export function getEntities(ctx: EngineContext): Entity[] {
  return Array.from(ctx.state.entities.values());
}

export function getEntity(ctx: EngineContext, id: string): Entity | undefined {
  return ctx.state.entities.get(id);
}

export function getCurrentTurn(ctx: EngineContext): Entity | null {
  return getCurrentTurnEntity(ctx.state);
}

export function getValidMoves(ctx: EngineContext, entityId: string): Vec2[] {
  const entity = ctx.state.entities.get(entityId);
  if (!entity) return [];
  
  const currentGrid = worldToGrid(entity.position, ctx.state.board.cellSize);
  const speed = getMovementSpeed(entity);
  const reachable = getReachableTiles(
    ctx.state.board,
    currentGrid,
    speed,
    ctx.state.entities,
    entityId
  );
  
  return reachable.map(g => gridToWorld(g, ctx.state.board.cellSize));
}

export function getEvents(ctx: EngineContext): readonly GameEvent[] {
  return ctx.state.pendingEvents;
}

// ============= Combat Control =============

export function startCombat(ctx: EngineContext): EngineContext {
  const state = setCombatActive(ctx.state, true);
  const events: GameEvent[] = [{
    type: "round_started",
    value: 1,
    description: "Combat begins! Roll initiative!",
  }];
  
  const currentEntity = getCurrentTurnEntity(state);
  if (currentEntity) {
    events.push({
      type: "turn_started",
      entityId: currentEntity.id,
      description: `${currentEntity.name}'s turn`,
    });
  }
  
  return {
    ...ctx,
    state: addEvents(state, events),
  };
}

export function endCombat(ctx: EngineContext): EngineContext {
  return {
    ...ctx,
    state: setCombatActive(ctx.state, false),
  };
}

// ============= Entity Management =============

export function spawnEntity(
  ctx: EngineContext,
  params: Parameters<typeof createEntity>[0]
): EngineContext {
  const entity = createEntity(params);
  const newEntities = new Map(ctx.state.entities);
  newEntities.set(entity.id, entity);
  
  // Add to turn order
  const allEntities = Array.from(newEntities.values()).filter(e => e.isAlive);
  const sortedOrder = allEntities
    .sort((a, b) => b.initiative - a.initiative)
    .map(e => e.id);
  
  return {
    ...ctx,
    state: {
      ...ctx.state,
      entities: newEntities,
      turnOrder: { ...ctx.state.turnOrder, order: sortedOrder },
    },
  };
}

export function removeEntityFromGame(ctx: EngineContext, entityId: string): EngineContext {
  const newEntities = new Map(ctx.state.entities);
  newEntities.delete(entityId);
  
  const newOrder = ctx.state.turnOrder.order.filter(id => id !== entityId);
  let newIndex = ctx.state.turnOrder.currentIndex;
  if (newIndex >= newOrder.length) newIndex = 0;
  
  return {
    ...ctx,
    state: {
      ...ctx.state,
      entities: newEntities,
      turnOrder: { ...ctx.state.turnOrder, order: newOrder, currentIndex: newIndex },
    },
  };
}
