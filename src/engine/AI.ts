/**
 * AI system for enemy turn processing.
 * Pure functions that determine AI actions based on game state.
 */

import type { 
  GameState, 
  Entity, 
  GameAction, 
  Vec2,
  Faction 
} from "./types";
import { vec2Distance, vec2Sub, vec2Normalize, vec2Scale, vec2Add } from "./types";

// ============= AI Configuration =============

export interface AIBehavior {
  readonly aggressionLevel: number;      // 0-1, how likely to attack vs flee
  readonly targetPriority: "nearest" | "weakest" | "strongest" | "random";
  readonly fleeThreshold: number;        // HP percentage to start fleeing
  readonly usesAbilities: boolean;
  readonly preferredRange: number;       // Ideal distance from target
}

export const DEFAULT_AI_BEHAVIOR: AIBehavior = {
  aggressionLevel: 0.7,
  targetPriority: "nearest",
  fleeThreshold: 0.2,
  usesAbilities: true,
  preferredRange: 1,
};

// ============= Target Selection =============

export function getHostileEntities(
  state: GameState,
  forEntity: Entity
): Entity[] {
  return Array.from(state.entities.values()).filter(e => 
    e.isAlive && 
    e.id !== forEntity.id &&
    areFactionsHostile(forEntity.faction, e.faction)
  );
}

export function areFactionsHostile(a: Faction, b: Faction): boolean {
  if (a === "neutral" || b === "neutral") return false;
  return a !== b;
}

export function selectTarget(
  state: GameState,
  entity: Entity,
  behavior: AIBehavior
): Entity | null {
  const hostiles = getHostileEntities(state, entity);
  if (hostiles.length === 0) return null;

  switch (behavior.targetPriority) {
    case "nearest":
      return hostiles.reduce((nearest, e) => {
        const distToNearest = vec2Distance(entity.position, nearest.position);
        const distToE = vec2Distance(entity.position, e.position);
        return distToE < distToNearest ? e : nearest;
      });
    
    case "weakest":
      return hostiles.reduce((weakest, e) => 
        (e.hp / e.maxHp) < (weakest.hp / weakest.maxHp) ? e : weakest
      );
    
    case "strongest":
      return hostiles.reduce((strongest, e) => 
        e.hp > strongest.hp ? e : strongest
      );
    
    case "random":
      return hostiles[Math.floor(Math.random() * hostiles.length)];
    
    default:
      return hostiles[0];
  }
}

// ============= Movement Logic =============

export function calculateMoveToward(
  from: Vec2,
  to: Vec2,
  speed: number,
  preferredRange: number
): Vec2 {
  const direction = vec2Sub(to, from);
  const distance = vec2Distance(from, to);
  
  // If we're at preferred range, don't move
  if (Math.abs(distance - preferredRange) < 0.5) {
    return from;
  }
  
  // Move toward or away based on preferred range
  const normalized = vec2Normalize(direction);
  const moveDistance = Math.min(speed, Math.abs(distance - preferredRange));
  
  if (distance > preferredRange) {
    // Move closer
    return vec2Add(from, vec2Scale(normalized, moveDistance));
  } else {
    // Move away (maintain range)
    return vec2Add(from, vec2Scale(normalized, -moveDistance));
  }
}

export function calculateFlee(
  entity: Entity,
  threats: Entity[],
  speed: number
): Vec2 {
  if (threats.length === 0) return entity.position;
  
  // Calculate average threat position
  const avgThreat = threats.reduce(
    (sum, t) => vec2Add(sum, t.position),
    { x: 0, y: 0 }
  );
  avgThreat.x /= threats.length;
  avgThreat.y /= threats.length;
  
  // Move away from average threat
  const fleeDirection = vec2Normalize(vec2Sub(entity.position, avgThreat));
  return vec2Add(entity.position, vec2Scale(fleeDirection, speed));
}

// ============= Action Generation =============

export interface AIDecision {
  readonly action: GameAction;
  readonly reasoning: string;
}

export function generateAITurn(
  state: GameState,
  entity: Entity,
  behavior: AIBehavior = DEFAULT_AI_BEHAVIOR
): AIDecision {
  const hpPercent = entity.hp / entity.maxHp;
  
  // Check if should flee
  if (hpPercent <= behavior.fleeThreshold && behavior.aggressionLevel < 0.9) {
    const threats = getHostileEntities(state, entity);
    const fleePosition = calculateFlee(entity, threats, 2);
    
    return {
      action: {
        type: "move",
        entityId: entity.id,
        targetPosition: fleePosition,
      },
      reasoning: `${entity.name} is fleeing (HP: ${Math.round(hpPercent * 100)}%)`,
    };
  }
  
  // Find target
  const target = selectTarget(state, entity, behavior);
  
  if (!target) {
    // No enemies, end turn
    return {
      action: { type: "end_turn", entityId: entity.id },
      reasoning: `${entity.name} has no targets`,
    };
  }
  
  const distanceToTarget = vec2Distance(entity.position, target.position);
  const attackRange = 1.5; // Melee range
  
  // If in range, attack
  if (distanceToTarget <= attackRange) {
    return {
      action: {
        type: "attack",
        attackerId: entity.id,
        targetId: target.id,
        damageRoll: "1d8+2", // Default enemy damage
      },
      reasoning: `${entity.name} attacks ${target.name}`,
    };
  }
  
  // Move toward target
  const newPosition = calculateMoveToward(
    entity.position,
    target.position,
    2, // Movement speed
    behavior.preferredRange
  );
  
  return {
    action: {
      type: "move",
      entityId: entity.id,
      targetPosition: newPosition,
    },
    reasoning: `${entity.name} moves toward ${target.name}`,
  };
}

// ============= Turn Processing =============

export function processAITurns(
  state: GameState,
  behaviors: Map<string, AIBehavior> = new Map()
): { actions: GameAction[]; decisions: AIDecision[] } {
  const currentEntity = state.turnOrder.order[state.turnOrder.currentIndex];
  const entity = state.entities.get(currentEntity);
  
  if (!entity || !entity.isAlive || entity.faction === "player") {
    return { actions: [], decisions: [] };
  }
  
  const behavior = behaviors.get(entity.id) ?? DEFAULT_AI_BEHAVIOR;
  const decision = generateAITurn(state, entity, behavior);
  
  return {
    actions: [decision.action],
    decisions: [decision],
  };
}

// ============= Narrative Integration =============

export interface AIAction {
  readonly entityId: string;
  readonly action: GameAction;
  readonly narrativeDescription: string;
  readonly emotionalState: "aggressive" | "defensive" | "neutral" | "fleeing";
}

export function generateNarrativeAction(
  state: GameState,
  entity: Entity,
  behavior: AIBehavior = DEFAULT_AI_BEHAVIOR
): AIAction {
  const decision = generateAITurn(state, entity, behavior);
  const hpPercent = entity.hp / entity.maxHp;
  
  let emotionalState: AIAction["emotionalState"] = "neutral";
  if (hpPercent <= behavior.fleeThreshold) {
    emotionalState = "fleeing";
  } else if (decision.action.type === "attack") {
    emotionalState = "aggressive";
  } else if (hpPercent < 0.5) {
    emotionalState = "defensive";
  }
  
  return {
    entityId: entity.id,
    action: decision.action,
    narrativeDescription: decision.reasoning,
    emotionalState,
  };
}
