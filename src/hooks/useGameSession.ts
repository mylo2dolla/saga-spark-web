/**
 * Unified game session hook that manages the complete game lifecycle:
 * - Loading AI-generated content
 * - Initializing engine state
 * - Persistence with autosave
 * - Per-player travel authority
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorldContent } from "@/hooks/useWorldContent";
import { useGamePersistence } from "@/hooks/useGamePersistence";
import { createUnifiedState, type UnifiedState } from "@/engine/UnifiedState";
import * as World from "@/engine/narrative/World";
import { createTravelState, type TravelState, type EnhancedLocation } from "@/engine/narrative/Travel";
import { type TravelWorldState } from "@/engine/narrative/TravelPersistence";
import type { CampaignSeed } from "@/engine/narrative/types";
import { toast } from "sonner";

const DEFAULT_STARTING_LOCATION: EnhancedLocation = {
  id: "starting_location",
  name: "Haven Village",
  description: "A peaceful village at the crossroads of adventure. Travelers gather here before venturing into the unknown.",
  type: "town",
  connectedTo: [],
  position: { x: 100, y: 100 },
  radius: 30,
  discovered: true,
  items: [],
  dangerLevel: 1,
  npcs: [],
  factionControl: null,
  questHooks: [],
  services: ["rest", "trade", "heal"] as const,
  ambientDescription: "The sounds of a bustling marketplace fill the air. Smoke rises from the inn's chimney.",
  shops: [],
  inn: true,
  travelTime: {},
  currentEvents: [],
};

export interface GameSessionState {
  unifiedState: UnifiedState | null;
  travelState: TravelState | null;
  campaignSeed: CampaignSeed | null;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  playtimeSeconds: number;
}

interface UseGameSessionOptions {
  campaignId: string;
}

export function useGameSession({ campaignId }: UseGameSessionOptions) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  
  const { content: worldContent, hasLoadedContent, mergeIntoWorldState } = useWorldContent({ campaignId });
  const persistence = useGamePersistence({ campaignId, userId });
  
  const [sessionState, setSessionState] = useState<GameSessionState>({
    unifiedState: null,
    travelState: null,
    campaignSeed: null,
    isInitialized: false,
    isLoading: true,
    error: null,
    playtimeSeconds: 0,
  });
  
  const playtimeRef = useRef(0);
  const playtimeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveIdRef = useRef<string | null>(null);
  const lastMergedContentRef = useRef<typeof worldContent>(null);
  const hasInitializedRef = useRef(false);

  const ensureWorldInvariants = useCallback((
    unified: UnifiedState,
    travel: TravelState | null
  ): { unified: UnifiedState; travel: TravelState } => {
    let nextWorld = unified.world;
    let locations = new Map(nextWorld.locations);
    let nextTravel = travel ?? createTravelState(DEFAULT_STARTING_LOCATION.id);

    if (locations.size === 0) {
      locations.set(DEFAULT_STARTING_LOCATION.id, DEFAULT_STARTING_LOCATION);
    }

    const locationIds = Array.from(locations.keys());
    let currentLocationId = nextTravel.currentLocationId;
    if (!locations.has(currentLocationId)) {
      currentLocationId = locationIds[0];
    }

    if (nextTravel.isInTransit && nextTravel.transitDestinationId) {
      if (!locations.has(nextTravel.transitDestinationId)) {
        nextTravel = {
          ...nextTravel,
          isInTransit: false,
          transitProgress: 0,
          transitDestinationId: null,
        };
      }
    }

    if (currentLocationId !== nextTravel.currentLocationId) {
      nextTravel = {
        ...nextTravel,
        currentLocationId,
        previousLocationId: nextTravel.previousLocationId ?? null,
        discoveredLocations: new Set([
          ...Array.from(nextTravel.discoveredLocations),
          currentLocationId,
        ]),
      };
    }

    const currentLocation = locations.get(currentLocationId);
    if (currentLocation && currentLocation.connectedTo.length === 0 && locations.size > 1) {
      const fallbackDestination = locationIds.find(id => id !== currentLocationId);
      if (fallbackDestination) {
        locations.set(currentLocationId, {
          ...currentLocation,
          connectedTo: [fallbackDestination],
        });
        const fallbackLocation = locations.get(fallbackDestination);
        if (fallbackLocation && !fallbackLocation.connectedTo.includes(currentLocationId)) {
          locations.set(fallbackDestination, {
            ...fallbackLocation,
            connectedTo: [...fallbackLocation.connectedTo, currentLocationId],
          });
        }
      }
    }

    if (locations !== nextWorld.locations) {
      nextWorld = {
        ...nextWorld,
        locations,
      };
    }

    return {
      unified: {
        ...unified,
        world: nextWorld,
      },
      travel: nextTravel,
    };
  }, []);

  // Initialize session from saved state or fresh
  const initializeSession = useCallback(async () => {
    if (!campaignId || !userId) return;
    
    setSessionState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      // Fetch campaign info
      const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .select("name, description")
        .eq("id", campaignId)
        .single();
      
      if (campaignError) throw campaignError;
      
      // Fetch saves directly to ensure we have latest data
      const { data: savesData, error: savesError } = await supabase
        .from("game_saves")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(10);

      if (savesError) throw savesError;
      
      const existingSaves = savesData ?? [];
      const latestSave = existingSaves[0]; // Most recent
      
      let unifiedState: UnifiedState;
      let travelState: TravelState;
      let initialPlaytime = 0;
      
      if (latestSave) {
        // Load from save
        const loaded = await persistence.loadGame(latestSave.id);
        if (loaded) {
          unifiedState = loaded;
          
          // Extract travel state from world state if available
          const worldWithTravel = loaded.world as unknown as TravelWorldState;
          travelState = worldWithTravel.travelState ?? createTravelState(DEFAULT_STARTING_LOCATION.id);
          initialPlaytime = latestSave.playtime_seconds;
          lastSaveIdRef.current = latestSave.id;
          
          // Re-merge world content to pick up any new generated content
          if (worldContent) {
            unifiedState = {
              ...unifiedState,
              world: mergeIntoWorldState(unifiedState.world, worldContent),
            };
          }
        } else {
          throw new Error("Failed to load save");
        }
      } else {
        // Create fresh state
        const campaignSeed: CampaignSeed = {
          id: campaignId,
          title: campaign.name,
          description: campaign.description ?? "",
          themes: [],
          factions: [],
          createdAt: Date.now(),
        };
        
        // Create base state
        unifiedState = createUnifiedState(campaignSeed, [], 10, 12);

        // Merge in generated content if available (this will add locations, NPCs, etc.)
        if (worldContent) {
          unifiedState = {
            ...unifiedState,
            world: mergeIntoWorldState(unifiedState.world, worldContent),
          };
        }

        // Initialize travel state with starting location
        travelState = createTravelState(DEFAULT_STARTING_LOCATION.id);
      }

      const invariantResult = ensureWorldInvariants(unifiedState, travelState);
      unifiedState = invariantResult.unified;
      travelState = invariantResult.travel;
      
      // Initialize player progression if needed
      if (userId && !unifiedState.world.playerProgression.has(userId)) {
        unifiedState = {
          ...unifiedState,
          world: World.initPlayerProgression(unifiedState.world, userId),
        };
      }
      
      playtimeRef.current = initialPlaytime;
      if (worldContent) {
        lastMergedContentRef.current = worldContent;
      }
      
      setSessionState({
        unifiedState,
        travelState,
        campaignSeed: unifiedState.world.campaignSeed,
        isInitialized: true,
        isLoading: false,
        error: null,
        playtimeSeconds: initialPlaytime,
      });
      
    } catch (error) {
      console.error("Failed to initialize game session:", error);
      const message = error instanceof Error ? error.message : "Failed to load game";
      toast.error(message);
      setSessionState(prev => ({
        ...prev,
        isInitialized: false,
        isLoading: false,
        error: message,
      }));
    }
  }, [
    campaignId,
    userId,
    worldContent,
    mergeIntoWorldState,
    persistence,
    ensureWorldInvariants,
  ]);

  // Update unified state
  const updateUnifiedState = useCallback((updater: (state: UnifiedState) => UnifiedState) => {
    setSessionState(prev => {
      if (!prev.unifiedState) return prev;
      return {
        ...prev,
        unifiedState: updater(prev.unifiedState),
      };
    });
  }, []);

  // Update travel state
  const updateTravelState = useCallback((updater: (state: TravelState) => TravelState) => {
    setSessionState(prev => {
      if (!prev.travelState) return prev;
      return {
        ...prev,
        travelState: updater(prev.travelState),
      };
    });
  }, []);

  // Autosave function - includes travel state in updates
  const autosave = useCallback(async () => {
    if (!sessionState.unifiedState || !sessionState.travelState || !userId) return;
    
    try {
      if (lastSaveIdRef.current) {
        // Update existing save with travel state
        await persistence.updateSave(
          lastSaveIdRef.current,
          sessionState.unifiedState,
          playtimeRef.current,
          sessionState.travelState
        );
      } else {
        // Create new autosave
        const saveId = await persistence.saveGame(
          sessionState.unifiedState,
          sessionState.travelState,
          "Autosave",
          playtimeRef.current
        );
        if (saveId) {
          lastSaveIdRef.current = saveId;
        }
      }
    } catch (error) {
      console.error("Autosave failed:", error);
    }
  }, [sessionState.unifiedState, sessionState.travelState, userId, persistence]);

  // Trigger autosave with debounce
  const triggerAutosave = useCallback(() => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }
    autosaveTimeoutRef.current = setTimeout(autosave, 2000);
  }, [autosave]);

  // Manual save
  const saveGame = useCallback(async (saveName: string) => {
    if (!sessionState.unifiedState || !sessionState.travelState) {
      toast.error("No game state to save");
      return null;
    }
    
    return persistence.saveGame(
      sessionState.unifiedState,
      sessionState.travelState,
      saveName,
      playtimeRef.current
    );
  }, [sessionState.unifiedState, sessionState.travelState, persistence]);

  // Load specific save
  const loadSave = useCallback(async (saveId: string) => {
    const loaded = await persistence.loadGame(saveId);
    if (loaded) {
      const worldWithTravel = loaded.world as unknown as TravelWorldState;
      const travelState = worldWithTravel.travelState ?? createTravelState(DEFAULT_STARTING_LOCATION.id);
      const invariantResult = ensureWorldInvariants(loaded, travelState);
      
      lastSaveIdRef.current = saveId;
      
      setSessionState(prev => ({
        ...prev,
        unifiedState: invariantResult.unified,
        travelState: invariantResult.travel,
        isInitialized: true,
      }));
      
      return true;
    }
    return false;
  }, [persistence, ensureWorldInvariants]);

  // Start playtime tracking
  useEffect(() => {
    if (!sessionState.isInitialized) return;
    
    playtimeIntervalRef.current = setInterval(() => {
      playtimeRef.current += 1;
      setSessionState(prev => ({ ...prev, playtimeSeconds: playtimeRef.current }));
    }, 1000);
    
    return () => {
      if (playtimeIntervalRef.current) {
        clearInterval(playtimeIntervalRef.current);
      }
    };
  }, [sessionState.isInitialized]);

  // Autosave on unload
  useEffect(() => {
    const handleUnload = () => {
      autosave();
    };
    
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [autosave]);

  // Initialize on mount
  useEffect(() => {
    hasInitializedRef.current = false;
  }, [userId, campaignId]);

  useEffect(() => {
    if (!campaignId || !userId) {
      setSessionState(prev => ({
        ...prev,
        isInitialized: false,
        isLoading: false,
        error: null,
      }));
      hasInitializedRef.current = false;
      return;
    }
    if (!hasLoadedContent) return;
    if (hasInitializedRef.current) return;

    hasInitializedRef.current = true;
    void initializeSession().catch(error => {
      console.error("Failed to initialize game session:", error);
      const message = error instanceof Error ? error.message : "Failed to load game";
      hasInitializedRef.current = false;
      setSessionState(prev => ({
        ...prev,
        isInitialized: false,
        isLoading: false,
        error: message,
      }));
    });
  }, [userId, campaignId, hasLoadedContent, initializeSession]);

  useEffect(() => {
    if (!sessionState.unifiedState || !worldContent) return;
    if (lastMergedContentRef.current === worldContent) return;
    lastMergedContentRef.current = worldContent;
    setSessionState(prev => {
      if (!prev.unifiedState) return prev;
      return {
        ...prev,
        unifiedState: {
          ...prev.unifiedState,
          world: mergeIntoWorldState(prev.unifiedState.world, worldContent),
        },
      };
    });
  }, [worldContent, mergeIntoWorldState, sessionState.unifiedState]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
      if (playtimeIntervalRef.current) {
        clearInterval(playtimeIntervalRef.current);
      }
    };
  }, []);

  return {
    ...sessionState,
    saves: persistence.saves,
    isSaving: persistence.isSaving,
    updateUnifiedState,
    updateTravelState,
    saveGame,
    loadSave,
    triggerAutosave,
    fetchSaves: persistence.fetchSaves,
    deleteSave: persistence.deleteSave,
  };
}
