/**
 * Travel state persistence - extends WorldState with travel data
 * for complete save/restore functionality.
 * Pure functions only - no mutations.
 */

import type { WorldState, Location } from "./types";
import type { TravelState, EnhancedLocation, EncounterResult, EncounterEnemy } from "./Travel";
import * as Travel from "./Travel";

// ============= Extended World State with Travel =============

export interface TravelWorldState extends WorldState {
  readonly travelState: TravelState;
}

export interface SerializedTravelState {
  readonly currentLocationId: string;
  readonly previousLocationId: string | null;
  readonly isInTransit: boolean;
  readonly transitProgress: number;
  readonly transitDestinationId: string | null;
  readonly travelHistory: readonly {
    readonly locationId: string;
    readonly arrivedAt: number;
    readonly departedAt: number | null;
  }[];
  readonly discoveredLocations: string[];
}

// ============= Serialization =============

export function serializeTravelWorldState(world: TravelWorldState): string {
  return JSON.stringify({
    campaignSeed: world.campaignSeed,
    npcs: Array.from(world.npcs.entries()),
    quests: Array.from(world.quests.entries()),
    items: Array.from(world.items.entries()),
    locations: Array.from(world.locations.entries()),
    storyFlags: Array.from(world.storyFlags.entries()),
    globalTime: world.globalTime,
    playerProgression: Array.from(world.playerProgression.entries()),
    travelState: {
      currentLocationId: world.travelState.currentLocationId,
      previousLocationId: world.travelState.previousLocationId,
      isInTransit: world.travelState.isInTransit,
      transitProgress: world.travelState.transitProgress,
      transitDestinationId: world.travelState.transitDestinationId,
      travelHistory: world.travelState.travelHistory,
      discoveredLocations: Array.from(world.travelState.discoveredLocations),
    },
  });
}

export function deserializeTravelWorldState(json: string): TravelWorldState {
  const data = JSON.parse(json);
  const locations = normalizeLocationEntries(data.locations);
  
  // Handle legacy data without travel state
  const travelState: TravelState = data.travelState 
    ? {
        currentLocationId: data.travelState.currentLocationId,
        previousLocationId: data.travelState.previousLocationId,
        isInTransit: data.travelState.isInTransit,
        transitProgress: data.travelState.transitProgress,
        transitDestinationId: data.travelState.transitDestinationId,
        travelHistory: data.travelState.travelHistory,
        discoveredLocations: new Set(data.travelState.discoveredLocations),
      }
    : Travel.createTravelState(getFirstLocationId(data));
  
  return {
    campaignSeed: data.campaignSeed,
    npcs: new Map(data.npcs),
    quests: new Map(data.quests),
    items: new Map(data.items),
    locations: new Map(locations),
    storyFlags: new Map(data.storyFlags),
    globalTime: data.globalTime,
    playerProgression: new Map(data.playerProgression),
    travelState,
  };
}

function getFirstLocationId(data: any): string {
  const entries = normalizeLocationEntries(data.locations);
  if (entries.length > 0) {
    // locations is array of [id, location] tuples
    return entries[0][0];
  }
  return "starting_location";
}

function normalizeLocationEntries(locations: unknown): Array<[string, Location]> {
  if (!locations) {
    return [];
  }
  if (Array.isArray(locations)) {
    return locations as Array<[string, Location]>;
  }
  if (typeof locations === "object") {
    return Object.entries(locations as Record<string, Location>);
  }
  return [];
}

// ============= Travel State Helpers =============

export function createTravelWorldState(
  world: WorldState,
  startingLocationId: string
): TravelWorldState {
  return {
    ...world,
    travelState: Travel.createTravelState(startingLocationId),
  };
}

export function updateTravelState(
  world: TravelWorldState,
  travelState: TravelState
): TravelWorldState {
  return { ...world, travelState };
}

// ============= Encounter to Combat Bridge =============

