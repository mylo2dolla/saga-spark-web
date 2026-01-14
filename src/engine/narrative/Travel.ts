/**
 * Travel system - handles movement between locations, time advancement,
 * random encounters, and location-based events.
 * Pure functions only - no mutations.
 */

import type { 
  WorldState, 
  WorldEvent, 
  Location, 
  NPC, 
  Quest as QuestType,
  EnhancedStatus,
} from "./types";
import * as World from "./World";
import * as QuestModule from "./Quest";

// ============= Enhanced Location Types =============

export type LocationType = 
  | "town" 
  | "city" 
  | "village" 
  | "dungeon" 
  | "wilderness" 
  | "ruins" 
  | "stronghold" 
  | "temple" 
  | "cave" 
  | "forest" 
  | "mountain" 
  | "coast" 
  | "swamp";

export interface EnhancedLocation extends Location {
  readonly type: LocationType;
  readonly factionControl: string | null;      // Faction ID that controls this location
  readonly dangerLevel: number;                // 1-10, affects encounter difficulty
  readonly travelTime: Record<string, number>; // Time to travel to connected locations
  readonly questHooks: readonly string[];      // Quest IDs available here
  readonly ambientDescription: string;
  readonly shops: readonly string[];           // NPC IDs of merchants
  readonly inn: boolean;                       // Can rest here
  readonly services: readonly LocationService[];
  readonly weather?: WeatherType;
  readonly currentEvents: readonly string[];   // Active event IDs
}

export type LocationService = 
  | "rest" 
  | "trade" 
  | "repair" 
  | "heal" 
  | "enchant" 
  | "stable" 
  | "bank";

export type WeatherType = 
  | "clear" 
  | "cloudy" 
  | "rain" 
  | "storm" 
  | "snow" 
  | "fog" 
  | "scorching";

// ============= Travel State =============

export interface TravelState {
  readonly currentLocationId: string;
  readonly previousLocationId: string | null;
  readonly isInTransit: boolean;
  readonly transitProgress: number;            // 0-100
  readonly transitDestinationId: string | null;
  readonly travelHistory: readonly TravelHistoryEntry[];
  readonly discoveredLocations: ReadonlySet<string>;
}

export interface TravelHistoryEntry {
  readonly locationId: string;
  readonly arrivedAt: number;
  readonly departedAt: number | null;
}

// ============= Travel Actions =============

export interface TravelAction {
  readonly type: "travel" | "cancel_travel" | "rest" | "explore_area";
  readonly entityId: string;
  readonly destinationId?: string;
  readonly restDuration?: number;
}

export interface TravelResult {
  readonly world: WorldState;
  readonly travelState: TravelState;
  readonly events: readonly WorldEvent[];
  readonly success: boolean;
  readonly message: string;
  readonly encounter?: EncounterResult;
}

// ============= Encounters =============

export type EncounterType = 
  | "combat" 
  | "merchant" 
  | "npc_random" 
  | "environmental" 
  | "discovery" 
  | "quest_hook"
  | "ambush";

export interface EncounterResult {
  readonly type: EncounterType;
  readonly description: string;
  readonly enemies?: readonly EncounterEnemy[];
  readonly npcId?: string;
  readonly itemsFound?: readonly string[];
  readonly questUnlocked?: string;
  readonly storyFlag?: string;
}

export interface EncounterEnemy {
  readonly name: string;
  readonly level: number;
  readonly type: string;
}

// ============= Factory Functions =============

export function createTravelState(startingLocationId: string): TravelState {
  return {
    currentLocationId: startingLocationId,
    previousLocationId: null,
    isInTransit: false,
    transitProgress: 0,
    transitDestinationId: null,
    travelHistory: [{
      locationId: startingLocationId,
      arrivedAt: Date.now(),
      departedAt: null,
    }],
    discoveredLocations: new Set([startingLocationId]),
  };
}

