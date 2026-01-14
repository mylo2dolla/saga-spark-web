/**
 * Public API for the physics-based combat engine.
 */

// Types
export type {
  Vec2,
  GridPos,
  Faction,
  Entity,
  StatusEffect,
  TerrainType,
  Tile,
  Board,
  GameAction,
  MoveAction,
  AttackAction,
  AbilityAction,
  EndTurnAction,
  GameEvent,
  GameEventType,
  Collision,
  AttackResult,
  TurnOrder,
  GameState,
  EngineConfig,
} from "./types";

// Type utilities
export { 
  vec2, 
  vec2Add, 
  vec2Sub, 
  vec2Scale, 
  vec2Length, 
  vec2Normalize, 
  vec2Distance,
  vec2Equals,
  gridPos,
  gridToWorld,
  worldToGrid,
  factionsHostile,
  DEFAULT_CONFIG,
} from "./types";

// Board
export {
  createBoard,
  createTile,
  getTileAt,
  getTileAtWorld,
  isInBounds,
  isBlocked,
  isBlockedWorld,
  getMovementCost,
  setTile,
  getNeighbors,
  getNeighborsWithDiagonals,
  findPath,
  getReachableTiles,
} from "./Board";

// Entity
export {
  createEntity,
  updateEntityPosition,
  updateEntityVelocity,
  applyDamage,
  applyHealing,
  applyKnockback,
  addStatusEffect,
  removeStatusEffect,
  tickStatusEffects,
  getMovementSpeed,
  isEntityAt,
  getEntityById,
  getEntitiesAtPosition,
  getEntitiesByFaction,
  getAliveEntities,
} from "./Entity";

// Physics
export {
  detectCollision,
  detectAllCollisions,
  resolveCollision,
  resolveWallCollision,
  physicsStep,
  moveTowards,
  applyImpulse,
} from "./Physics";

// Combat
export {
  parseDiceRoll,
  seededRandom,
  rollDice,
  calculateAttack,
  resolveCombatAttack,
  getEntitiesInRadius,
  resolveAreaAttack,
  isCombatOver,
  canAttack,
} from "./Combat";

// GameState
export {
  createInitialState,
  incrementTick,
  updateEntity,
  updateEntities,
  removeEntity,
  addEntity,
  updateBoard,
  setCombatActive,
  addEvents,
  clearEvents,
  getCurrentTurnEntity,
  advanceTurn,
  processStartOfTurn,
  isValidAction,
  serializeState,
  deserializeState,
} from "./GameState";

// Engine (main entry point)
export {
  createEngine,
  processAction,
  physicsTick,
  gameTick,
  getState,
  getEntities,
  getEntity,
  getCurrentTurn,
  getValidMoves,
  getEvents,
  startCombat,
  endCombat,
  spawnEntity,
  removeEntityFromGame,
  type EngineContext,
} from "./Engine";
