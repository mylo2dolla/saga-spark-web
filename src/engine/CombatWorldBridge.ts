/**
 * Combat → World State Bridge
 * This module handles applying combat outcomes to the world state.
 * When combat ends, survivors, deaths, XP, loot, NPC memory, quests, and travel state
 * are all updated based on combat results.
 */

import type { Entity, GameState, Faction } from "./types";
import type { 
  WorldState, 
  WorldEvent, 
  Quest, 
  NPC,
  CharacterProgression,
  Item,
} from "./narrative/types";
import type { TravelWorldState, CombatResult } from "./narrative/TravelPersistence";
import type { TravelState } from "./narrative/Travel";
import * as World from "./narrative/World";
import * as Progression from "./narrative/Progression";
import * as ItemModule from "./narrative/Item";

// ============= Helper to preserve travelState =============

function updateWorldPreservingTravel(
  travelWorld: TravelWorldState, 
  worldStateResult: WorldState
): TravelWorldState {
  return {
    ...worldStateResult,
    travelState: travelWorld.travelState,
  };
}

// ============= Combat Outcome Types =============

export interface CombatOutcome {
  readonly victory: boolean;
  readonly winnerFaction: Faction | null;
  readonly survivors: readonly CombatantOutcome[];
  readonly defeated: readonly CombatantOutcome[];
  readonly xpEarned: number;
  readonly loot: readonly LootItem[];
  readonly combatDuration: number;
  readonly locationId: string;
  readonly wasAmbush: boolean;
}

export interface CombatantOutcome {
  readonly id: string;
  readonly name: string;
  readonly faction: Faction;
  readonly finalHp: number;
  readonly maxHp: number;
  readonly damageDealt: number;
  readonly damageReceived: number;
  readonly killCount: number;
  readonly wasKilledBy: string | null;
}

export interface LootItem {
  readonly itemId: string;
  readonly name: string;
  readonly type: string;
  readonly rarity: string;
  readonly value: number;
}

// ============= Combat Outcome Builder =============

/**
 * Build a CombatOutcome from the final game state after combat ends.
 */
export function buildCombatOutcome(
  gameState: GameState,
  locationId: string,
  combatStartTick: number,
  wasAmbush: boolean = false,
  combatLog: readonly CombatLogEntry[] = []
): CombatOutcome {
  const entities = Array.from(gameState.entities.values());
  
  const survivors: CombatantOutcome[] = [];
  const defeated: CombatantOutcome[] = [];
  
  // Track damage dealt/received from combat log
  const damageDealtMap = new Map<string, number>();
  const damageReceivedMap = new Map<string, number>();
  const killsMap = new Map<string, number>();
  const killedByMap = new Map<string, string>();
  
  for (const entry of combatLog) {
    if (entry.type === "damage") {
      const current = damageDealtMap.get(entry.sourceId) ?? 0;
      damageDealtMap.set(entry.sourceId, current + entry.amount);
      
      const received = damageReceivedMap.get(entry.targetId) ?? 0;
      damageReceivedMap.set(entry.targetId, received + entry.amount);
    }
    if (entry.type === "kill") {
      const kills = killsMap.get(entry.sourceId) ?? 0;
      killsMap.set(entry.sourceId, kills + 1);
      killedByMap.set(entry.targetId, entry.sourceId);
    }
  }
  
  for (const entity of entities) {
    const outcome: CombatantOutcome = {
      id: entity.id,
      name: entity.name,
      faction: entity.faction,
      finalHp: entity.hp,
      maxHp: entity.maxHp,
      damageDealt: damageDealtMap.get(entity.id) ?? 0,
      damageReceived: damageReceivedMap.get(entity.id) ?? 0,
      killCount: killsMap.get(entity.id) ?? 0,
      wasKilledBy: killedByMap.get(entity.id) ?? null,
    };
    
    if (entity.isAlive) {
      survivors.push(outcome);
    } else {
      defeated.push(outcome);
    }
  }
  
  // Determine winner
  const playerSurvivors = survivors.filter(s => s.faction === "player");
  const enemySurvivors = survivors.filter(s => s.faction === "enemy");
  
  let victory = false;
  let winnerFaction: Faction | null = null;
  
  if (playerSurvivors.length > 0 && enemySurvivors.length === 0) {
    victory = true;
    winnerFaction = "player";
  } else if (enemySurvivors.length > 0 && playerSurvivors.length === 0) {
    victory = false;
    winnerFaction = "enemy";
  }
  
  // Calculate XP from defeated enemies
  const defeatedEnemies = defeated.filter(d => d.faction === "enemy");
  const xpEarned = defeatedEnemies.reduce((sum, enemy) => {
    const level = Math.max(1, Math.floor(enemy.maxHp / 10));
    return sum + level * 50;
  }, 0);
  
  // Generate loot from defeated enemies
  const loot = generateLootFromDefeated(defeatedEnemies, gameState.tick);
  
  return {
    victory,
    winnerFaction,
    survivors,
    defeated,
    xpEarned,
    loot,
    combatDuration: gameState.tick - combatStartTick,
    locationId,
    wasAmbush,
  };
}