export function createEnhancedLocation(params: {
  id: string;
  name: string;
  description: string;
  type: LocationType;
  position: { x: number; y: number };
  connectedTo: string[];
  factionControl?: string;
  dangerLevel?: number;
  npcs?: string[];
  questHooks?: string[];
  services?: LocationService[];
  inn?: boolean;
}): EnhancedLocation {
  return {
    id: params.id,
    name: params.name,
    description: params.description,
    position: params.position,
    radius: params.type === "city" ? 50 : params.type === "town" ? 30 : 20,
    discovered: false,
    npcs: params.npcs ?? [],
    items: [],
    connectedTo: params.connectedTo,
    type: params.type,
    factionControl: params.factionControl ?? null,
    dangerLevel: params.dangerLevel ?? 1,
    travelTime: params.connectedTo.reduce((acc, id) => ({ ...acc, [id]: 1 }), {}),
    questHooks: params.questHooks ?? [],
    ambientDescription: `A ${params.type} known as ${params.name}.`,
    shops: [],
    inn: params.inn ?? (params.type === "town" || params.type === "city" || params.type === "village"),
    services: params.services ?? (params.type === "town" || params.type === "city" ? ["rest", "trade", "heal"] : []),
    currentEvents: [],
  };
}

// ============= Travel Validation =============

export function canTravel(
  world: WorldState,
  travelState: TravelState,
  entityId: string,
  destinationId: string,
  isInCombat: boolean,
  playerStatuses: readonly EnhancedStatus[]
): { canTravel: boolean; reason?: string } {
  // Cannot travel during combat
  if (isInCombat) {
    return { canTravel: false, reason: "Cannot travel during combat" };
  }
  
  // Cannot travel while in transit
  if (travelState.isInTransit) {
    return { canTravel: false, reason: "Already traveling" };
  }
  
  // Check for blocking status effects
  const blockingStatuses = ["stunned", "imprisoned", "paralyzed", "rooted"];
  const hasBlockingStatus = playerStatuses.some(s => 
    blockingStatuses.some(bs => s.name.toLowerCase().includes(bs))
  );
  if (hasBlockingStatus) {
    return { canTravel: false, reason: "Cannot travel while incapacitated" };
  }
  
  // Check if destination is connected
  const currentLocation = world.locations.get(travelState.currentLocationId);
  if (!currentLocation) {
    return { canTravel: false, reason: "Current location unknown" };
  }
  
  if (!currentLocation.connectedTo.includes(destinationId)) {
    return { canTravel: false, reason: "Destination is not connected to current location" };
  }
  
  // Check story locks
  const storyLocked = world.storyFlags.get(`location_locked:${destinationId}`);
  if (storyLocked?.value === true) {
    return { canTravel: false, reason: "This path is blocked by story events" };
  }
  
  return { canTravel: true };
}

// ============= Travel Processing =============

export function startTravel(
  world: WorldState,
  travelState: TravelState,
  entityId: string,
  destinationId: string
): TravelResult {
  const currentLocation = world.locations.get(travelState.currentLocationId) as EnhancedLocation | undefined;
  const destination = world.locations.get(destinationId) as EnhancedLocation | undefined;
  
  if (!currentLocation || !destination) {
    return {
      world,
      travelState,
      events: [],
      success: false,
      message: "Invalid location",
    };
  }
  
  const events: WorldEvent[] = [];
  
  // Update travel history
  const newHistory = travelState.travelHistory.map((entry, idx) => 
    idx === travelState.travelHistory.length - 1 
      ? { ...entry, departedAt: Date.now() }
      : entry
  );
  
  const newTravelState: TravelState = {
    ...travelState,
    isInTransit: true,
    transitProgress: 0,
    transitDestinationId: destinationId,
    previousLocationId: travelState.currentLocationId,
    travelHistory: newHistory,
  };
  
  events.push({
    type: "location_discovered",
    entityId,
    targetId: destinationId,
    description: `Departed ${currentLocation.name}, traveling to ${destination.name}`,
    timestamp: Date.now(),
  });
  
  return {
    world,
    travelState: newTravelState,
    events,
    success: true,
    message: `Started traveling to ${destination.name}`,
  };
}