export interface CombatEncounter {
  readonly triggered: boolean;
  readonly type: "ambush" | "combat" | "boss";
  readonly enemies: readonly CombatSpawnData[];
  readonly description: string;
  readonly xpReward: number;
  readonly lootTable: readonly string[];
}

export interface CombatSpawnData {
  readonly id: string;
  readonly name: string;
  readonly faction: "enemy";
  readonly position: { x: number; y: number };
  readonly hp: number;
  readonly maxHp: number;
  readonly ac: number;
  readonly initiative: number;
  readonly level: number;
  readonly type: string;
  readonly damage: string;
}

/**
 * Convert encounter result from travel to spawnable combat entities.
 */
export function encounterToCombat(
  encounter: EncounterResult,
  playerLevel: number,
  seed: number
): CombatEncounter | null {
  if (!encounter.enemies || encounter.enemies.length === 0) {
    return null;
  }
  
  const enemies: CombatSpawnData[] = encounter.enemies.map((enemy, index) => {
    const enemyStats = getEnemyStats(enemy.type, enemy.level);
    
    // Position enemies on the far side of the board
    const position = {
      x: 8 + (index % 3),
      y: 2 + Math.floor(index / 3),
    };
    
    return {
      id: `enemy_${seed}_${index}`,
      name: enemy.name,
      faction: "enemy" as const,
      position,
      hp: enemyStats.hp,
      maxHp: enemyStats.hp,
      ac: enemyStats.ac,
      initiative: enemyStats.initiative + randomFromSeed(seed + index, 10),
      level: enemy.level,
      type: enemy.type,
      damage: enemyStats.damage,
    };
  });
  
  const totalXp = enemies.reduce((sum, e) => sum + calculateEnemyXp(e.level, playerLevel), 0);
  
  return {
    triggered: true,
    type: encounter.type === "ambush" ? "ambush" : "combat",
    enemies,
    description: encounter.description,
    xpReward: totalXp,
    lootTable: generateLootTable(enemies, seed),
  };
}

function getEnemyStats(type: string, level: number): {
  hp: number;
  ac: number;
  initiative: number;
  damage: string;
} {
  const baseStats: Record<string, { hp: number; ac: number; initiative: number; damage: string }> = {
    goblin: { hp: 7, ac: 13, initiative: 14, damage: "1d6" },
    bandit: { hp: 11, ac: 12, initiative: 12, damage: "1d8" },
    skeleton: { hp: 13, ac: 13, initiative: 14, damage: "1d6" },
    wolf: { hp: 11, ac: 13, initiative: 16, damage: "2d4" },
    orc: { hp: 15, ac: 13, initiative: 8, damage: "1d12" },
    cultist: { hp: 9, ac: 12, initiative: 12, damage: "1d6" },
    zombie: { hp: 22, ac: 8, initiative: 6, damage: "1d6" },
    giant_spider: { hp: 26, ac: 14, initiative: 16, damage: "1d8+2" },
    ogre: { hp: 59, ac: 11, initiative: 8, damage: "2d8+4" },
    troll: { hp: 84, ac: 15, initiative: 13, damage: "1d6+4" },
  };
  
  const base = baseStats[type] ?? { hp: 10, ac: 12, initiative: 10, damage: "1d6" };
  
  // Scale by level
  const levelMultiplier = 1 + (level - 1) * 0.2;
  
  return {
    hp: Math.floor(base.hp * levelMultiplier),
    ac: base.ac + Math.floor((level - 1) / 3),
    initiative: base.initiative,
    damage: base.damage,
  };
}

function calculateEnemyXp(enemyLevel: number, playerLevel: number): number {
  const baseXp = enemyLevel * 50;
  const levelDiff = enemyLevel - playerLevel;
  
  // Bonus for higher level enemies, penalty for lower
  const multiplier = 1 + levelDiff * 0.1;
  return Math.max(10, Math.floor(baseXp * multiplier));
}

