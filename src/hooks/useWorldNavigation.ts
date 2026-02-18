/**
 * Hook for world navigation - bridges UI navigation to engine travel system.
 * Handles travel validation, encounter triggering, and combat initiation.
 */

import { useState, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { TravelState, EnhancedLocation, EncounterResult } from "@/engine/narrative/Travel";
import type { TravelWorldState, CombatEncounter } from "@/engine/narrative/TravelPersistence";
import type { WorldState, WorldEvent, CharacterProgression } from "@/engine/narrative/types";
import type { Entity } from "@/engine/types";
import * as Travel from "@/engine/narrative/Travel";
import * as TravelPersistence from "@/engine/narrative/TravelPersistence";
import * as TravelCombatBridge from "@/engine/TravelCombatBridge";

export interface UseWorldNavigationOptions {
  world: WorldState;
  travelState: TravelState;
  isInCombat: boolean;
  playerId: string;
  playerLevel: number;
  onWorldUpdate: (world: WorldState) => void;
  onTravelStateUpdate: (travelState: TravelState) => void;
  onWorldEvent?: (event: WorldEvent) => void;
  onCombatStart?: (encounter: CombatEncounter, enemies: Entity[]) => void;
}

export interface WorldNavigationState {
  isNavigating: boolean;
  pendingDestination: string | null;
  pendingEncounter: CombatEncounter | null;
  navigationError: string | null;
}

export function useWorldNavigation(options: UseWorldNavigationOptions) {
  const {
    world,
    travelState,
    isInCombat,
    playerId,
    playerLevel,
    onWorldUpdate,
    onTravelStateUpdate,
    onWorldEvent,
    onCombatStart,
  } = options;
  
  const navigate = useNavigate();
  
  const [navState, setNavState] = useState<WorldNavigationState>({
    isNavigating: false,
    pendingDestination: null,
    pendingEncounter: null,
    navigationError: null,
  });
  
  // Get current location data
  const currentLocation = world.locations.get(travelState.currentLocationId) as EnhancedLocation | undefined;
  const connectedLocations = Travel.getConnectedLocations(world, travelState.currentLocationId);
  const npcsAtLocation = Travel.getNPCsAtLocation(world, travelState.currentLocationId);
  const questsAtLocation = Travel.getQuestsAtLocation(world, travelState.currentLocationId);
  
  /**
   * Validate if travel to a destination is possible.
   */
  const canTravelTo = useCallback((destinationId: string): { valid: boolean; reason?: string } => {
    const validation = Travel.canTravel(
      world,
      travelState,
      playerId,
      destinationId,
      isInCombat,
      [] // Player statuses - would come from entity
    );
    
    return {
      valid: validation.canTravel,
      reason: validation.reason,
    };
  }, [world, travelState, playerId, isInCombat]);
  
  /**
   * Initiate travel to a destination.
   * This is the main entry point for map-driven navigation.
   */
  const travelTo = useCallback((destinationId: string) => {
    // Validate travel
    const validation = canTravelTo(destinationId);
    if (!validation.valid) {
      setNavState(prev => ({
        ...prev,
        navigationError: validation.reason ?? "Cannot travel to this location",
      }));
      return;
    }
    
    setNavState(prev => ({
      ...prev,
      isNavigating: true,
      pendingDestination: destinationId,
      navigationError: null,
    }));
    
    // Start travel in engine
    const startResult = Travel.startTravel(world, travelState, playerId, destinationId);
    if (!startResult.success) {
      setNavState(prev => ({
        ...prev,
        isNavigating: false,
        navigationError: startResult.message,
      }));
      return;
    }
    
    // Emit departure events
    startResult.events.forEach(e => onWorldEvent?.(e));
    
    // Roll for encounter during travel
    const seed = Date.now();
    const encounter = TravelCombatBridge.rollDangerousEncounter(
      startResult.world,
      startResult.travelState,
      destinationId,
      seed
    );
    
    if (encounter && encounter.type === "combat") {
      // Combat encounter triggered!
      const combatEncounter = TravelPersistence.encounterToCombat(encounter, playerLevel, seed);
      
      if (combatEncounter) {
        // Generate combat entities
        const enemies = TravelCombatBridge.spawnEncounterEntities(combatEncounter);
        
        setNavState(prev => ({
          ...prev,
          pendingEncounter: combatEncounter,
        }));
        
        // Notify parent to start combat
        onCombatStart?.(combatEncounter, enemies);
        
        // Update travel state to in-transit (will complete after combat)
        onTravelStateUpdate(startResult.travelState);
        onWorldUpdate(startResult.world);
        
        // Navigate to combat view
        navigate("/combat");
        return;
      }
    }
    
    // No encounter - complete travel immediately
    const completeResult = Travel.completeTravel(
      startResult.world,
      startResult.travelState,
      playerId,
      seed
    );
    
    // Process location arrival events
    const arrivalResult = TravelPersistence.processLocationArrival(
      { ...completeResult.world, travelState: completeResult.travelState } as TravelPersistence.TravelWorldState,
      destinationId,
      playerId
    );
    
    // Emit all events
    completeResult.events.forEach(e => onWorldEvent?.(e));
    
    // Update state
    onTravelStateUpdate(completeResult.travelState);
    onWorldUpdate(arrivalResult.world);
    
    setNavState(prev => ({
      ...prev,
      isNavigating: false,
      pendingDestination: null,
    }));
    
    // Navigate to the new location
    navigate(`/location/${destinationId}`);
  }, [
    world,
    travelState,
    playerId,
    playerLevel,
    canTravelTo,
    onWorldUpdate,
    onTravelStateUpdate,
    onWorldEvent,
    onCombatStart,
    navigate,
  ]);
  
  /**
   * Handle combat completion and resume travel.
   */
  const handleCombatEnd = useCallback((victory: boolean) => {
    const pendingDest = navState.pendingDestination;
    
    if (!pendingDest) {
      // No pending destination - just return to current location
      setNavState(prev => ({
        ...prev,
        isNavigating: false,
        pendingEncounter: null,
      }));
      navigate(`/location/${travelState.currentLocationId}`);
      return;
    }
    
    if (victory) {
      // Complete travel to destination
      const completeResult = Travel.completeTravel(
        world,
        travelState,
        playerId,
        Date.now()
      );
      
      completeResult.events.forEach(e => onWorldEvent?.(e));
      onTravelStateUpdate(completeResult.travelState);
      onWorldUpdate(completeResult.world);
      
      setNavState(prev => ({
        ...prev,
        isNavigating: false,
        pendingDestination: null,
        pendingEncounter: null,
      }));
      
      navigate(`/location/${pendingDest}`);
    } else {
      // Retreat to previous location
      const retreatState: TravelState = {
        ...travelState,
        isInTransit: false,
        transitProgress: 0,
        transitDestinationId: null,
      };
      
      onTravelStateUpdate(retreatState);
      
      setNavState(prev => ({
        ...prev,
        isNavigating: false,
        pendingDestination: null,
        pendingEncounter: null,
      }));
      
      const retreatLocation = travelState.previousLocationId ?? travelState.currentLocationId;
      navigate(`/location/${retreatLocation}`);
    }
  }, [
    world,
    travelState,
    playerId,
    navState.pendingDestination,
    onWorldUpdate,
    onTravelStateUpdate,
    onWorldEvent,
    navigate,
  ]);
  
  /**
   * Navigate to an NPC dialog.
   */
  const talkToNPC = useCallback((npcId: string) => {
    navigate(`/npc/${npcId}`);
  }, [navigate]);
  
  /**
   * Navigate to a quest detail view.
   */
  const viewQuest = useCallback((questId: string) => {
    navigate(`/quest/${questId}`);
  }, [navigate]);
  
  /**
   * Open the world map.
   */
  const openMap = useCallback(() => {
    navigate("/map");
  }, [navigate]);
  
  /**
   * Return to current location from map/other views.
   */
  const returnToLocation = useCallback(() => {
    navigate(`/location/${travelState.currentLocationId}`);
  }, [navigate, travelState.currentLocationId]);
  
  // Clear navigation error after a timeout
  useEffect(() => {
    if (navState.navigationError) {
      const timer = setTimeout(() => {
        setNavState(prev => ({ ...prev, navigationError: null }));
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [navState.navigationError]);
  
  return {
    // State
    currentLocation,
    connectedLocations,
    npcsAtLocation,
    questsAtLocation,
    travelState,
    isNavigating: navState.isNavigating,
    pendingEncounter: navState.pendingEncounter,
    navigationError: navState.navigationError,
    
    // Actions
    travelTo,
    canTravelTo,
    handleCombatEnd,
    talkToNPC,
    viewQuest,
    openMap,
    returnToLocation,
  };
}