export function completeTravel(
  world: WorldState,
  travelState: TravelState,
  entityId: string,
  seed: number
): TravelResult {
  if (!travelState.isInTransit || !travelState.transitDestinationId) {
    return {
      world,
      travelState,
      events: [],
      success: false,
      message: "Not in transit",
    };
  }
  
  const destinationId = travelState.transitDestinationId;
  const destination = world.locations.get(destinationId) as EnhancedLocation | undefined;
  
  if (!destination) {
    return {
      world,
      travelState,
      events: [],
      success: false,
      message: "Destination not found",
    };
  }
  
  let newWorld = world;
  const events: WorldEvent[] = [];
  
  // Discover location if not already discovered
  if (!destination.discovered) {
    const discoveredLocation: EnhancedLocation = { ...destination, discovered: true };
    newWorld = World.updateLocation(newWorld, discoveredLocation);
    
    events.push({
      type: "location_discovered",
      entityId,
      targetId: destinationId,
      description: `Discovered ${destination.name}`,
      timestamp: Date.now(),
    });
  }
  
  // Update travel state
  const newDiscovered = new Set(travelState.discoveredLocations);
  newDiscovered.add(destinationId);
  
  const newTravelState: TravelState = {
    ...travelState,
    currentLocationId: destinationId,
    isInTransit: false,
    transitProgress: 100,
    transitDestinationId: null,
    discoveredLocations: newDiscovered,
    travelHistory: [
      ...travelState.travelHistory,
      {
        locationId: destinationId,
        arrivedAt: Date.now(),
        departedAt: null,
      },
    ],
  };
  
  // Advance world time
  const travelTime = (destination as EnhancedLocation).travelTime?.[travelState.currentLocationId] ?? 1;
  newWorld = World.advanceTime(newWorld, travelTime);
  
  // Tick quests
  const questResult = World.tickAllQuests(newWorld);
  newWorld = questResult.world;
  events.push(...questResult.events);
  
  // Check for random encounter
  const encounter = rollForEncounter(destination, seed);
  
  events.push({
    type: "location_discovered",
    entityId,
    targetId: destinationId,
    description: `Arrived at ${destination.name}`,
    timestamp: Date.now(),
  });
  
  // Update NPC availability based on location
  for (const [npcId, npc] of newWorld.npcs) {
    // NPCs at this location become available
    if (destination.npcs.includes(npcId)) {
      events.push({
        type: "npc_spoke",
        entityId,
        targetId: npcId,
        description: `${npc.name} is present at ${destination.name}`,
        timestamp: Date.now(),
      });
    }
  }
  
  return {
    world: newWorld,
    travelState: newTravelState,
    events,
    success: true,
    message: `Arrived at ${destination.name}`,
    encounter,
  };
}

// ============= Encounter System =============

function rollForEncounter(
  location: EnhancedLocation,
  seed: number
): EncounterResult | undefined {
  // Simple seeded random
  const random = ((seed * 9301 + 49297) % 233280) / 233280;
  
  // Higher danger = higher encounter chance
  const encounterChance = location.dangerLevel * 0.1;
  
  if (random > encounterChance) {
    return undefined;
  }
  
  const encounterRoll = ((seed * 7919 + 1) % 100);
  
  if (location.type === "dungeon" || location.type === "ruins") {
    return {
      type: "combat",
      description: "Hostile creatures emerge from the shadows!",
      enemies: generateEnemies(location.dangerLevel, seed),
    };
  }
  
  if (location.type === "wilderness" || location.type === "forest") {
    if (encounterRoll < 50) {
      return {
        type: "combat",
        description: "Bandits ambush you on the road!",
        enemies: generateEnemies(Math.max(1, location.dangerLevel - 1), seed),
      };
    }
    return {
      type: "discovery",
      description: "You discover a hidden cache of supplies.",
      itemsFound: ["health_potion"],
    };
  }
  
  return {
    type: "npc_random",
    description: "A traveling merchant offers their wares.",
  };
}