export interface CombatLogEntry {
  readonly type: "damage" | "kill" | "heal" | "status";
  readonly sourceId: string;
  readonly targetId: string;
  readonly amount: number;
  readonly timestamp: number;
}

function generateLootFromDefeated(
  defeated: readonly CombatantOutcome[],
  seed: number
): LootItem[] {
  const loot: LootItem[] = [];
  
  for (let i = 0; i < defeated.length; i++) {
    const enemy = defeated[i];
    const roll = seededRandom(seed + i * 100);
    
    // Base gold drop
    const goldAmount = Math.floor(10 + enemy.maxHp * 0.5 + roll * 20);
    loot.push({
      itemId: `gold_${seed}_${i}`,
      name: "Gold Coins",
      type: "currency",
      rarity: "common",
      value: goldAmount,
    });
    
    // Chance for health potion
    if (roll < 0.3) {
      loot.push({
        itemId: `potion_${seed}_${i}`,
        name: "Health Potion",
        type: "consumable",
        rarity: "common",
        value: 25,
      });
    }
    
    // Rare drop chance
    if (roll < 0.1) {
      const rarityRoll = seededRandom(seed + i * 200);
      const rarity = rarityRoll < 0.5 ? "uncommon" : rarityRoll < 0.8 ? "rare" : "epic";
      loot.push({
        itemId: `equip_${seed}_${i}`,
        name: `${rarity.charAt(0).toUpperCase() + rarity.slice(1)} Equipment`,
        type: "equipment",
        rarity,
        value: rarity === "uncommon" ? 50 : rarity === "rare" ? 150 : 500,
      });
    }
  }
  
  return loot;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

// ============= Apply Combat Outcome =============

export interface ApplyCombatResult {
  readonly world: TravelWorldState;
  readonly events: readonly WorldEvent[];
  readonly playerXpGained: number;
  readonly playerLeveledUp: boolean;
  readonly newLevel: number;
  readonly lootAcquired: readonly LootItem[];
}

/**
 * Apply the results of combat to the world state.
 * This is the main function called when combat ends.
 */
export function applyCombatOutcome(
  world: TravelWorldState,
  outcome: CombatOutcome,
  playerId: string
): ApplyCombatResult {
  const events: WorldEvent[] = [];
  let newWorld = world;
  let playerLeveledUp = false;
  let newLevel = 0;
  
  // 1. Remove defeated entities from world factions
  for (const defeated of outcome.defeated) {
    if (defeated.faction === "enemy") {
      // Update kill count flag
      const currentKills = Number(World.getFlagValue(newWorld, "kill_count", 0));
      newWorld = updateWorldPreservingTravel(newWorld, World.setFlag(newWorld, "kill_count", currentKills + 1, playerId));
      
      events.push({
        type: "flag_set",
        entityId: playerId,
        description: `Enemy defeated: ${defeated.name}`,
        timestamp: Date.now(),
      });
    }
  }
  
  // 2. Award XP to player survivors
  const playerProgression = newWorld.playerProgression.get(playerId);
  if (playerProgression && outcome.xpEarned > 0) {
    const xpResult = Progression.gainXp(
      playerProgression,
      outcome.xpEarned,
      "combat",
      `Combat victory at ${outcome.locationId}`
    );
    
    newWorld = updateWorldPreservingTravel(newWorld, World.updatePlayerProgression(newWorld, xpResult.progression));
    playerLeveledUp = xpResult.leveledUp;
    newLevel = xpResult.newLevel;
    
    events.push({
      type: "xp_gained",
      entityId: playerId,
      value: outcome.xpEarned,
      description: `Gained ${outcome.xpEarned} XP from combat`,
      timestamp: Date.now(),
    });
    
    if (xpResult.leveledUp) {
      events.push({
        type: "level_up",
        entityId: playerId,
        value: xpResult.newLevel,
        description: `Level up! Now level ${xpResult.newLevel}`,
        timestamp: Date.now(),
      });
    }
  }
  
  // 3. Add loot to player inventory (stored as items in world)
  for (const item of outcome.loot) {
    const worldItem: Item = {
      id: item.itemId,
      name: item.name,
      description: `${item.rarity} ${item.type}`,
      type: item.type as any,
      rarity: item.rarity as any,
      value: item.value,
      weight: 1,
      stackable: item.type === "currency" || item.type === "consumable",
      maxStack: 99,
      statModifiers: {},
      storyTags: [],
    };
    newWorld = updateWorldPreservingTravel(newWorld, World.addItem(newWorld, worldItem));
    
    events.push({
      type: "item_acquired",
      entityId: playerId,
      targetId: item.itemId,
      description: `Acquired ${item.name}`,
      timestamp: Date.now(),
    });
  }
  
  // 4. Update NPC memory (who killed whom, who helped whom)
  for (const [npcId, npc] of newWorld.npcs) {
    const npcFaction = npc.factionId;
    
    // NPCs remember combat outcomes
    let emotionalImpact = 0;
    let memoryEvent = "";
    
    if (outcome.victory) {
      // Check if NPC's faction was involved
      const defeatedAllies = outcome.defeated.filter(d => 
        d.faction === "enemy" && npcFaction === d.faction
      );
      
      if (defeatedAllies.length > 0) {
        emotionalImpact = -3; // Negative if player killed allies
        memoryEvent = `Player killed ${defeatedAllies.length} of our allies`;
      } else {
        emotionalImpact = 1; // Slight positive for clearing threats
        memoryEvent = `Player cleared hostile forces at ${outcome.locationId}`;
      }
    } else {
      memoryEvent = `Player was defeated in combat at ${outcome.locationId}`;
      emotionalImpact = -1; // Shows weakness
    }
    
    const updatedNPC: NPC = {
      ...npc,
      memories: [
        {
          timestamp: Date.now(),
          event: memoryEvent,
          tags: [playerId, "combat", outcome.locationId],
          emotionalImpact,
          decay: 0.02,
        },
        ...npc.memories,
      ].slice(0, 50),
    };
    newWorld = updateWorldPreservingTravel(newWorld, World.updateNPC(newWorld, updatedNPC));
  }
  
  // 5. Update quest progress
  for (const [questId, quest] of newWorld.quests) {
    if (quest.state !== "active") continue;
    
    let questUpdated = false;
    const updatedObjectives = quest.objectives.map(obj => {
      // Kill objectives
      if (obj.type === "kill") {
        const kills = outcome.defeated.filter(d => 
          d.faction === "enemy" && 
          (obj.targetType === "any" || d.name.toLowerCase().includes(obj.targetType.toLowerCase()))
        ).length;
        
        if (kills > 0) {
          questUpdated = true;
          return { ...obj, current: Math.min(obj.required, obj.current + kills) };
        }
      }
      
      // Combat-related explore objectives (survived combat at location)
      if (obj.type === "explore" && obj.targetId === outcome.locationId && outcome.victory) {
        questUpdated = true;
        return { ...obj, current: Math.min(obj.required, obj.current + 1) };
      }
      
      return obj;
    });
    
    if (questUpdated) {
      const updatedQuest: Quest = { ...quest, objectives: updatedObjectives };
      newWorld = updateWorldPreservingTravel(newWorld, World.updateQuest(newWorld, updatedQuest));
      
      // Check if quest is now complete
      const allComplete = updatedObjectives.every(obj => obj.current >= obj.required);
      if (allComplete && quest.state === "active") {
        events.push({
          type: "quest_progress",
          questId,
          description: `Quest ready for completion: ${quest.title}`,
          timestamp: Date.now(),
        });
      }
    }
  }
  
  // 6. Update story flags
  if (outcome.victory) {
    newWorld = updateWorldPreservingTravel(newWorld, World.setFlag(newWorld, `combat_won_${outcome.locationId}`, true, playerId));
    
    if (outcome.wasAmbush) {
      newWorld = updateWorldPreservingTravel(newWorld, World.setFlag(newWorld, `survived_ambush_${outcome.locationId}`, true, playerId));
    }
  } else {
    newWorld = updateWorldPreservingTravel(newWorld, World.setFlag(newWorld, `combat_lost_${outcome.locationId}`, true, playerId));
  }
  
  // 7. Update travel state (resume or retreat)
  if (outcome.victory) {
    // Continue to destination if was traveling
    if (newWorld.travelState.isInTransit && newWorld.travelState.transitDestinationId) {
      const newTravelState: TravelState = {
        ...newWorld.travelState,
        currentLocationId: newWorld.travelState.transitDestinationId,
        previousLocationId: newWorld.travelState.currentLocationId,
        isInTransit: false,
        transitProgress: 100,
        transitDestinationId: null,
        travelHistory: [
          ...newWorld.travelState.travelHistory,
          {
            locationId: newWorld.travelState.transitDestinationId,
            arrivedAt: Date.now(),
            departedAt: null,
          },
        ],
        discoveredLocations: new Set([
          ...newWorld.travelState.discoveredLocations,
          newWorld.travelState.transitDestinationId,
        ]),
      };
      newWorld = { ...newWorld, travelState: newTravelState };
      
      events.push({
        type: "location_arrived",
        entityId: playerId,
        targetId: newWorld.travelState.currentLocationId,
        description: `Arrived at destination after combat`,
        timestamp: Date.now(),
      });
    }
  } else {
    // Retreat to previous location
    if (newWorld.travelState.previousLocationId) {
      const newTravelState: TravelState = {
        ...newWorld.travelState,
        currentLocationId: newWorld.travelState.previousLocationId,
        isInTransit: false,
        transitProgress: 0,
        transitDestinationId: null,
      };
      newWorld = { ...newWorld, travelState: newTravelState };
      
      events.push({
        type: "location_arrived",
        entityId: playerId,
        targetId: newWorld.travelState.currentLocationId,
        description: `Retreated after defeat`,
        timestamp: Date.now(),
      });
    }
  }
  
  return {
    world: newWorld,
    events,
    playerXpGained: outcome.xpEarned,
    playerLeveledUp,
    newLevel,
    lootAcquired: outcome.loot,
  };
}

// ============= Quick Combat Result =============

/**
 * Simplified version using CombatResult from TravelPersistence
 */
export function applyCombatResult(
  world: TravelWorldState,
  result: CombatResult,
  playerId: string,
  locationId: string
): ApplyCombatResult {
  const outcome: CombatOutcome = {
    victory: result.victory,
    winnerFaction: result.victory ? "player" : "enemy",
    survivors: result.survivorIds.map(id => ({
      id,
      name: id,
      faction: "player" as Faction,
      finalHp: 1,
      maxHp: 1,
      damageDealt: 0,
      damageReceived: 0,
      killCount: 0,
      wasKilledBy: null,
    })),
    defeated: result.defeatedIds.map(id => ({
      id,
      name: id,
      faction: "enemy" as Faction,
      finalHp: 0,
      maxHp: 10,
      damageDealt: 0,
      damageReceived: 0,
      killCount: 0,
      wasKilledBy: null,
    })),
    xpEarned: result.xpEarned,
    loot: result.loot.map((lootId, i) => ({
      itemId: lootId,
      name: lootId,
      type: "consumable",
      rarity: "common",
      value: 10,
    })),
    combatDuration: 0,
    locationId,
    wasAmbush: false,
  };
  
  return applyCombatOutcome(world, outcome, playerId);
}
