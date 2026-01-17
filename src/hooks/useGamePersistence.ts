/**
 * Hook for saving and loading game state from the database.
 * Includes full travel state persistence.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { 
  serializeUnifiedState, 
  deserializeUnifiedState,
  type UnifiedState 
} from "@/engine/UnifiedState";
import * as TravelPersistence from "@/engine/narrative/TravelPersistence";
import { type TravelState, createTravelState } from "@/engine/narrative/Travel";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";
import type { GameState, Entity } from "@/engine/types";

const DEV_DEBUG = import.meta.env.DEV;

export interface GameSave {
  id: string;
  campaign_id: string;
  save_name: string;
  player_level: number;
  total_xp: number;
  playtime_seconds: number;
  current_location_id?: string;
  created_at: string;
  updated_at: string;
}

export interface ExtendedUnifiedState extends UnifiedState {
  travelState?: TravelState;
}

export interface UseGamePersistenceOptions {
  campaignId: string;
  userId: string;
}

export function useGamePersistence({ campaignId, userId }: UseGamePersistenceOptions) {
  const [saves, setSaves] = useState<GameSave[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const logPersistenceSnapshot = useCallback((
    label: string,
    state: UnifiedState,
    travelState?: TravelState
  ) => {
    if (!DEV_DEBUG) return;
    const locations = Array.from(state.world.locations.values());
    console.info(label, {
      locationsSize: state.world.locations.size,
      locationIds: locations.slice(0, 5).map(location => location.id),
      currentLocationId: travelState?.currentLocationId ?? null,
    });
  }, []);

  const getFallbackTravelState = useCallback((state: UnifiedState) => {
    const firstLocationId = Array.from(state.world.locations.keys())[0];
    return createTravelState(firstLocationId ?? "starting_location");
  }, []);

  // Fetch all saves for this campaign
  const fetchSaves = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from("game_saves")
        .select("id, campaign_id, save_name, player_level, total_xp, playtime_seconds, created_at, updated_at")
        .eq("campaign_id", campaignId)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      setSaves(data || []);
    } catch (error) {
      console.error("Failed to fetch saves:", error);
      toast.error("Failed to load saves");
    } finally {
      setIsLoading(false);
    }
  }, [campaignId, userId]);

  // Save current game state with travel state
  const saveGame = useCallback(async (
    state: UnifiedState,
    travelState: TravelState | undefined,
    saveName: string = "Quicksave",
    playtimeSeconds: number = 0
  ): Promise<string | null> => {
    setIsSaving(true);
    try {
      if (DEV_DEBUG) {
        console.info("DEV_DEBUG persistence backend", {
          backend: "supabase",
          usesLocalStorage: false,
        });
      }
      // Serialize the state
      logPersistenceSnapshot("DEV_DEBUG persistence save start", state, travelState);
      const serialized = serializeUnifiedState(state);
      const parsedSerialized = JSON.parse(serialized);
      
      // Create world state with travel data included
      const worldWithTravel: TravelPersistence.TravelWorldState = {
        ...state.world,
        travelState: travelState ?? getFallbackTravelState(state),
      };
      const worldSerialized = TravelPersistence.serializeTravelWorldState(worldWithTravel);
      
      // Get player progression for quick access fields
      const playerProgression = Array.from(state.world.playerProgression.values())[0];
      const playerLevel = playerProgression?.level ?? 1;
      const totalXp = playerProgression?.totalXpEarned ?? 0;

      // Cast to Json type for Supabase
      const campaignSeedJson = JSON.parse(JSON.stringify(state.world.campaignSeed)) as Json;
      const worldStateJson = JSON.parse(worldSerialized) as Json;
      const gameStateJson = parsedSerialized.game as Json;

      const { data, error } = await supabase
        .from("game_saves")
        .upsert({
          campaign_id: campaignId,
          user_id: userId,
          save_name: saveName,
          campaign_seed: campaignSeedJson,
          world_state: worldStateJson,
          game_state: gameStateJson,
          player_level: playerLevel,
          total_xp: totalXp,
          playtime_seconds: playtimeSeconds,
        }, {
          onConflict: "campaign_id,user_id,save_name",
        })
        .select("id")
        .single();

      if (error) throw error;
      logPersistenceSnapshot("DEV_DEBUG persistence save success", state, travelState);
      
      toast.success(`Game saved: ${saveName}`);
      await fetchSaves();
      return data.id;
    } catch (error) {
      console.error("Failed to save game:", error);
      toast.error("Failed to save game");
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [campaignId, userId, fetchSaves, getFallbackTravelState, logPersistenceSnapshot]);
  // Update an existing save - includes travel state
  const updateSave = useCallback(async (
    saveId: string,
    state: UnifiedState,
    playtimeSeconds: number = 0,
    travelState?: TravelState
  ): Promise<boolean> => {
    setIsSaving(true);
    try {
      if (DEV_DEBUG) {
        console.info("DEV_DEBUG persistence backend", {
          backend: "supabase",
          usesLocalStorage: false,
        });
      }
      logPersistenceSnapshot("DEV_DEBUG persistence update start", state, travelState);
      const serialized = serializeUnifiedState(state);
      const parsedSerialized = JSON.parse(serialized);
      
      // Create world state with travel data included (same as saveGame)
      const worldWithTravel: TravelPersistence.TravelWorldState = {
        ...state.world,
        travelState: travelState ?? getFallbackTravelState(state),
      };
      const worldSerialized = TravelPersistence.serializeTravelWorldState(worldWithTravel);
      
      const playerProgression = Array.from(state.world.playerProgression.values())[0];
      const playerLevel = playerProgression?.level ?? 1;
      const totalXp = playerProgression?.totalXpEarned ?? 0;

      // Cast to Json type for Supabase
      const campaignSeedJson = JSON.parse(JSON.stringify(state.world.campaignSeed)) as Json;
      const worldStateJson = JSON.parse(worldSerialized) as Json;
      const gameStateJson = parsedSerialized.game as Json;

      const { error } = await supabase
        .from("game_saves")
        .update({
          campaign_seed: campaignSeedJson,
          world_state: worldStateJson,
          game_state: gameStateJson,
          player_level: playerLevel,
          total_xp: totalXp,
          playtime_seconds: playtimeSeconds,
        })
        .eq("id", saveId)
        .eq("user_id", userId);

      if (error) throw error;
      logPersistenceSnapshot("DEV_DEBUG persistence update success", state, travelState);
      return true;
    } catch (error) {
      console.error("Failed to update save:", error);
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [userId, getFallbackTravelState, logPersistenceSnapshot]);

  // Load a saved game
  const loadGame = useCallback(async (saveId: string): Promise<UnifiedState | null> => {
    setIsLoading(true);
    try {
      if (DEV_DEBUG) {
        console.info("DEV_DEBUG persistence backend", {
          backend: "supabase",
          usesLocalStorage: false,
        });
      }
      const { data, error } = await supabase
        .from("game_saves")
        .select("*")
        .eq("id", saveId)
        .eq("user_id", userId)
        .single();

      if (error) throw error;
      if (!data) throw new Error("Save not found");

      // Cast the JSON data to proper types
      const gameStateData = data.game_state as Record<string, unknown>;
      const entitiesArray = (gameStateData.entities ?? []) as Array<[string, Entity]>;
      
      // Reconstruct the unified state
      const gameState: GameState = {
        tick: (gameStateData.tick as number) ?? 0,
        entities: new Map<string, Entity>(entitiesArray),
        board: gameStateData.board as GameState["board"],
        turnOrder: (gameStateData.turnOrder as GameState["turnOrder"]) ?? { order: [], currentIndex: 0, roundNumber: 1 },
        isInCombat: (gameStateData.isInCombat as boolean) ?? false,
        pendingEvents: [],
      };

      const worldState = TravelPersistence.deserializeTravelWorldState(
        JSON.stringify(data.world_state)
      );

      const unifiedState: UnifiedState = {
        game: gameState,
        world: worldState,
        pendingWorldEvents: [],
      };
      logPersistenceSnapshot("DEV_DEBUG persistence load", unifiedState, worldState.travelState);

      toast.success("Game loaded!");
      return unifiedState;
    } catch (error) {
      console.error("Failed to load game:", error);
      toast.error("Failed to load game");
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [userId, logPersistenceSnapshot]);

  // Delete a save
  const deleteSave = useCallback(async (saveId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("game_saves")
        .delete()
        .eq("id", saveId)
        .eq("user_id", userId);

      if (error) throw error;
      
      toast.success("Save deleted");
      await fetchSaves();
      return true;
    } catch (error) {
      console.error("Failed to delete save:", error);
      toast.error("Failed to delete save");
      return false;
    }
  }, [userId, fetchSaves]);

  // Get or create autosave
  const getOrCreateAutosave = useCallback(async (): Promise<string | null> => {
    try {
      const { data: existing } = await supabase
        .from("game_saves")
        .select("id")
        .eq("campaign_id", campaignId)
        .eq("user_id", userId)
        .eq("save_name", "Autosave")
        .maybeSingle();

      if (existing) return existing.id;
      return null;
    } catch (error) {
      console.error("Failed to get autosave:", error);
      return null;
    }
  }, [campaignId, userId]);

  return {
    saves,
    isLoading,
    isSaving,
    fetchSaves,
    saveGame,
    updateSave,
    loadGame,
    deleteSave,
    getOrCreateAutosave,
  };
}