function generateLootTable(enemies: readonly CombatSpawnData[], seed: number): string[] {
  const loot: string[] = [];
  
  // Each enemy has a chance to drop loot
  enemies.forEach((enemy, i) => {
    const roll = randomFromSeed(seed + i * 100, 100);
    
    if (roll < 30) {
      loot.push("health_potion");
    }
    if (roll < 10) {
      loot.push("gold_coins");
    }
    if (enemy.level >= 3 && roll < 15) {
      loot.push("rare_material");
    }
  });
  
  return loot;
}

function randomFromSeed(seed: number, max: number): number {
  const x = Math.sin(seed * 9999) * 10000;
  return Math.floor((x - Math.floor(x)) * max);
}

// ============= Combat Result Processing =============

export interface CombatResult {
  readonly victory: boolean;
  readonly xpEarned: number;
  readonly loot: readonly string[];
  readonly survivorIds: readonly string[];
  readonly defeatedIds: readonly string[];
}

/**
 * Process combat results and update world state.
 */
export function processCombatResult(
  world: TravelWorldState,
  result: CombatResult,
  playerId: string
): TravelWorldState {
  let newWorld = world;
  
  // XP is already handled by the combat system's kill events
  // Just ensure travel state is restored properly
  
  if (result.victory) {
    // Player continues to destination
    if (world.travelState.isInTransit && world.travelState.transitDestinationId) {
      // Mark as arrived (transit is complete after combat)
      const newTravelState: TravelState = {
        ...world.travelState,
        isInTransit: false,
        transitProgress: 100,
      };
      newWorld = updateTravelState(newWorld, newTravelState);
    }
  } else {
    // Player defeated - return to previous location
    if (world.travelState.previousLocationId) {
      const newTravelState: TravelState = {
        ...world.travelState,
        currentLocationId: world.travelState.previousLocationId,
        isInTransit: false,
        transitProgress: 0,
        transitDestinationId: null,
      };
      newWorld = updateTravelState(newWorld, newTravelState);
    }
  }
  
  return newWorld;
}

// ============= Location Events on Arrival =============

export interface LocationArrivalEvents {
  readonly questsUpdated: readonly string[];
  readonly npcsMet: readonly string[];
  readonly itemsFound: readonly string[];
  readonly flagsSet: readonly string[];
}

/**
 * Process arrival at a location and update world state.
 */
export function processLocationArrival(
  world: TravelWorldState,
  locationId: string,
  playerId: string
): { world: TravelWorldState; events: LocationArrivalEvents } {
  const location = world.locations.get(locationId) as EnhancedLocation | undefined;
  
  if (!location) {
    return { 
      world, 
      events: { questsUpdated: [], npcsMet: [], itemsFound: [], flagsSet: [] } 
    };
  }
  
  const events: LocationArrivalEvents = {
    questsUpdated: [],
    npcsMet: location.npcs as string[],
    itemsFound: [],
    flagsSet: [],
  };
  
  // Check for quest objectives related to this location
  const updatedQuests: string[] = [];
  let newWorld = world;
  const newQuests = new Map(world.quests);
  
  for (const [questId, quest] of world.quests) {
    if (quest.state !== "active") continue;
    
    // Check for explore objectives
    const hasExploreObjective = quest.objectives.some(obj => 
      obj.type === "explore" && obj.targetId === locationId && obj.current < obj.required
    );
    
    if (hasExploreObjective) {
      const updatedObjectives = quest.objectives.map(obj => {
        if (obj.type === "explore" && obj.targetId === locationId) {
          return { ...obj, current: obj.current + 1 };
        }
        return obj;
      });
      
      newQuests.set(questId, { ...quest, objectives: updatedObjectives });
      updatedQuests.push(questId);
    }
  }
  
  if (updatedQuests.length > 0) {
    newWorld = { ...newWorld, quests: newQuests };
  }
  
  return { 
    world: newWorld, 
    events: { ...events, questsUpdated: updatedQuests } 
  };
}