function generateEnemies(level: number, seed: number): EncounterEnemy[] {
  const count = 1 + Math.floor(((seed * 1237) % 3));
  const enemyTypes = ["goblin", "bandit", "skeleton", "wolf", "orc", "cultist"];
  
  return Array.from({ length: count }, (_, i) => ({
    name: `${enemyTypes[(seed + i) % enemyTypes.length]} ${i + 1}`,
    level: Math.max(1, level + (((seed + i) % 3) - 1)),
    type: enemyTypes[(seed + i) % enemyTypes.length],
  }));
}

// ============= Location Queries =============

export function getConnectedLocations(
  world: WorldState,
  locationId: string
): EnhancedLocation[] {
  const location = world.locations.get(locationId);
  if (!location) return [];
  
  return location.connectedTo
    .map(id => world.locations.get(id) as EnhancedLocation)
    .filter((loc): loc is EnhancedLocation => loc !== undefined);
}

export function getNPCsAtLocation(
  world: WorldState,
  locationId: string
): NPC[] {
  const location = world.locations.get(locationId);
  if (!location) return [];
  
  return location.npcs
    .map(npcId => world.npcs.get(npcId))
    .filter((npc): npc is NPC => npc !== undefined);
}

export function getQuestsAtLocation(
  world: WorldState,
  locationId: string
): Quest[] {
  const location = world.locations.get(locationId) as EnhancedLocation | undefined;
  if (!location) return [];
  
  return (location.questHooks ?? [])
    .map(questId => world.quests.get(questId))
    .filter((quest): quest is Quest => quest !== undefined);
}

export function getLocationsByFaction(
  world: WorldState,
  factionId: string
): EnhancedLocation[] {
  return Array.from(world.locations.values())
    .filter((loc): loc is EnhancedLocation => 
      (loc as EnhancedLocation).factionControl === factionId
    );
}

// ============= Location Events =============

export function processLocationEvents(
  world: WorldState,
  travelState: TravelState,
  entityId: string
): { world: WorldState; events: WorldEvent[] } {
  const events: WorldEvent[] = [];
  let newWorld = world;
  
  const location = world.locations.get(travelState.currentLocationId) as EnhancedLocation | undefined;
  if (!location) return { world, events };
  
  // Check if faction control affects anything
  if (location.factionControl) {
    const faction = world.campaignSeed.factions.find(f => f.id === location.factionControl);
    if (faction) {
      // Hostile factions may restrict services
      events.push({
        type: "flag_set",
        entityId,
        description: `This area is controlled by ${faction.name}`,
        timestamp: Date.now(),
      });
    }
  }
  
  return { world: newWorld, events };
}

// ============= Time & World Tick =============

export function worldTick(
  world: WorldState,
  travelState: TravelState,
  timePassed: number
): { world: WorldState; travelState: TravelState; events: WorldEvent[] } {
  let newWorld = World.advanceTime(world, timePassed);
  const events: WorldEvent[] = [];
  
  // Tick quests
  const questResult = World.tickAllQuests(newWorld);
  newWorld = questResult.world;
  events.push(...questResult.events);
  
  // NPCs may move between locations based on time
  // (simplified - in full version would have NPC schedules)
  
  // Status effects tick
  // (handled separately in combat engine)
  
  // Faction control may change
  // (would be driven by story events)
  
  return { 
    world: newWorld, 
    travelState, 
    events,
  };
}

// ============= Serialization =============

export function serializeTravelState(state: TravelState): string {
  return JSON.stringify({
    ...state,
    discoveredLocations: Array.from(state.discoveredLocations),
  });
}

export function deserializeTravelState(json: string): TravelState {
  const data = JSON.parse(json);
  return {
    ...data,
    discoveredLocations: new Set(data.discoveredLocations),
  };
}
