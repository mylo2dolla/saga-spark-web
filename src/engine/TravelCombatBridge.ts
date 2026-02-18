/**
 * Bridge between the travel/encounter system and the physics combat engine.
 * Handles spawning combat entities from travel encounters and processing results.
 */

import type { Entity, Vec2, Faction, GameState } from "./types";
import type { CombatSpawnData, CombatEncounter, CombatResult } from "./narrative/TravelPersistence";
import type { TravelState, EncounterResult, EncounterEnemy, EnhancedLocation } from "./narrative/Travel";
import type { WorldState, WorldEvent } from "./narrative/types";
import { encounterToCombat } from "./narrative/TravelPersistence";

// ============= Entity Spawning from Encounters =============

/**
 * Create engine entities from combat encounter data.
 */
export function spawnEncounterEntities(
  encounter: CombatEncounter
): Entity[] {
  return encounter.enemies.map(enemy => createEnemyEntity(enemy));
}

function createEnemyEntity(data: CombatSpawnData): Entity {
  return {
    id: data.id,
    name: data.name,
    faction: "enemy" as Faction,
    position: { x: data.position.x, y: data.position.y },
    velocity: { x: 0, y: 0 },
    radius: 0.4,
    mass: 1,
    hp: data.hp,
    maxHp: data.maxHp,
    ac: data.ac,
    initiative: data.initiative,
    isAlive: true,
    statusEffects: [],
  };
}

// ============= Encounter Danger Calculation =============

export interface TravelDangerFactors {
  readonly baseDanger: number;       // From location danger level
  readonly factionHostility: number; // 0-1 based on player's faction standing
  readonly timeOfDay: number;        // 0-1, higher at night
  readonly playerNotoriety: number;  // 0-1 based on player actions
  readonly worldFlags: number;       // Modifier from story state
}

/**
 * Calculate encounter chance based on multiple factors.
 */
export function calculateEncounterChance(factors: TravelDangerFactors): number {
  const base = factors.baseDanger * 0.1; // 10% per danger level
  const hostility = factors.factionHostility * 0.2;
  const time = factors.timeOfDay * 0.15;
  const notoriety = factors.playerNotoriety * 0.1;
  const flags = factors.worldFlags;
  
  return Math.min(0.95, base + hostility + time + notoriety + flags);
}

/**
 * Roll for an encounter with full danger calculation.
 */
