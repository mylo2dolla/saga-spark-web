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

const FALLBACK_LOCATION_ID = "starting_location";

const createFallbackLocation = (campaignSeed: CampaignSeed): EnhancedLocation => {
  const title = campaignSeed.title?.trim();
  const name = title ? `The ${title} Outskirts` : "The Outskirts";
  const description = campaignSeed.description?.trim()
    ? `Beyond ${title}, the outskirts stir with new rumors and distant lights.`
    : "The outskirts stir with new rumors and distant lights.";

  return {
    id: FALLBACK_LOCATION_ID,
    name,
    description,
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
    ambientDescription: description,
    shops: [],
    inn: true,
    travelTime: {},
    currentEvents: [],
  };
};

const DEV_DEBUG = import.meta.env.DEV;

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
  const initializedKeyRef = useRef<string | null>(null);
  const initializingRef = useRef(false); // Prevents concurrent initializations
  const didAutosaveAfterInitRef = useRef(false);

  const getErrorMessage = useCallback((error: unknown) => {
    if (!error) return "";
    if (typeof error === "string") return error;
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && "message" in error) {
      return String((error as { message?: string }).message ?? "");
    }
    return "";
  }, []);

  const stringifyError = useCallback((error: unknown) => {
    try {
      return JSON.stringify(error);
    } catch (stringifyError) {
      return String(error ?? stringifyError);
    }
  }, []);

  const logSupabaseError = useCallback((label: string, error: unknown) => {
    const message = getErrorMessage(error);
    const status =
      typeof (error as { status?: number })?.status === "number"
        ? (error as { status?: number }).status
        : undefined;
    console.error(`${label} failed`, {
      campaignId,
      userId,
      error,
      status,
      message,
    });
    return {
      message,
      status,
      toastMessage: message || stringifyError(error),
    };
  }, [campaignId, userId, getErrorMessage, stringifyError]);

  const ensureWorldInvariants = useCallback((
    unified: UnifiedState,
    travel: TravelState | null
  ): { unified: UnifiedState; travel: TravelState } => {
    let nextWorld = unified.world;
    const locations = new Map(nextWorld.locations);
    let locationIds = Array.from(locations.keys());
    const firstLocationId = locationIds[0];
    const fallbackLocation = createFallbackLocation(unified.world.campaignSeed);
    let nextTravel = travel ?? createTravelState(firstLocationId ?? fallbackLocation.id);
    const shouldInjectFallbackLocation =
      locations.size === 0 &&
      nextWorld.npcs.size === 0 &&
      nextWorld.quests.size === 0 &&
      nextWorld.items.size === 0;
    let injectedFallbackLocation = false;

    if (shouldInjectFallbackLocation) {
      locations.set(fallbackLocation.id, fallbackLocation);
      injectedFallbackLocation = true;
    }

    const hasOnlyDefaultLocation =
      locations.size === 1 && locations.has(fallbackLocation.id);
    const realLocationsExist = locations.size > 0 && !hasOnlyDefaultLocation;
    if (realLocationsExist && locations.has(fallbackLocation.id)) {
      locations.delete(fallbackLocation.id);
    }
    locationIds = Array.from(locations.keys());
    let currentLocationId = nextTravel.currentLocationId;
    const preferredRealLocationId =
      locationIds.find(id => id !== fallbackLocation.id) ?? locationIds[0];

    if (realLocationsExist) {
      if (!locations.has(currentLocationId) || currentLocationId === fallbackLocation.id) {
        if (preferredRealLocationId) {
          currentLocationId = preferredRealLocationId;
        }
      }
    } else if (!locations.has(currentLocationId)) {
      const fallbackId = locations.has(fallbackLocation.id)
        ? fallbackLocation.id
        : locationIds[0];
      if (fallbackId) {
        currentLocationId = fallbackId;
      }
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

    const currentLocation = currentLocationId ? locations.get(currentLocationId) : undefined;

    if (locations !== nextWorld.locations) {
      nextWorld = {
        ...nextWorld,
        locations,
      };
    }

    if (DEV_DEBUG) {
      console.info("DEV_DEBUG gameSession invariants", {
        locationsSize: locations.size,
        currentLocationId,
        currentLocationName: currentLocation?.name ?? null,
        connectedToCount: currentLocation?.connectedTo?.length ?? 0,
        fallbackStartingLocationInjected: injectedFallbackLocation,
      });
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
  const initializeSession = useCallback(async (initKey: string) => {
    if (!campaignId || !userId) {
      setSessionState(prev => ({
        ...prev,
        isInitialized: false,
        isLoading: false,
        error: "Missing campaign or user information.",
      }));
      initializingRef.current = false;
      return;
    }
    if (initializingRef.current) return; // Prevent concurrent init
    initializingRef.current = true;
    
    setSessionState(prev => ({ ...prev, isLoading: true, error: null }));
    
    try {
      // Fetch campaign info
      const { data: campaign, error: campaignError } = await supabase
        .from("campaigns")
        .select("name, description")
        .eq("id", campaignId)
        .single();
      
      if (campaignError || !campaign) {
        const error = campaignError ?? new Error("Campaign not found");
        const { message, status, toastMessage } = logSupabaseError("Campaign fetch", error);
        const isNotFound =
          status === 404 ||
          status === 406 ||
          message.toLowerCase().includes("row not found");
        const displayMessage = isNotFound ? "Campaign not found or access denied" : toastMessage;
        toast.error(displayMessage);
        throw new Error(displayMessage);
      }
      
      // Fetch saves directly to ensure we have latest data
      const { data: savesData, error: savesError } = await supabase
        .from("game_saves")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(10);

      let existingSaves = savesData ?? [];
      if (savesError) {
        const { toastMessage } = logSupabaseError("Game saves fetch", savesError);
        toast.error(toastMessage);
        existingSaves = [];
      }
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
          const savedLocationId = worldWithTravel.travelState?.currentLocationId;
          const firstLocationId = Array.from(worldWithTravel.locations.keys())[0];
          const fallbackLocationId = savedLocationId ?? firstLocationId ?? FALLBACK_LOCATION_ID;
          travelState = worldWithTravel.travelState ?? createTravelState(fallbackLocationId);
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

        const locationIds = Array.from(unifiedState.world.locations.keys());
        const startingId =
          locationIds.find(id => id !== FALLBACK_LOCATION_ID)
          ?? locationIds[0]
          ?? FALLBACK_LOCATION_ID;

        // Initialize travel state with starting location
        travelState = createTravelState(startingId);
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
      
      initializedKeyRef.current = initKey;
      initializingRef.current = false;
      if (DEV_DEBUG && unifiedState && travelState) {
        const currentLocation = unifiedState.world.locations.get(travelState.currentLocationId);
        console.info("DEV_DEBUG gameSession initialized", {
          locationsSize: unifiedState.world.locations.size,
          currentLocationId: travelState.currentLocationId,
          currentLocationName: currentLocation?.name ?? null,
          connectedToCount: currentLocation?.connectedTo?.length ?? 0,
          npcsCount: unifiedState.world.npcs.size,
          questsCount: unifiedState.world.quests.size,
          itemsCount: unifiedState.world.items.size,
          locationIds: Array.from(unifiedState.world.locations.keys()),
        });
      }
      
    } catch (error) {
      const { toastMessage } = logSupabaseError("Game session initialization", error);
      toast.error(toastMessage);
      initializingRef.current = false;
      initializedKeyRef.current = null;
      setSessionState(prev => ({
        ...prev,
        isInitialized: false,
        isLoading: false,
        error: toastMessage,
      }));
    }
  }, [
    campaignId,
    userId,
    worldContent,
    mergeIntoWorldState,
    persistence,
    ensureWorldInvariants,
    logSupabaseError,
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

  const setUnifiedState = useCallback((next: UnifiedState) => {
    setSessionState(prev => ({
      ...prev,
      unifiedState: next,
    }));
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

  const autosaveNow = useCallback(async (
    unifiedOverride?: UnifiedState,
    travelOverride?: TravelState
  ) => {
    const unifiedState = unifiedOverride ?? sessionState.unifiedState;
    const travelState = travelOverride ?? sessionState.travelState;
    if (!unifiedState || !travelState || !userId) return;

    try {
      if (lastSaveIdRef.current) {
        await persistence.updateSave(
          lastSaveIdRef.current,
          unifiedState,
          playtimeRef.current,
          travelState
        );
      } else {
        const saveId = await persistence.saveGame(
          unifiedState,
          travelState,
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
      const firstLocationId = Array.from(worldWithTravel.locations.keys())[0];
      const fallbackLocationId =
        worldWithTravel.travelState?.currentLocationId ?? firstLocationId ?? FALLBACK_LOCATION_ID;
      const travelState = worldWithTravel.travelState ?? createTravelState(fallbackLocationId);
      const mergedWorld = worldContent
        ? mergeIntoWorldState(loaded.world, worldContent)
        : loaded.world;
      const invariantResult = ensureWorldInvariants(
        { ...loaded, world: mergedWorld },
        travelState
      );
      
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
  }, [persistence, ensureWorldInvariants, worldContent, mergeIntoWorldState]);

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
    if (!campaignId || !userId) {
      setSessionState(prev => ({
        ...prev,
        isInitialized: false,
        isLoading: false,
        error: "Missing campaign or user information.",
      }));
      initializedKeyRef.current = null;
      initializingRef.current = false;
      return;
    }

    if (!hasLoadedContent) return;
    if (initializingRef.current) return;

    const initKey = `${userId}:${campaignId}`;
    if (initializedKeyRef.current === initKey) return;

    initializeSession(initKey);
  }, [userId, campaignId, hasLoadedContent, initializeSession]);

  // Trigger autosave after successful initialization
  useEffect(() => {
    if (!sessionState.isInitialized) {
      didAutosaveAfterInitRef.current = false;
      return;
    }
    if (sessionState.isInitialized && sessionState.unifiedState && sessionState.travelState) {
      if (didAutosaveAfterInitRef.current) return;
      didAutosaveAfterInitRef.current = true;
      // Debounced autosave after init
      const timeout = setTimeout(() => {
        autosave();
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [sessionState.isInitialized, sessionState.unifiedState, sessionState.travelState, autosave]);

  // Merge new world content into state
  useEffect(() => {
    if (!sessionState.unifiedState || !worldContent) return;
    if (lastMergedContentRef.current === worldContent) return;
    lastMergedContentRef.current = worldContent;
    setSessionState(prev => {
      if (!prev.unifiedState) return prev;
      const mergedWorld = mergeIntoWorldState(prev.unifiedState.world, worldContent);
      const invariantResult = ensureWorldInvariants(
        { ...prev.unifiedState, world: mergedWorld },
        prev.travelState
      );
      return {
        ...prev,
        unifiedState: invariantResult.unified,
        travelState: invariantResult.travel,
      };
    });
  }, [worldContent, mergeIntoWorldState, sessionState.unifiedState, ensureWorldInvariants]);

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
    setUnifiedState,
    updateTravelState,
    saveGame,
    loadSave,
    triggerAutosave,
    autosaveNow,
    fetchSaves: persistence.fetchSaves,
    deleteSave: persistence.deleteSave,
  };
}
