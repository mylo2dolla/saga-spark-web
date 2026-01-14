/**
 * Combat module - attack resolution, damage calculation, knockback.
 * Pure functions only - no mutations.
 */

import type { Entity, AttackResult, Vec2, GameEvent, EngineConfig } from "./types";
import { vec2Sub, vec2Normalize, vec2Scale, vec2Distance, factionsHostile } from "./types";
import { applyDamage, applyKnockback } from "./Entity";

// ============= Dice Rolling (Deterministic with seed) =============

export function parseDiceRoll(roll: string): { count: number; sides: number; modifier: number } {
  // Parse strings like "2d6+3", "1d20-2", "3d8"
  const match = roll.match(/(\d+)d(\d+)([+-]\d+)?/i);
  if (!match) {
    return { count: 1, sides: 6, modifier: 0 };
  }
  return {
    count: parseInt(match[1], 10),
    sides: parseInt(match[2], 10),
    modifier: match[3] ? parseInt(match[3], 10) : 0,
  };
}

// Deterministic random using a simple LCG
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

export function rollDice(
  diceString: string,
  random: () => number
): { total: number; rolls: number[]; modifier: number } {
  const { count, sides, modifier } = parseDiceRoll(diceString);
  const rolls: number[] = [];
  
  for (let i = 0; i < count; i++) {
    rolls.push(Math.floor(random() * sides) + 1);
  }
  
  const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
  return { total, rolls, modifier };
}

// ============= Attack Resolution =============

export function calculateAttack(
  attacker: Entity,
  defender: Entity,
  damageRoll: string,
  random: () => number,
  config: EngineConfig
): AttackResult {
  // Roll to hit (d20 + attack bonus vs AC)
  const attackRoll = rollDice("1d20", random);
  const attackBonus = Math.floor((attacker.initiative - 10) / 2); // Simplified
  const totalAttack = attackRoll.total + attackBonus;
  
  const isCritical = attackRoll.rolls[0] === 20;
  const isFumble = attackRoll.rolls[0] === 1;
  
  // Check if hit
  const hit = isCritical || (!isFumble && totalAttack >= defender.ac);
  
  if (!hit) {
    return {
      hit: false,
      damage: 0,
      isCritical: false,
      isFumble,
      knockback: { x: 0, y: 0 },
    };
  }
  
  // Roll damage
  let damageResult = rollDice(damageRoll, random);
  let damage = damageResult.total;
  
  // Critical doubles damage
  if (isCritical) {
    damage *= 2;
  }
  
  // Calculate knockback direction and magnitude
  const direction = vec2Normalize(vec2Sub(defender.position, attacker.position));
  const knockbackMagnitude = damage * config.knockbackScale;
  const knockback = vec2Scale(direction, knockbackMagnitude);
  
  return {
    hit: true,
    damage,
    isCritical,
    isFumble: false,
    knockback,
  };
}

// ============= Combat Resolution =============

export function resolveCombatAttack(
  entities: ReadonlyMap<string, Entity>,
  attackerId: string,
  targetId: string,
  damageRoll: string,
  seed: number,
  config: EngineConfig
): { entities: ReadonlyMap<string, Entity>; result: AttackResult; events: GameEvent[] } {
  const attacker = entities.get(attackerId);
  const target = entities.get(targetId);
  const events: GameEvent[] = [];
  
  if (!attacker || !target) {
    return {
      entities,
      result: { hit: false, damage: 0, isCritical: false, isFumble: false, knockback: { x: 0, y: 0 } },
      events,
    };
  }
  
  if (!attacker.isAlive) {
    return {
      entities,
      result: { hit: false, damage: 0, isCritical: false, isFumble: false, knockback: { x: 0, y: 0 } },
      events,
    };
  }
  
  const random = seededRandom(seed);
  const result = calculateAttack(attacker, target, damageRoll, random, config);
  
  if (!result.hit) {
    events.push({
      type: "entity_damaged",
      entityId: attackerId,
      targetId: targetId,
      value: 0,
      description: result.isFumble 
        ? `${attacker.name} fumbled their attack!`
        : `${attacker.name} missed ${target.name}`,
    });
    return { entities, result, events };
  }
  
  // Apply damage
  let newTarget = applyDamage(target, result.damage);
  
  // Apply knockback
  newTarget = applyKnockback(newTarget, result.knockback);
  
  const newEntities = new Map(entities);
  newEntities.set(targetId, newTarget);
  
  events.push({
    type: "entity_damaged",
    entityId: targetId,
    value: result.damage,
    description: result.isCritical
      ? `CRITICAL! ${attacker.name} deals ${result.damage} damage to ${target.name}!`
      : `${attacker.name} deals ${result.damage} damage to ${target.name}`,
  });
  
  if (result.knockback.x !== 0 || result.knockback.y !== 0) {
    events.push({
      type: "knockback",
      entityId: targetId,
      position: result.knockback,
      description: `${target.name} is knocked back!`,
    });
  }
  
  if (!newTarget.isAlive) {
    events.push({
      type: "entity_died",
      entityId: targetId,
      description: `${target.name} has been defeated!`,
    });
  }
  
  return { entities: newEntities, result, events };
}

// ============= Area Attacks =============

export function getEntitiesInRadius(
  entities: ReadonlyMap<string, Entity>,
  center: Vec2,
  radius: number
): Entity[] {
  const result: Entity[] = [];
  for (const entity of entities.values()) {
    if (entity.isAlive && vec2Distance(entity.position, center) <= radius) {
      result.push(entity);
    }
  }
  return result;
}

export function resolveAreaAttack(
  entities: ReadonlyMap<string, Entity>,
  casterId: string,
  center: Vec2,
  radius: number,
  damageRoll: string,
  seed: number,
  config: EngineConfig
): { entities: ReadonlyMap<string, Entity>; events: GameEvent[] } {
  const caster = entities.get(casterId);
  if (!caster) return { entities, events: [] };
  
  const events: GameEvent[] = [];
  let newEntities = new Map(entities);
  let currentSeed = seed;
  
  const targets = getEntitiesInRadius(entities, center, radius)
    .filter(e => e.id !== casterId && factionsHostile(caster.faction, e.faction));
  
  for (const target of targets) {
    const result = resolveCombatAttack(
      newEntities,
      casterId,
      target.id,
      damageRoll,
      currentSeed,
      config
    );
    newEntities = new Map(result.entities);
    events.push(...result.events);
    currentSeed += 1;
  }
  
  return { entities: newEntities, events };
}

// ============= Combat State Queries =============

export function isCombatOver(entities: ReadonlyMap<string, Entity>): { over: boolean; winner: string | null } {
  const alivePlayers = Array.from(entities.values()).filter(
    e => e.isAlive && e.faction === "player"
  );
  const aliveEnemies = Array.from(entities.values()).filter(
    e => e.isAlive && e.faction === "enemy"
  );
  
  if (aliveEnemies.length === 0 && alivePlayers.length > 0) {
    return { over: true, winner: "player" };
  }
  if (alivePlayers.length === 0 && aliveEnemies.length > 0) {
    return { over: true, winner: "enemy" };
  }
  if (alivePlayers.length === 0 && aliveEnemies.length === 0) {
    return { over: true, winner: null };
  }
  
  return { over: false, winner: null };
}

export function canAttack(attacker: Entity, target: Entity, maxRange: number): boolean {
  if (!attacker.isAlive || !target.isAlive) return false;
  if (!factionsHostile(attacker.faction, target.faction)) return false;
  
  const distance = vec2Distance(attacker.position, target.position);
  return distance <= maxRange;
}
