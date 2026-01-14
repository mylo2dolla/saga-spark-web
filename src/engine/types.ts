/**
 * Core type definitions for the physics-based combat engine.
 * All types are immutable - state updates return new objects.
 */

// ============= Vector & Position =============

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y };
}

export function vec2Add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vec2Sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vec2Scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function vec2Length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

export function vec2Normalize(v: Vec2): Vec2 {
  const len = vec2Length(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

export function vec2Distance(a: Vec2, b: Vec2): number {
  return vec2Length(vec2Sub(b, a));
}

export function vec2Equals(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

// Grid position (integer coordinates)
export interface GridPos {
  readonly row: number;
  readonly col: number;
}

export function gridPos(row: number, col: number): GridPos {
  return { row, col };
}

export function gridToWorld(pos: GridPos, cellSize: number): Vec2 {
  return { x: pos.col * cellSize + cellSize / 2, y: pos.row * cellSize + cellSize / 2 };
}

export function worldToGrid(pos: Vec2, cellSize: number): GridPos {
  return { row: Math.floor(pos.y / cellSize), col: Math.floor(pos.x / cellSize) };
}

// ============= Factions =============

export type Faction = "player" | "enemy" | "neutral";

export function factionsHostile(a: Faction, b: Faction): boolean {
  if (a === "neutral" || b === "neutral") return false;
  return a !== b;
}

// ============= Entity =============

export interface Entity {
  readonly id: string;
  readonly name: string;
  readonly faction: Faction;
  
  // Physics
  readonly position: Vec2;       // World position (continuous)
  readonly velocity: Vec2;       // Tiles per second
  readonly mass: number;         // Affects knockback
  readonly radius: number;       // Collision radius
  
  // Combat
  readonly hp: number;
  readonly maxHp: number;
  readonly ac: number;
  readonly initiative: number;
  
  // Status
  readonly isAlive: boolean;
  readonly statusEffects: readonly StatusEffect[];
}

export interface StatusEffect {
  readonly id: string;
  readonly name: string;
  readonly duration: number;      // Turns remaining
  readonly damagePerTurn?: number;
  readonly healingPerTurn?: number;
  readonly movementModifier?: number;  // Multiplier (0.5 = half speed)
}

// ============= Board / Tiles =============

export type TerrainType = "floor" | "wall" | "water" | "lava" | "pit" | "difficult";

export interface Tile {
  readonly terrain: TerrainType;
  readonly blocked: boolean;         // Impassable
  readonly movementCost: number;     // 1 = normal, 2 = difficult terrain
  readonly damageOnEnter?: number;   // Lava, traps, etc.
}

export interface Board {
  readonly rows: number;
  readonly cols: number;
  readonly cellSize: number;         // World units per cell
  readonly tiles: readonly (readonly Tile[])[];  // [row][col]
}

// ============= Actions & Events =============

export type ActionType = "move" | "attack" | "ability" | "end_turn";

export interface MoveAction {
  readonly type: "move";
  readonly entityId: string;
  readonly targetPosition: Vec2;
}

export interface AttackAction {
  readonly type: "attack";
  readonly attackerId: string;
  readonly targetId: string;
  readonly damageRoll: string;  // e.g., "2d6+3"
}

export interface AbilityAction {
  readonly type: "ability";
  readonly casterId: string;
  readonly abilityId: string;
  readonly targetPosition: Vec2;
  readonly targetIds?: readonly string[];
}

export interface EndTurnAction {
  readonly type: "end_turn";
  readonly entityId: string;
}

export type GameAction = MoveAction | AttackAction | AbilityAction | EndTurnAction;

// ============= Events (outputs from engine) =============

export type GameEventType = 
  | "entity_moved"
  | "entity_damaged"
  | "entity_healed"
  | "entity_died"
  | "collision"
  | "knockback"
  | "turn_started"
  | "turn_ended"
  | "round_started"
  | "combat_ended";

export interface GameEvent {
  readonly type: GameEventType;
  readonly entityId?: string;
  readonly targetId?: string;
  readonly value?: number;
  readonly position?: Vec2;
  readonly description: string;
}

// ============= Collision =============

export interface Collision {
  readonly entityA: string;
  readonly entityB: string;
  readonly point: Vec2;
  readonly normal: Vec2;          // Direction from A to B
  readonly penetration: number;   // Overlap distance
}

// ============= Combat Resolution =============

export interface AttackResult {
  readonly hit: boolean;
  readonly damage: number;
  readonly isCritical: boolean;
  readonly isFumble: boolean;
  readonly knockback: Vec2;       // Impulse to apply
}

// ============= Game State =============

export interface TurnOrder {
  readonly order: readonly string[];  // Entity IDs sorted by initiative
  readonly currentIndex: number;
  readonly roundNumber: number;
}

export interface GameState {
  readonly tick: number;               // Monotonic frame counter
  readonly entities: ReadonlyMap<string, Entity>;
  readonly board: Board;
  readonly turnOrder: TurnOrder;
  readonly isInCombat: boolean;
  readonly pendingEvents: readonly GameEvent[];
}

// ============= Config =============

export interface EngineConfig {
  readonly physicsSubsteps: number;    // Physics iterations per tick
  readonly friction: number;           // Velocity decay per tick (0-1)
  readonly knockbackScale: number;     // Damage to knockback multiplier
  readonly collisionElasticity: number; // Bounce factor (0-1)
}

export const DEFAULT_CONFIG: EngineConfig = {
  physicsSubsteps: 4,
  friction: 0.85,
  knockbackScale: 0.5,
  collisionElasticity: 0.3,
};
