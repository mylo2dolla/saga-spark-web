/**
 * Entity module - entity creation and manipulation.
 * Pure functions only - no mutations.
 */

import type { Entity, Vec2, Faction, StatusEffect } from "./types";
import { vec2 } from "./types";

// ============= Entity Factory =============

let entityIdCounter = 0;

export function createEntity(params: {
  id?: string;
  name: string;
  faction: Faction;
  position: Vec2;
  hp: number;
  maxHp?: number;
  ac?: number;
  mass?: number;
  radius?: number;
  initiative?: number;
}): Entity {
  return {
    id: params.id ?? `entity_${++entityIdCounter}`,
    name: params.name,
    faction: params.faction,
    position: params.position,
    velocity: vec2(0, 0),
    mass: params.mass ?? 1,
    radius: params.radius ?? 0.4,
    hp: params.hp,
    maxHp: params.maxHp ?? params.hp,
    ac: params.ac ?? 10,
    initiative: params.initiative ?? 10,
    isAlive: params.hp > 0,
    statusEffects: [],
  };
}

// ============= Entity Updates (return new entity) =============

export function updateEntityPosition(entity: Entity, position: Vec2): Entity {
  return { ...entity, position };
}

export function updateEntityVelocity(entity: Entity, velocity: Vec2): Entity {
  return { ...entity, velocity };
}

export function applyDamage(entity: Entity, damage: number): Entity {
  const newHp = Math.max(0, entity.hp - damage);
  return {
    ...entity,
    hp: newHp,
    isAlive: newHp > 0,
  };
}

export function applyHealing(entity: Entity, healing: number): Entity {
  const newHp = Math.min(entity.maxHp, entity.hp + healing);
  return { ...entity, hp: newHp };
}

export function applyKnockback(entity: Entity, impulse: Vec2): Entity {
  // Knockback is inversely proportional to mass
  const knockbackMultiplier = 1 / entity.mass;
  return {
    ...entity,
    velocity: {
      x: entity.velocity.x + impulse.x * knockbackMultiplier,
      y: entity.velocity.y + impulse.y * knockbackMultiplier,
    },
  };
}

export function addStatusEffect(entity: Entity, effect: StatusEffect): Entity {
  // Check if effect already exists - refresh duration if so
  const existingIndex = entity.statusEffects.findIndex(e => e.id === effect.id);
  if (existingIndex >= 0) {
    const newEffects = [...entity.statusEffects];
    newEffects[existingIndex] = effect;
    return { ...entity, statusEffects: newEffects };
  }
  return { ...entity, statusEffects: [...entity.statusEffects, effect] };
}

export function removeStatusEffect(entity: Entity, effectId: string): Entity {
  return {
    ...entity,
    statusEffects: entity.statusEffects.filter(e => e.id !== effectId),
  };
}

export function tickStatusEffects(entity: Entity): { entity: Entity; damage: number; healing: number } {
  let totalDamage = 0;
  let totalHealing = 0;
  
  const newEffects: StatusEffect[] = [];
  for (const effect of entity.statusEffects) {
    totalDamage += effect.damagePerTurn ?? 0;
    totalHealing += effect.healingPerTurn ?? 0;
    
    if (effect.duration > 1) {
      newEffects.push({ ...effect, duration: effect.duration - 1 });
    }
  }
  
  let newEntity: Entity = { ...entity, statusEffects: newEffects };
  
  if (totalDamage > 0) {
    newEntity = applyDamage(newEntity, totalDamage);
  }
  if (totalHealing > 0) {
    newEntity = applyHealing(newEntity, totalHealing);
  }
  
  return { entity: newEntity, damage: totalDamage, healing: totalHealing };
}

// ============= Entity Queries =============

export function getMovementSpeed(entity: Entity): number {
  let baseSpeed = 5; // Tiles per round
  
  for (const effect of entity.statusEffects) {
    if (effect.movementModifier !== undefined) {
      baseSpeed *= effect.movementModifier;
    }
  }
  
  return baseSpeed;
}

export function isEntityAt(entity: Entity, position: Vec2, tolerance: number = 0.5): boolean {
  const dx = Math.abs(entity.position.x - position.x);
  const dy = Math.abs(entity.position.y - position.y);
  return dx < tolerance && dy < tolerance;
}

// ============= Collection Helpers =============

export function getEntityById(entities: ReadonlyMap<string, Entity>, id: string): Entity | undefined {
  return entities.get(id);
}

export function getEntitiesAtPosition(
  entities: ReadonlyMap<string, Entity>,
  position: Vec2,
  tolerance: number = 0.5
): Entity[] {
  const result: Entity[] = [];
  for (const entity of entities.values()) {
    if (isEntityAt(entity, position, tolerance)) {
      result.push(entity);
    }
  }
  return result;
}

export function getEntitiesByFaction(
  entities: ReadonlyMap<string, Entity>,
  faction: Faction
): Entity[] {
  const result: Entity[] = [];
  for (const entity of entities.values()) {
    if (entity.faction === faction && entity.isAlive) {
      result.push(entity);
    }
  }
  return result;
}

export function getAliveEntities(entities: ReadonlyMap<string, Entity>): Entity[] {
  const result: Entity[] = [];
  for (const entity of entities.values()) {
    if (entity.isAlive) {
      result.push(entity);
    }
  }
  return result;
}
