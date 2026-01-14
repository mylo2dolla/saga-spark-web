/**
 * Unified state that combines physics/combat GameState with narrative WorldState.
 * This is the single source of truth for the entire simulation.
 * Pure functions only - no mutations.
 */

import type { GameState, Entity, GameEvent, Vec2 } from "./types";
import type { 
  WorldState, 
  WorldEvent, 
  CampaignSeed, 
  EnhancedStatus,
  CharacterProgression,
  Inventory,
  Equipment,
  Item,
  NPC,
  Quest as QuestType,
} from "./narrative/types";
import { createInitialState } from "./GameState";
import { createWorldState } from "./narrative/World";
import * as World from "./narrative/World";
import * as QuestModule from "./narrative/Quest";
import * as Progression from "./narrative/Progression";
import * as ItemModule from "./narrative/Item";
import * as StatusModule from "./narrative/Status";

// ============= Unified State =============

export interface UnifiedState {
  readonly game: GameState;
  readonly world: WorldState;
  readonly pendingWorldEvents: readonly WorldEvent[];
}

export interface EntityNarrativeData {
  readonly entityId: string;
  readonly inventory: Inventory;
  readonly equipment: Equipment;
  readonly statuses: readonly EnhancedStatus[];
  readonly progression?: CharacterProgression;
}

export interface UnifiedEvent {
  readonly type: "game" | "world";
  readonly event: GameEvent | WorldEvent;
  readonly timestamp: number;
}

// ============= Factory =============

export function createUnifiedState(
  campaignSeed: CampaignSeed,
  entities: Entity[],
  boardRows: number = 10,
  boardCols: number = 12
): UnifiedState {
  const gameState = createInitialState(entities, boardRows, boardCols);
  const worldState = createWorldState(campaignSeed);
  
  return {
    game: gameState,
    world: worldState,
    pendingWorldEvents: [],
  };
}

// ============= Game State Updates =============

export function updateGameState(state: UnifiedState, game: GameState): UnifiedState {
  return { ...state, game };
}

export function updateWorldState(state: UnifiedState, world: WorldState): UnifiedState {
  return { ...state, world };
}

export function addWorldEvents(state: UnifiedState, events: readonly WorldEvent[]): UnifiedState {
  return { ...state, pendingWorldEvents: [...state.pendingWorldEvents, ...events] };
}

export function clearWorldEvents(state: UnifiedState): UnifiedState {
  return { ...state, pendingWorldEvents: [] };
}

// ============= Combat → Narrative Bridge =============

export interface CombatNarrativeBridge {
  state: UnifiedState;
  narrativeEvents: WorldEvent[];
}

/**
 * Process a kill event from combat, updating quests, XP, NPC memory, etc.
 */
export function processCombatKill(
  state: UnifiedState,
  killerId: string,
  targetId: string,
  targetType: string
): CombatNarrativeBridge {
  const events: WorldEvent[] = [];
  let newWorld = state.world;
  
  // Update all active quests with kill objectives
  for (const [questId, quest] of state.world.quests) {
    if (quest.state === "active") {
      const result = QuestModule.processKillEvent(quest, targetId, targetType);
      if (result.events.length > 0) {
        newWorld = World.updateQuest(newWorld, result.quest);
        events.push(...result.events);
      }
    }
  }
  
  // Grant combat XP to killer
  const killerProgression = state.world.playerProgression.get(killerId);
  if (killerProgression) {
    const targetEntity = state.game.entities.get(targetId);
    const enemyLevel = targetEntity ? Math.max(1, Math.floor(targetEntity.maxHp / 10)) : 1;
    const xp = Progression.calculateCombatXp(enemyLevel, killerProgression.level);
    
    const result = Progression.gainXp(killerProgression, xp, "combat", `Defeated ${targetType}`);
    newWorld = World.updatePlayerProgression(newWorld, result.progression);
    
    events.push({
      type: "xp_gained",
      entityId: killerId,
      value: xp,
      description: `Gained ${xp} XP for defeating ${targetType}`,
      timestamp: Date.now(),
    });
    
    if (result.leveledUp) {
      events.push({
        type: "level_up",
        entityId: killerId,
        value: result.newLevel,
        description: `Level up! Now level ${result.newLevel}`,
        timestamp: Date.now(),
      });
    }
  }
  
  // Update NPC memories of witnesses
  for (const [npcId, npc] of state.world.npcs) {
    // NPCs remember when the player kills
    const updatedNPC = {
      ...npc,
      memories: [
        {
          timestamp: Date.now(),
          event: `Player killed ${targetType}`,
          tags: [killerId, targetId, "combat", "kill"],
          emotionalImpact: -2, // Killing usually has negative impact
          decay: 0.05,
        },
        ...npc.memories,
      ].slice(0, 50),
    };
    newWorld = World.updateNPC(newWorld, updatedNPC);
    
    events.push({
      type: "npc_remembered",
      entityId: npcId,
      targetId: killerId,
      description: `${npc.name} witnessed the combat`,
      timestamp: Date.now(),
    });
  }
  
  return {
    state: { ...state, world: newWorld },
    narrativeEvents: events,
  };
}

