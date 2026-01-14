/**
 * Physics module - movement, collision detection, and knockback resolution.
 * Pure functions only - no mutations.
 */

import type { Entity, Board, Vec2, Collision, EngineConfig, GameEvent } from "./types";
import { vec2, vec2Add, vec2Sub, vec2Scale, vec2Length, vec2Normalize, vec2Distance } from "./types";
import { isBlockedWorld } from "./Board";

// ============= Collision Detection =============

export function detectCollision(a: Entity, b: Entity): Collision | null {
  if (!a.isAlive || !b.isAlive) return null;
  
  const diff = vec2Sub(b.position, a.position);
  const distance = vec2Length(diff);
  const minDistance = a.radius + b.radius;
  
  if (distance >= minDistance) return null;
  
  const normal = distance > 0 ? vec2Normalize(diff) : vec2(1, 0);
  const penetration = minDistance - distance;
  const contactPoint = vec2Add(a.position, vec2Scale(normal, a.radius));
  
  return {
    entityA: a.id,
    entityB: b.id,
    point: contactPoint,
    normal,
    penetration,
  };
}

export function detectAllCollisions(entities: ReadonlyMap<string, Entity>): Collision[] {
  const collisions: Collision[] = [];
  const entityList = Array.from(entities.values());
  
  for (let i = 0; i < entityList.length; i++) {
    for (let j = i + 1; j < entityList.length; j++) {
      const collision = detectCollision(entityList[i], entityList[j]);
      if (collision) {
        collisions.push(collision);
      }
    }
  }
  
  return collisions;
}

// ============= Collision Resolution =============

export function resolveCollision(
  a: Entity,
  b: Entity,
  collision: Collision,
  config: EngineConfig
): { a: Entity; b: Entity } {
  // Separate entities
  const totalMass = a.mass + b.mass;
  const aRatio = b.mass / totalMass;
  const bRatio = a.mass / totalMass;
  
  const separation = vec2Scale(collision.normal, collision.penetration);
  
  const newAPos = vec2Sub(a.position, vec2Scale(separation, aRatio));
  const newBPos = vec2Add(b.position, vec2Scale(separation, bRatio));
  
  // Calculate relative velocity
  const relativeVel = vec2Sub(b.velocity, a.velocity);
  const normalVel = relativeVel.x * collision.normal.x + relativeVel.y * collision.normal.y;
  
  // Don't resolve if moving apart
  if (normalVel > 0) {
    return {
      a: { ...a, position: newAPos },
      b: { ...b, position: newBPos },
    };
  }
  
  // Calculate impulse
  const restitution = config.collisionElasticity;
  const impulseScalar = -(1 + restitution) * normalVel / (1 / a.mass + 1 / b.mass);
  const impulse = vec2Scale(collision.normal, impulseScalar);
  
  return {
    a: {
      ...a,
      position: newAPos,
      velocity: vec2Sub(a.velocity, vec2Scale(impulse, 1 / a.mass)),
    },
    b: {
      ...b,
      position: newBPos,
      velocity: vec2Add(b.velocity, vec2Scale(impulse, 1 / b.mass)),
    },
  };
}

// ============= Wall Collision =============

export function resolveWallCollision(entity: Entity, board: Board): Entity {
  let pos = entity.position;
  let vel = entity.velocity;
  
  // Check bounds
  const minX = entity.radius;
  const maxX = board.cols * board.cellSize - entity.radius;
  const minY = entity.radius;
  const maxY = board.rows * board.cellSize - entity.radius;
  
  if (pos.x < minX) {
    pos = { ...pos, x: minX };
    vel = { ...vel, x: Math.abs(vel.x) * 0.3 };
  } else if (pos.x > maxX) {
    pos = { ...pos, x: maxX };
    vel = { ...vel, x: -Math.abs(vel.x) * 0.3 };
  }
  
  if (pos.y < minY) {
    pos = { ...pos, y: minY };
    vel = { ...vel, y: Math.abs(vel.y) * 0.3 };
  } else if (pos.y > maxY) {
    pos = { ...pos, y: maxY };
    vel = { ...vel, y: -Math.abs(vel.y) * 0.3 };
  }
  
  // Check tile collisions (simplified - check center position)
  if (isBlockedWorld(board, pos)) {
    // Push back to previous position along velocity
    const pushback = vec2Normalize(vec2Scale(vel, -1));
    pos = vec2Add(pos, vec2Scale(pushback, 0.5));
    vel = vec2(0, 0);
  }
  
  return { ...entity, position: pos, velocity: vel };
}

// ============= Physics Step =============

export function physicsStep(
  entities: ReadonlyMap<string, Entity>,
  board: Board,
  dt: number,
  config: EngineConfig
): { entities: ReadonlyMap<string, Entity>; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let updatedEntities = new Map(entities);
  
  const substepDt = dt / config.physicsSubsteps;
  
  for (let step = 0; step < config.physicsSubsteps; step++) {
    // Update positions based on velocity
    for (const [id, entity] of updatedEntities) {
      if (!entity.isAlive) continue;
      if (vec2Length(entity.velocity) < 0.001) continue;
      
      const newPos = vec2Add(entity.position, vec2Scale(entity.velocity, substepDt));
      updatedEntities.set(id, { ...entity, position: newPos });
    }
    
    // Detect and resolve entity-entity collisions
    const collisions = detectAllCollisions(updatedEntities);
    for (const collision of collisions) {
      const a = updatedEntities.get(collision.entityA);
      const b = updatedEntities.get(collision.entityB);
      if (!a || !b) continue;
      
      const resolved = resolveCollision(a, b, collision, config);
      updatedEntities.set(collision.entityA, resolved.a);
      updatedEntities.set(collision.entityB, resolved.b);
      
      events.push({
        type: "collision",
        entityId: collision.entityA,
        targetId: collision.entityB,
        position: collision.point,
        description: `${a.name} collided with ${b.name}`,
      });
    }
    
    // Resolve wall collisions
    for (const [id, entity] of updatedEntities) {
      if (!entity.isAlive) continue;
      const resolved = resolveWallCollision(entity, board);
      updatedEntities.set(id, resolved);
    }
  }
  
  // Apply friction
  for (const [id, entity] of updatedEntities) {
    if (vec2Length(entity.velocity) > 0.001) {
      updatedEntities.set(id, {
        ...entity,
        velocity: vec2Scale(entity.velocity, config.friction),
      });
    } else if (vec2Length(entity.velocity) > 0) {
      updatedEntities.set(id, {
        ...entity,
        velocity: vec2(0, 0),
      });
    }
  }
  
  return { entities: updatedEntities, events };
}

// ============= Movement Helpers =============

export function moveTowards(entity: Entity, target: Vec2, speed: number): Entity {
  const diff = vec2Sub(target, entity.position);
  const distance = vec2Length(diff);
  
  if (distance < 0.1) {
    return { ...entity, position: target, velocity: vec2(0, 0) };
  }
  
  const direction = vec2Normalize(diff);
  const moveDistance = Math.min(distance, speed);
  const newPos = vec2Add(entity.position, vec2Scale(direction, moveDistance));
  
  return { ...entity, position: newPos };
}

export function applyImpulse(entity: Entity, impulse: Vec2): Entity {
  const newVelocity = vec2Add(entity.velocity, vec2Scale(impulse, 1 / entity.mass));
  return { ...entity, velocity: newVelocity };
}
