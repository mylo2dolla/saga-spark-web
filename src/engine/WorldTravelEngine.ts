/**
 * World Travel Engine
 * This module owns the travel loop and is the primary world clock.
 * Travel advances time, ticks statuses, advances quests, and triggers encounters.
 */

import type { WorldState, WorldEvent, Quest, NPC } from "./narrative/types";
import type { TravelWorldState } from "./narrative/TravelPersistence";
import type { TravelState, EnhancedLocation, EncounterResult } from "./narrative/Travel";
import type { CombatEncounter, CombatSpawnData } from "./narrative/TravelPersistence";
import type { Entity, Vec2, GameState } from "./types";
import * as World from "./narrative/World";
import * as Travel from "./narrative/Travel";
import { rollDangerousEncounter, spawnEncounterEntities } from "./TravelCombatBridge";
import { encounterToCombat } from "./narrative/TravelPersistence";

// ============= Travel Engine Types =============

export interface TravelStep {
  readonly progress: number;
  readonly worldTimeAdvanced: number;
  readonly statusesApplied: readonly StatusTick[];
  readonly questsUpdated: readonly string[];
  readonly encounterTriggered: boolean;
  readonly encounter: CombatEncounter | null;
}

export interface StatusTick {
  readonly entityId: string;
  readonly statusId: string;
  readonly effect: string;
  readonly value: number;
}

export interface BeginTravelResult {
  readonly success: boolean;
  readonly message: string;
  readonly world: TravelWorldState;
  readonly travelState: TravelState;
  readonly events: readonly WorldEvent[];
  readonly steps: readonly TravelStep[];
  readonly combatTriggered: boolean;
  readonly combatEncounter: CombatEncounter | null;
  readonly combatEntities: readonly Entity[];
  readonly arrived: boolean;
}

// ============= Main Travel Functions =============

/**
 * Begin travel to a target location.
 * This is the main entry point for engine-driven travel.
 * 
 * The travel loop:
 * 1. Validate travel is possible
 * 2. Calculate travel time based on distance
 * 3. Advance world time in steps
 * 4. Each step: tick statuses, tick quests, roll encounter
 * 5. If encounter: stop and return combat data
 * 6. If no encounter: complete travel
 */
