/**
 * Unified game session hook that manages the complete game lifecycle:
 * - Loading AI-generated content
 * - Initializing engine state
 * - Persistence with autosave
 * - Per-player travel authority
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorldContent } from "@/hooks/useWorldContent";
import { useGamePersistence } from "@/hooks/useGamePersistence";
import { createUnifiedState, type UnifiedState } from "@/engine/UnifiedState";
import * as World from "@/engine/narrative/World";
import { createTravelState, type TravelState, type EnhancedLocation } from "@/engine/narrative/Travel";
import { type TravelWorldState, deserializeTravelWorldState, createTravelWorldState } from "@/engine/narrative/TravelPersistence";
import type { CampaignSeed, WorldState } from "@/engine/narrative/types";
import { toast } from "sonner";

export interface GameSessionState {
  unifiedState: UnifiedState | null;
  travelState: TravelState | null;
  campaignSeed: CampaignSeed | null;
  isInitialized: boolean;
  isLoading: boolean;
  playtimeSeconds: number;
}

interface UseGameSessionOptions {
  campaignId: string;
}

export function useGameSession({ campaignId }: UseGameSessionOptions) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  
  const { content: worldContent, isLoading: contentLoading, hasLoadedContent, mergeIntoWorldState } = useWorldContent({ campaignId });
  const persistence = useGamePersistence({ campaignId, userId });
  
  const [sessionState, setSessionState] = useState<GameSessionState>({
    unifiedState: null,
    travelState: null,
    campaignSeed: null,
    isInitialized: false,
    isLoading: true,
    playtimeSeconds: 0,
  });
  
  const playtimeRef = useRef(0);
  const playtimeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveIdRef = useRef<string | null>(null);

  // Initialize session from saved state or fresh
  const initializeSession = useCallback(async () => {
    if (!campaignId || !userId) return;
    
    setSessionState(prev => ({ ...prev, isLoading: true }));
    
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
          travelState = worldWithTravel.travelState ?? createTravelState("starting_location");
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

        // Add a default starting location if none exists from AI content
        if (unifiedState.world.locations.size === 0) {
          const defaultStartingLocation: EnhancedLocation = {
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

          unifiedState = {
            ...unifiedState,
            world: {
              ...unifiedState.world,
              locations: new Map([[defaultStartingLocation.id, defaultStartingLocation]]),
            },
          };
        }

        const locationsArray = Array.from(unifiedState.world.locations.values());
        const startingLocation =
          locationsArray.find(location => location.id === "starting_location") ?? locationsArray[0];
        const startingLocationId = startingLocation?.id ?? "starting_location";

        if (
          startingLocation &&
          startingLocation.connectedTo.length === 0 &&
          locationsArray.length > 1
        ) {
          const fallbackDestination = locationsArray.find(location => location.id !== startingLocationId);
          if (fallbackDestination) {
            const nextLocations = new Map(unifiedState.world.locations);
            nextLocations.set(startingLocationId, {
              ...startingLocation,
              connectedTo: [fallbackDestination.id],
            });
            if (!fallbackDestination.connectedTo.includes(startingLocationId)) {
              nextLocations.set(fallbackDestination.id, {
                ...fallbackDestination,
                connectedTo: [...fallbackDestination.connectedTo, startingLocationId],
              });
            }
            unifiedState = {
              ...unifiedState,
              world: {
                ...unifiedState.world,
                locations: nextLocations,
              },
            };
          }
        }

        // Initialize travel state with starting location
        travelState = createTravelState(startingLocationId);
      }
      
      // Initialize player progression if needed
      if (userId && !unifiedState.world.playerProgression.has(userId)) {
        unifiedState = {
          ...unifiedState,
          world: World.initPlayerProgression(unifiedState.world, userId),
        };
      }
      
      playtimeRef.current = initialPlaytime;
      
      setSessionState({
        unifiedState,
        travelState,
        campaignSeed: unifiedState.world.campaignSeed,
        isInitialized: true,
        isLoading: false,
        playtimeSeconds: initialPlaytime,
      });
      
    } catch (error) {
      console.error("Failed to initialize game session:", error);
      toast.error("Failed to load game");
      setSessionState(prev => ({ ...prev, isLoading: false }));
    }
  }, [campaignId, userId, worldContent, mergeIntoWorldState, persistence]);

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
      const travelState = worldWithTravel.travelState ?? createTravelState("starting_location");
      
      lastSaveIdRef.current = saveId;
      
      setSessionState(prev => ({
        ...prev,
        unifiedState: loaded,
        travelState,
        isInitialized: true,
      }));
      
      return true;
    }
    return false;
  }, [persistence]);

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
    if (!userId || !campaignId) {
      setSessionState(prev => ({
        ...prev,
        isLoading: false,
        isInitialized: false,
      }));
      return;
    }

    if (!hasLoadedContent || contentLoading) {
      return;
    }

    if (!contentLoading) {
      initializeSession();
    }
  }, [userId, campaignId, contentLoading, hasLoadedContent, initializeSession]);

  useEffect(() => {
    if (!sessionState.unifiedState || !worldContent) return;
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