export function rollDangerousEncounter(
  world: WorldState,
  travelState: TravelState,
  destinationId: string,
  seed: number
): EncounterResult | undefined {
  const destination = world.locations.get(destinationId);
  if (!destination) return undefined;
  
  // Get enhanced location data
  const enhancedLoc = destination as EnhancedLocation;
  const dangerLevel = enhancedLoc.dangerLevel ?? 1;
  const factionControl = enhancedLoc.factionControl;
  
  // Calculate faction hostility
  let factionHostility = 0;
  if (factionControl) {
    const faction = world.campaignSeed.factions.find(f => f.id === factionControl);
    if (faction?.alignment?.includes("evil")) {
      factionHostility = 0.5;
    }
  }
  
  // Time of day from global time
  const hourOfDay = (world.globalTime % 24);
  const isNight = hourOfDay >= 20 || hourOfDay < 6;
  const timeOfDay = isNight ? 0.8 : 0.2;
  
  // Player notoriety from story flags
  const killCount = Number(world.storyFlags.get("kill_count")?.value ?? 0);
  const playerNotoriety = Math.min(1, killCount / 50);
  
  // World flag modifiers
  let worldFlags = 0;
  if (world.storyFlags.get("war_active")?.value) worldFlags += 0.3;
  if (world.storyFlags.get("plague_spreading")?.value) worldFlags += 0.1;
  if (world.storyFlags.get("bandit_suppressed")?.value) worldFlags -= 0.2;
  
  const factors: TravelDangerFactors = {
    baseDanger: dangerLevel,
    factionHostility,
    timeOfDay,
    playerNotoriety,
    worldFlags,
  };
  
  const encounterChance = calculateEncounterChance(factors);
  
  // Seeded random roll
  const roll = seededRandom(seed);
  
  if (roll > encounterChance) {
    return undefined;
  }
  
  // Generate encounter based on location type
  return generateLocationEncounter(enhancedLoc, dangerLevel, seed);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

function generateLocationEncounter(
  location: EnhancedLocation,
  dangerLevel: number,
  seed: number
): EncounterResult {
  const locationType = location.type ?? "wilderness";
  const roll = Math.floor(seededRandom(seed * 7919) * 100);
  
  // Determine encounter type and enemies
  const encounterTypes: Record<string, { enemies: string[]; description: string }> = {
    dungeon: {
      enemies: ["skeleton", "zombie", "cultist", "giant_spider"],
      description: "Dark creatures emerge from the shadows!",
    },
    ruins: {
      enemies: ["skeleton", "ghost", "golem", "cultist"],
      description: "Ancient guardians stir to life!",
    },
    wilderness: {
      enemies: ["wolf", "bandit", "goblin", "orc"],
      description: "Hostile forces block your path!",
    },
    forest: {
      enemies: ["wolf", "spider", "bandit", "goblin"],
      description: "The forest hides dangerous predators!",
    },
    mountain: {
      enemies: ["orc", "troll", "giant", "harpy"],
      description: "Mountain dwellers descend upon you!",
    },
    swamp: {
      enemies: ["zombie", "giant_spider", "lizardfolk", "hydra"],
      description: "Swamp creatures rise from the mire!",
    },
    cave: {
      enemies: ["goblin", "orc", "troll", "giant_spider"],
      description: "Cave dwellers attack from the darkness!",
    },
  };
  
  const config = encounterTypes[locationType] ?? encounterTypes.wilderness;
  
  // Determine enemy count based on danger level
  const baseCount = 1 + Math.floor(dangerLevel / 3);
  const variance = Math.floor(seededRandom(seed * 1237) * 2) - 1;
  const enemyCount = Math.max(1, Math.min(6, baseCount + variance));
  
  // Generate enemies
  const enemies: EncounterEnemy[] = Array.from({ length: enemyCount }, (_, i) => {
    const typeIndex = Math.floor(seededRandom(seed + i * 100) * config.enemies.length);
    const type = config.enemies[typeIndex];
    const levelVariance = Math.floor(seededRandom(seed + i * 200) * 3) - 1;
    const level = Math.max(1, dangerLevel + levelVariance);
    
    return {
      name: `${capitalize(type)} ${i + 1}`,
      level,
      type,
    };
  });
  
  // Determine if this is an ambush
  const isAmbush = seededRandom(seed * 3571) < 0.3;
  
  return {
    type: isAmbush ? "ambush" : "combat",
    description: isAmbush ? `Ambush! ${config.description}` : config.description,
    enemies,
  };
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");
}

// ============= Combat End Processing =============

/**
 * Process the end of combat and return to travel state.
 */
export function processCombatEnd(
  gameState: GameState,
  playerId: string
): CombatResult {
  const playerAlive = Array.from(gameState.entities.values())
    .filter(e => e.faction === "player" && e.isAlive)
    .length > 0;
  
  const survivors = Array.from(gameState.entities.values())
    .filter(e => e.isAlive)
    .map(e => e.id);
  
  const defeated = Array.from(gameState.entities.values())
    .filter(e => !e.isAlive)
    .map(e => e.id);
  
  // Calculate XP from defeated enemies
  const defeatedEnemies = Array.from(gameState.entities.values())
    .filter(e => e.faction === "enemy" && !e.isAlive);
  
  const xpEarned = defeatedEnemies.reduce((sum, enemy) => {
    const level = Math.max(1, Math.floor(enemy.maxHp / 10));
    return sum + level * 50;
  }, 0);
  
  return {
    victory: playerAlive,
    xpEarned,
    loot: [], // Would be determined by loot tables
    survivorIds: survivors,
    defeatedIds: defeated,
  };
}

// ============= Event Generation =============

/**
 * Generate world events from combat results.
 */
export function generateCombatWorldEvents(
  result: CombatResult,
  playerId: string,
  location: string
): WorldEvent[] {
  const events: WorldEvent[] = [];
  
  if (result.victory) {
    events.push({
      type: "flag_set",
      entityId: playerId,
      description: `Victory in combat at ${location}!`,
      timestamp: Date.now(),
    });
    
    if (result.xpEarned > 0) {
      events.push({
        type: "xp_gained",
        entityId: playerId,
        value: result.xpEarned,
        description: `Earned ${result.xpEarned} XP from combat`,
        timestamp: Date.now(),
      });
    }
  } else {
    events.push({
      type: "flag_set",
      entityId: playerId,
      description: `Defeated in combat at ${location}. Retreating...`,
      timestamp: Date.now(),
    });
  }
  
  return events;
}