export function beginTravel(
  world: TravelWorldState,
  targetLocationId: string,
  playerId: string,
  isInCombat: boolean = false
): BeginTravelResult {
  const events: WorldEvent[] = [];
  const steps: TravelStep[] = [];
  let currentWorld = world;
  let currentTravelState = world.travelState;
  
  // Validate travel
  const validation = Travel.canTravel(
    world,
    currentTravelState,
    playerId,
    targetLocationId,
    isInCombat,
    [] // Would get player statuses
  );
  
  if (!validation.canTravel) {
    return {
      success: false,
      message: validation.reason,
      world,
      travelState: world.travelState,
      events: [],
      steps: [],
      combatTriggered: false,
      combatEncounter: null,
      combatEntities: [],
      arrived: false,
    };
  }
  
  // Get locations
  const currentLocation = world.locations.get(currentTravelState.currentLocationId) as EnhancedLocation | undefined;
  const targetLocation = world.locations.get(targetLocationId) as EnhancedLocation | undefined;
  
  if (!currentLocation || !targetLocation) {
    return {
      success: false,
      message: "Location not found",
      world,
      travelState: world.travelState,
      events: [],
      steps: [],
      combatTriggered: false,
      combatEncounter: null,
      combatEntities: [],
      arrived: false,
    };
  }
  
  // Calculate travel time (1-5 time units based on connection)
  const travelTime = calculateTravelTime(currentLocation, targetLocation);
  
  // Start travel
  currentTravelState = {
    ...currentTravelState,
    isInTransit: true,
    transitDestinationId: targetLocationId,
    transitProgress: 0,
    previousLocationId: currentTravelState.currentLocationId,
    travelHistory: [
      ...currentTravelState.travelHistory.map(h => 
        h.locationId === currentTravelState.currentLocationId && h.departedAt === null
          ? { ...h, departedAt: Date.now() }
          : h
      ),
    ],
  };
  
  events.push({
    type: "travel_started",
    entityId: playerId,
    targetId: targetLocationId,
    description: `Began traveling to ${targetLocation.name}`,
    timestamp: Date.now(),
  });
  
  // Process travel in steps (each step = 1 time unit)
  let combatTriggered = false;
  let combatEncounter: CombatEncounter | null = null;
  let combatEntities: Entity[] = [];
  const playerLevel = getPlayerLevel(currentWorld, playerId);
  
  for (let step = 0; step < travelTime && !combatTriggered; step++) {
    const stepSeed = Date.now() + step * 1000;
    const progressPerStep = 100 / travelTime;
    
    // Advance world time
    currentWorld = { ...currentWorld, globalTime: currentWorld.globalTime + 1 };
    
    // Tick quests
    const questResult = World.tickAllQuests(currentWorld);
    currentWorld = questResult.world;
    events.push(...questResult.events);
    
    // Collect updated quest IDs
    const updatedQuestIds = questResult.events
      .filter(e => e.type === "quest_progress" || e.type === "quest_failed")
      .map(e => e.questId!)
      .filter(Boolean);
    
    // Tick NPC schedules (some may move or become unavailable)
    currentWorld = tickNPCs(currentWorld);
    
    // Roll for random encounter
    const encounter = rollDangerousEncounter(
      currentWorld,
      currentTravelState,
      targetLocationId,
      stepSeed
    );
    
    if (encounter) {
      // Convert to combat encounter
      const combat = encounterToCombat(encounter, playerLevel, stepSeed);
      
      if (combat) {
        combatTriggered = true;
        combatEncounter = combat;
        combatEntities = spawnEncounterEntities(combat);
        
        events.push({
          type: "encounter_triggered",
          entityId: playerId,
          description: combat.description,
          timestamp: Date.now(),
        });
        
        steps.push({
          progress: currentTravelState.transitProgress + progressPerStep,
          worldTimeAdvanced: 1,
          statusesApplied: [],
          questsUpdated: updatedQuestIds,
          encounterTriggered: true,
          encounter: combat,
        });
        
        // Update travel state with progress
        currentTravelState = {
          ...currentTravelState,
          transitProgress: currentTravelState.transitProgress + progressPerStep,
        };
        
        break; // Stop travel loop - combat takes over
      }
    }
    
    // Update progress
    currentTravelState = {
      ...currentTravelState,
      transitProgress: currentTravelState.transitProgress + progressPerStep,
    };
    
    steps.push({
      progress: currentTravelState.transitProgress,
      worldTimeAdvanced: 1,
      statusesApplied: [],
      questsUpdated: updatedQuestIds,
      encounterTriggered: false,
      encounter: null,
    });
  }
  
  // If no combat, complete travel
  let arrived = false;
  if (!combatTriggered) {
    currentTravelState = {
      ...currentTravelState,
      currentLocationId: targetLocationId,
      isInTransit: false,
      transitProgress: 100,
      transitDestinationId: null,
      travelHistory: [
        ...currentTravelState.travelHistory,
        {
          locationId: targetLocationId,
          arrivedAt: Date.now(),
          departedAt: null,
        },
      ],
      discoveredLocations: new Set([
        ...currentTravelState.discoveredLocations,
        targetLocationId,
      ]),
    };
    
    arrived = true;
    
    events.push({
      type: "location_arrived",
      entityId: playerId,
      targetId: targetLocationId,
      description: `Arrived at ${targetLocation.name}`,
      timestamp: Date.now(),
    });
    
    // Grant discovery XP if first visit
    if (!world.travelState.discoveredLocations.has(targetLocationId)) {
      events.push({
        type: "location_discovered",
        entityId: playerId,
        targetId: targetLocationId,
        description: `Discovered ${targetLocation.name}`,
        timestamp: Date.now(),
      });
    }
  }
  
  currentWorld = { ...currentWorld, travelState: currentTravelState };
  
  return {
    success: true,
    message: combatTriggered 
      ? `Travel interrupted by ${combatEncounter?.description ?? "encounter"}!`
      : `Arrived at ${targetLocation.name}`,
    world: currentWorld,
    travelState: currentTravelState,
    events,
    steps,
    combatTriggered,
    combatEncounter,
    combatEntities,
    arrived,
  };
}

/**
 * Resume travel after combat ends.
 * If player won, continue to destination.
 * If player lost, return to previous location.
 */