/**
 * Process damage event from combat
 */
export function processCombatDamage(
  state: UnifiedState,
  targetId: string,
  damage: number,
  sourceId?: string
): CombatNarrativeBridge {
  const events: WorldEvent[] = [];
  // Damage events could trigger status effects, etc.
  // For now, just track
  return { state, narrativeEvents: events };
}

/**
 * Process discovery (entering new area)
 */
export function processDiscovery(
  state: UnifiedState,
  entityId: string,
  locationId: string
): CombatNarrativeBridge {
  const result = World.processWorldAction(state.world, {
    type: "discover_location",
    entityId,
    targetId: locationId,
  });
  
  // Update quests with explore objectives
  let newWorld = result.world;
  const events = [...result.events];
  
  for (const [questId, quest] of state.world.quests) {
    if (quest.state === "active") {
      const entity = state.game.entities.get(entityId);
      const questResult = QuestModule.processExploreEvent(
        quest, 
        entity?.position ?? { x: 0, y: 0 }, 
        locationId
      );
      if (questResult.events.length > 0) {
        newWorld = World.updateQuest(newWorld, questResult.quest);
        events.push(...questResult.events);
      }
    }
  }
  
  return {
    state: { ...state, world: newWorld },
    narrativeEvents: events,
  };
}

// ============= Stat Calculation (Equipment + Status + Progression) =============

export interface CalculatedStats {
  readonly maxHp: number;
  readonly ac: number;
  readonly attackBonus: number;
  readonly damageBonus: number;
  readonly speed: number;
  readonly initiative: number;
  readonly weaponDamage: string;
}

export function calculateEntityStats(
  state: UnifiedState,
  entityId: string,
  baseStats: { maxHp: number; ac: number },
  equipment: Equipment,
  statuses: readonly EnhancedStatus[]
): CalculatedStats {
  const items = state.world.items;
  const progression = state.world.playerProgression.get(entityId);
  
  // Equipment bonuses
  const equipmentStats = ItemModule.calculateEquipmentStats(equipment, items);
  
  // Status bonuses
  const statusStats = StatusModule.calculateStatusStats(statuses);
  
  // Level bonuses
  const levelStats = progression 
    ? Progression.getAccumulatedLevelBonuses(progression.level)
    : {};
  
  // Final calculation
  const finalStats = Progression.calculateFinalStats(
    { maxHp: baseStats.maxHp, ac: baseStats.ac },
    levelStats,
    equipmentStats,
    statusStats
  );
  
  return {
    maxHp: baseStats.maxHp + (finalStats.maxHp ?? 0),
    ac: baseStats.ac + (finalStats.ac ?? 0),
    attackBonus: finalStats.attackBonus ?? 0,
    damageBonus: finalStats.damageBonus ?? 0,
    speed: 5 + (finalStats.speed ?? 0),
    initiative: 10 + (finalStats.initiative ?? 0),
    weaponDamage: ItemModule.getEquippedWeaponDamage(equipment, items),
  };
}

// ============= Serialization =============

export function serializeUnifiedState(state: UnifiedState): string {
  return JSON.stringify({
    game: {
      tick: state.game.tick,
      entities: Array.from(state.game.entities.entries()),
      board: state.game.board,
      turnOrder: state.game.turnOrder,
      isInCombat: state.game.isInCombat,
    },
    world: World.serializeWorld(state.world),
  });
}

export function deserializeUnifiedState(json: string): UnifiedState {
  const data = JSON.parse(json);
  return {
    game: {
      tick: data.game.tick,
      entities: new Map(data.game.entities),
      board: data.game.board,
      turnOrder: data.game.turnOrder,
      isInCombat: data.game.isInCombat,
      pendingEvents: [],
    },
    world: World.deserializeWorld(data.world),
    pendingWorldEvents: [],
  };
}