export function resumeTravelAfterCombat(
  world: TravelWorldState,
  playerId: string,
  combatVictory: boolean
): BeginTravelResult {
  if (!world.travelState.isInTransit || !world.travelState.transitDestinationId) {
    return {
      success: false,
      message: "Not currently traveling",
      world,
      travelState: world.travelState,
      events: [],
      steps: [],
      combatTriggered: false,
      combatEncounter: null,
      combatEntities: [],
      arrived: false,
    };
  }
  
  if (combatVictory) {
    // Continue to destination - no more encounters on this leg
    const targetLocation = world.locations.get(world.travelState.transitDestinationId) as EnhancedLocation | undefined;
    
    const newTravelState: TravelState = {
      ...world.travelState,
      currentLocationId: world.travelState.transitDestinationId,
      isInTransit: false,
      transitProgress: 100,
      transitDestinationId: null,
      travelHistory: [
        ...world.travelState.travelHistory,
        {
          locationId: world.travelState.transitDestinationId,
          arrivedAt: Date.now(),
          departedAt: null,
        },
      ],
      discoveredLocations: new Set([
        ...world.travelState.discoveredLocations,
        world.travelState.transitDestinationId,
      ]),
    };
    
    const events: WorldEvent[] = [{
      type: "location_arrived",
      entityId: playerId,
      targetId: world.travelState.transitDestinationId,
      description: `Arrived at ${targetLocation?.name ?? "destination"} after combat victory`,
      timestamp: Date.now(),
    }];
    
    return {
      success: true,
      message: `Arrived at ${targetLocation?.name ?? "destination"}`,
      world: { ...world, travelState: newTravelState },
      travelState: newTravelState,
      events,
      steps: [],
      combatTriggered: false,
      combatEncounter: null,
      combatEntities: [],
      arrived: true,
    };
  } else {
    // Retreat to previous location
    const previousLocation = world.locations.get(world.travelState.previousLocationId ?? world.travelState.currentLocationId) as EnhancedLocation | undefined;
    
    const newTravelState: TravelState = {
      ...world.travelState,
      currentLocationId: world.travelState.previousLocationId ?? world.travelState.currentLocationId,
      isInTransit: false,
      transitProgress: 0,
      transitDestinationId: null,
    };
    
    const events: WorldEvent[] = [{
      type: "location_arrived",
      entityId: playerId,
      targetId: newTravelState.currentLocationId,
      description: `Retreated to ${previousLocation?.name ?? "safety"} after defeat`,
      timestamp: Date.now(),
    }];
    
    return {
      success: true,
      message: `Retreated to ${previousLocation?.name ?? "safety"}`,
      world: { ...world, travelState: newTravelState },
      travelState: newTravelState,
      events,
      steps: [],
      combatTriggered: false,
      combatEncounter: null,
      combatEntities: [],
      arrived: true,
    };
  }
}

// ============= Helper Functions =============

function calculateTravelTime(from: EnhancedLocation, to: EnhancedLocation): number {
  // Base travel time is 1-5 based on connection
  const isConnected = from.connectedLocations?.includes(to.id) ?? false;
  
  if (!isConnected) {
    return 5; // Unconnected locations take max time
  }
  
  // Use location types to determine time
  const dangerLevel = to.dangerLevel ?? 1;
  const baseTravelTime = 1 + Math.floor(dangerLevel / 2);
  
  return Math.min(5, Math.max(1, baseTravelTime));
}

function getPlayerLevel(world: TravelWorldState, playerId: string): number {
  const progression = world.playerProgression.get(playerId);
  return progression?.level ?? 1;
}

function tickNPCs(world: TravelWorldState): TravelWorldState {
  // NPCs can have schedules that change based on time
  // For now, just return world unchanged
  // Future: Move NPCs, update availability, etc.
  return world;
}

// ============= Quick Travel Check =============

/**
 * Check if player can travel to a location without actually starting travel.
 */
export function canBeginTravel(
  world: TravelWorldState,
  targetLocationId: string,
  playerId: string,
  isInCombat: boolean
): { canTravel: boolean; reason: string } {
  const travelResult = Travel.canTravel(
    world,
    world.travelState,
    playerId,
    targetLocationId,
    isInCombat,
    []
  );
  return { canTravel: travelResult.canTravel, reason: travelResult.reason ?? "" };
}

/**
 * Get all reachable locations from current position.
 */
export function getReachableLocations(world: TravelWorldState): EnhancedLocation[] {
  const currentLocation = world.locations.get(world.travelState.currentLocationId) as EnhancedLocation | undefined;
  
  if (!currentLocation) {
    return [];
  }
  
  const connectedIds = currentLocation.connectedLocations || currentLocation.connectedTo || [];
  
  return connectedIds
    .map(id => world.locations.get(id) as EnhancedLocation | undefined)
    .filter((loc): loc is EnhancedLocation => loc !== undefined);
}

/**
 * Get travel info for UI display.
 */
export function getTravelInfo(world: TravelWorldState): {
  currentLocation: EnhancedLocation | undefined;
  reachableLocations: EnhancedLocation[];
  isInTransit: boolean;
  transitProgress: number;
  destination: EnhancedLocation | undefined;
} {
  const currentLocation = world.locations.get(world.travelState.currentLocationId) as EnhancedLocation | undefined;
  const reachableLocations = getReachableLocations(world);
  const destination = world.travelState.transitDestinationId 
    ? world.locations.get(world.travelState.transitDestinationId) as EnhancedLocation | undefined
    : undefined;
  
  return {
    currentLocation,
    reachableLocations,
    isInTransit: world.travelState.isInTransit,
    transitProgress: world.travelState.transitProgress,
    destination,
  };
}
