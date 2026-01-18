/**
 * Unified game session hook that manages the complete game lifecycle:
 * - Loading AI-generated content
 * - Initializing engine state
 * - Persistence with autosave
 * - Per-player travel authority
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunction } from "@/lib/edge";
import { useAuth } from "@/hooks/useAuth";
import { useWorldContent } from "@/hooks/useWorldContent";
import { useWorldGenerator, type GeneratedWorld } from "@/hooks/useWorldGenerator";
import { useGamePersistence } from "@/hooks/useGamePersistence";
import { createUnifiedState, serializeUnifiedState, type UnifiedState } from "@/engine/UnifiedState";
import * as World from "@/engine/narrative/World";
import { createTravelState, type TravelState, type EnhancedLocation } from "@/engine/narrative/Travel";
import { type TravelWorldState } from "@/engine/narrative/TravelPersistence";
import type { CampaignSeed } from "@/engine/narrative/types";
import { toast } from "sonner";
import { recordCampaignsRead, recordSavesRead } from "@/ui/data/networkHealth";

const DEV_DEBUG = import.meta.env.DEV;

export interface GameSessionState {
  unifiedState: UnifiedState | null;
  travelState: TravelState | null;
  campaignSeed: CampaignSeed | null;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  bootstrapStatus: "idle" | "loading_from_db" | "needs_bootstrap" | "bootstrapping" | "ready" | "error";
  lastWorldGenError: unknown | null;
  lastWorldGenErrorAt: number | null;
  lastWorldGenSuccessAt: number | null;
  playtimeSeconds: number;
  loadedFromSupabase: boolean;
  lastSavedAt: number | null;
  lastLoadedAt: number | null;
}

interface UseGameSessionOptions {
  campaignId: string;
}

export function useGameSession({ campaignId }: UseGameSessionOptions) {
  const { user } = useAuth();
  const userId = user?.id ?? "";
  
  const { content: worldContent, hasLoadedContent, mergeIntoWorldState, fetchContent } = useWorldContent({ campaignId });
  const { generateInitialWorld, lastEdgeError } = useWorldGenerator();
  const persistence = useGamePersistence({ campaignId, userId });
  
  const [sessionState, setSessionState] = useState<GameSessionState>({
    unifiedState: null,
    travelState: null,
    campaignSeed: null,
    isInitialized: false,
    isLoading: true,
    error: null,
    bootstrapStatus: "idle",
    lastWorldGenError: null,
    lastWorldGenErrorAt: null,
    lastWorldGenSuccessAt: null,
    playtimeSeconds: 0,
    loadedFromSupabase: false,
    lastSavedAt: null,
    lastLoadedAt: null,
  });
  
  const playtimeRef = useRef(0);
  const playtimeIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autosaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveIdRef = useRef<string | null>(null);
  const lastMergedContentRef = useRef<typeof worldContent>(null);
  const initializedKeyRef = useRef<string | null>(null);
  const initializingRef = useRef(false); // Prevents concurrent initializations
  const bootstrapInFlightRef = useRef(false);
  const bootstrapKeyRef = useRef<string | null>(null);
  const bootstrapSeedRef = useRef<CampaignSeed | null>(null);
  const didAutosaveAfterInitRef = useRef(false);
  const lastSavedFingerprintRef = useRef<string | null>(null);
  const queuedFingerprintRef = useRef<string | null>(null);
  const latestStateRef = useRef<{ unified: UnifiedState | null; travel: TravelState | null }>({
    unified: null,
    travel: null,
  });

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

  const logWorldSnapshot = useCallback((
    label: string,
    world: UnifiedState["world"],
    travel: TravelState | null
  ) => {
    if (!DEV_DEBUG) return;
    const locations = Array.from(world.locations.values()) as EnhancedLocation[];
    const currentLocationId = travel?.currentLocationId ?? null;
    const currentLocation = currentLocationId ? world.locations.get(currentLocationId) : undefined;
    console.info(label, {
      locationsSize: world.locations.size,
      locationIds: locations.slice(0, 10).map(location => location.id),
      locationPositions: locations.slice(0, 3).map(location => ({
        id: location.id,
        x: location.position.x,
        y: location.position.y,
      })),
      currentLocationId,
      currentLocationName: currentLocation?.name ?? null,
    });
  }, []);

  const hashString = useCallback((value: string) => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }, []);

  const buildTravelSnapshot = useCallback((travel: TravelState) => ({
    currentLocationId: travel.currentLocationId,
    previousLocationId: travel.previousLocationId,
    isInTransit: travel.isInTransit,
    transitProgress: travel.transitProgress,
    transitDestinationId: travel.transitDestinationId,
    travelHistory: travel.travelHistory,
    discoveredLocations: Array.from(travel.discoveredLocations).sort(),
  }), []);

  const computeFingerprint = useCallback((unified: UnifiedState, travel: TravelState) => {
    const unifiedSerialized = serializeUnifiedState(unified);
    const travelSerialized = JSON.stringify(buildTravelSnapshot(travel));
    return hashString(`${unifiedSerialized}|${travelSerialized}`);
  }, [buildTravelSnapshot, hashString]);

  const ensureWorldInvariants = useCallback((
    unified: UnifiedState,
    travel: TravelState | null,
    worldContentLocationsCount: number
  ): { unified: UnifiedState; travel: TravelState | null } => {
    let nextWorld = unified.world;
    const locations = new Map(nextWorld.locations);
    let locationIds = Array.from(locations.keys());
    const firstLocationId = locationIds[0];
    let nextTravel = travel ?? (firstLocationId ? createTravelState(firstLocationId) : null);
    const realLocationsExist = locations.size > 0;
    if (!firstLocationId || !nextTravel) {
      if (DEV_DEBUG) {
        console.warn("DEV_DEBUG gameSession invariants missing locations", {
          locationsSize: locations.size,
          worldContentLocationsCount,
        });
      }
      return { unified, travel: nextTravel };
    }
    let currentLocationId = nextTravel.currentLocationId;
    const preferredRealLocationId = locationIds[0];

    if (realLocationsExist) {
      if (!locations.has(currentLocationId)) {
        if (preferredRealLocationId) {
          currentLocationId = preferredRealLocationId;
        }
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
        locationIds: locationIds.slice(0, 10),
        locationPositions: Array.from(locations.values()).slice(0, 3).map(location => ({
          id: location.id,
          x: location.position.x,
          y: location.position.y,
        })),
        currentLocationId,
        currentLocationName: currentLocation?.name ?? null,
        connectedToCount: currentLocation?.connectedTo?.length ?? 0,
        fallbackStartingLocationInjected: false,
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

  const toKebab = useCallback((value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""), []);

  const createDeterministicPosition = useCallback((seed: string): { x: number; y: number } => {
    const hashed = Number.parseInt(hashString(seed), 16) || 0;
    return {
      x: 50 + (hashed % 400),
      y: 50 + ((hashed >>> 16) % 400),
    };
  }, [hashString]);

  const normalizeLocations = useCallback((locations: GeneratedWorld["locations"]) => {
    const seenIds = new Set<string>();
    return locations.map((location, index) => {
      const baseName = location.name?.trim() || `location-${index + 1}`;
      let id = location.id?.trim() || toKebab(baseName);
      if (!id || id === "starting_location") {
        id = `location-${index + 1}`;
      }
      let uniqueId = id;
      let suffix = 1;
      while (seenIds.has(uniqueId)) {
        uniqueId = `${id}-${suffix}`;
        suffix += 1;
      }
      seenIds.add(uniqueId);
      const position = location.position?.x !== undefined && location.position?.y !== undefined
        ? { x: location.position.x, y: location.position.y }
        : createDeterministicPosition(uniqueId);
      return {
        ...location,
        id: uniqueId,
        position,
      };
    });
  }, [createDeterministicPosition, toKebab]);

  const buildLocationFromSeed = useCallback((
    seed: CampaignSeed,
    index: number,
    preferredId?: string
  ): EnhancedLocation => {
    const adjectives = ["Amber", "Broken", "Crimson", "Elder", "Frosted", "Golden", "Hidden", "Iron", "Mist", "Silent"];
    const nouns = ["Vale", "Crossing", "Harbor", "Outpost", "Hollow", "Grove", "Keep", "March", "Ridge", "Reach"];
    const hashBase = `${seed.id}:${seed.title}:${index}`;
    const hash = Number.parseInt(hashString(hashBase), 16) || 0;
    const adjective = adjectives[hash % adjectives.length];
    const noun = nouns[(hash >>> 8) % nouns.length];
    const name = `${adjective} ${noun}`;
    const id = preferredId ?? `location-${index + 1}`;
    return {
      id,
      name,
      description: seed.description || `A region tied to ${seed.title}.`,
      type: (["town", "ruins", "forest", "cave", "fort", "port"][(hash >>> 4) % 6] ?? "town"),
      dangerLevel: 1 + (hash % 6),
      position: createDeterministicPosition(`${seed.id}:${id}`),
      connectedTo: [],
    };
  }, [createDeterministicPosition, hashString]);

  const ensureMinimumWorldGraph = useCallback((
    seed: CampaignSeed,
    locations: EnhancedLocation[],
    minimumCount: number
  ) => {
    const existingIds = new Set<string>();
    const normalized = locations.map(loc => {
      existingIds.add(loc.id);
      return {
        ...loc,
        connectedTo: Array.from(new Set(loc.connectedTo ?? [])),
      };
    });

    const ensureUniqueId = (baseId: string) => {
      let candidate = baseId;
      let suffix = 1;
      while (existingIds.has(candidate)) {
        candidate = `${baseId}-${suffix}`;
        suffix += 1;
      }
      existingIds.add(candidate);
      return candidate;
    };

    if (!existingIds.has("starting_location")) {
      const start = buildLocationFromSeed(seed, 0, "starting_location");
      normalized.unshift(start);
      existingIds.add(start.id);
    }

    let index = normalized.length;
    while (normalized.length < minimumCount) {
      const newId = ensureUniqueId(`location-${index + 1}`);
      normalized.push(buildLocationFromSeed(seed, index, newId));
      index += 1;
    }

    const connectionMap = new Map<string, Set<string>>();
    for (const location of normalized) {
      connectionMap.set(location.id, new Set(location.connectedTo ?? []));
    }

    const addEdge = (from: string, to: string) => {
      if (from === to) return;
      connectionMap.get(from)?.add(to);
      connectionMap.get(to)?.add(from);
    };

    const allIds = normalized.map(loc => loc.id);
    const startId = "starting_location";
    const otherIds = allIds.filter(id => id !== startId);
    const townId = normalized.find(loc =>
      loc.id.toLowerCase() === "town" || loc.name?.toLowerCase() === "town"
    )?.id;
    if (otherIds.length >= 2) {
      addEdge(startId, otherIds[0]);
      addEdge(startId, otherIds[1]);
    }
    if (townId) {
      addEdge(startId, townId);
    }

    for (let i = 0; i < allIds.length - 1; i += 1) {
      addEdge(allIds[i], allIds[i + 1]);
    }

    const edgeKeys = new Set<string>();
    connectionMap.forEach((targets, from) => {
      targets.forEach((to) => {
        edgeKeys.add([from, to].sort().join(":"));
      });
    });
    if (edgeKeys.size < 4 && allIds.length > 2) {
      addEdge(allIds[0], allIds[2]);
      addEdge(allIds[1], allIds[3] ?? allIds[0]);
    }

    return normalized.map(loc => ({
      ...loc,
      connectedTo: Array.from(connectionMap.get(loc.id) ?? []),
    }));
  }, [buildLocationFromSeed]);

  const expandWorldGraph = useCallback((
    seed: CampaignSeed,
    locations: EnhancedLocation[],
    addCount: number
  ) => {
    if (addCount <= 0) return locations;
    const existingIds = new Set(locations.map(loc => loc.id));
    const expanded = [...locations];
    let index = locations.length;
    const ensureUniqueId = (baseId: string) => {
      let candidate = baseId;
      let suffix = 1;
      while (existingIds.has(candidate)) {
        candidate = `${baseId}-${suffix}`;
        suffix += 1;
      }
      existingIds.add(candidate);
      return candidate;
    };
    for (let i = 0; i < addCount; i += 1) {
      const newId = ensureUniqueId(`location-${index + 1}`);
      expanded.push(buildLocationFromSeed(seed, index, newId));
      index += 1;
    }
    return ensureMinimumWorldGraph(seed, expanded, expanded.length);
  }, [buildLocationFromSeed, ensureMinimumWorldGraph]);

  const bootstrapWorld = useCallback(async (
    campaignSeed: CampaignSeed,
    reason: string,
    force: boolean = false
  ): Promise<{ unified: UnifiedState; travel: TravelState } | null> => {
    if (bootstrapInFlightRef.current) return null;
    const bootstrapKey = `${userId}:${campaignId}`;
    if (!force && bootstrapKeyRef.current === bootstrapKey) {
      return null;
    }
    bootstrapKeyRef.current = bootstrapKey;
    bootstrapInFlightRef.current = true;
    setSessionState(prev => ({ ...prev, bootstrapStatus: "bootstrapping" }));
    if (DEV_DEBUG) {
      console.info("DEV_DEBUG world bootstrap start", { campaignId, userId, reason });
    }

    try {
      let generated = await generateInitialWorld(
        {
          title: campaignSeed.title,
          description: campaignSeed.description,
          themes: campaignSeed.themes ?? [],
        },
        { campaignId }
      );

      if (!generated || !Array.isArray(generated.locations) || generated.locations.length === 0) {
        generated = await generateInitialWorld(
          {
            title: `${campaignSeed.title} (retry)`,
            description: campaignSeed.description,
            themes: campaignSeed.themes ?? [],
          },
          { campaignId }
        );
      }

      let normalizedLocations = generated?.locations?.length
        ? normalizeLocations(generated.locations)
        : [];

      if (normalizedLocations.length === 0) {
        normalizedLocations = [];
      }

      normalizedLocations = ensureMinimumWorldGraph(
        campaignSeed,
        normalizedLocations as EnhancedLocation[],
        5
      );

      const resolvedStartingId =
        normalizedLocations.find(loc => loc.id === generated?.startingLocationId)?.id
        ?? normalizedLocations.find(loc => loc.id === "starting_location")?.id
        ?? normalizedLocations[0]?.id
        ?? null;

      if (!resolvedStartingId) {
        throw new Error("Bootstrap produced no starting location");
      }

      const contentToStore = [
        ...(generated?.factions ?? []).map(f => ({
          campaign_id: campaignId,
          content_type: "faction",
          content_id: f.id,
          content: JSON.parse(JSON.stringify(f)),
          generation_context: JSON.parse(JSON.stringify(campaignSeed)),
        })),
        ...(generated?.npcs ?? []).map((npc, i) => ({
          campaign_id: campaignId,
          content_type: "npc",
          content_id: `npc_initial_${i}`,
          content: JSON.parse(JSON.stringify(npc)),
          generation_context: JSON.parse(JSON.stringify(campaignSeed)),
        })),
        ...(generated?.initialQuest
          ? [{
            campaign_id: campaignId,
            content_type: "quest",
            content_id: "initial_quest",
            content: JSON.parse(JSON.stringify(generated.initialQuest)),
            generation_context: JSON.parse(JSON.stringify(campaignSeed)),
          }]
          : []),
        ...normalizedLocations.map((location) => ({
          campaign_id: campaignId,
          content_type: "location",
          content_id: location.id,
          content: JSON.parse(JSON.stringify(location)),
          generation_context: JSON.parse(JSON.stringify(campaignSeed)),
        })),
        ...((generated?.worldHooks ?? []).map((hook, index) => ({
          campaign_id: campaignId,
          content_type: "world_hooks",
          content_id: `world_hook_${index}`,
          content: JSON.parse(JSON.stringify([hook])),
          generation_context: JSON.parse(JSON.stringify(campaignSeed)),
        }))),
      ];

      const writeResult = await callEdgeFunction<{ error?: string }>(
        "world-content-writer",
        { body: { campaignId, content: contentToStore }, requireAuth: true }
      );
      if (writeResult.error) {
        throw writeResult.error;
      }
      if (writeResult.data?.error) {
        throw new Error(writeResult.data.error);
      }

      await fetchContent();

      let unifiedState = createUnifiedState(campaignSeed, [], 10, 12);
      if (worldContent) {
        unifiedState = {
          ...unifiedState,
          world: mergeIntoWorldState(unifiedState.world, worldContent),
        };
      }
      unifiedState = {
        ...unifiedState,
        world: mergeIntoWorldState(unifiedState.world, {
          factions: generated?.factions ?? [],
          npcs: [],
          quests: [],
          locations: normalizedLocations as unknown as EnhancedLocation[],
          worldHooks: generated?.worldHooks ?? [],
        }),
      };

      const travelState = createTravelState(resolvedStartingId);

      await persistence.saveGame(
        unifiedState,
        travelState,
        "Autosave",
        playtimeRef.current,
        { refreshList: false, silent: true }
      );

      if (DEV_DEBUG) {
        console.info("DEV_DEBUG world bootstrap success", {
          locationsCount: unifiedState.world.locations.size,
          currentLocationId: travelState.currentLocationId,
        });
      }

      setSessionState(prev => ({
        ...prev,
        unifiedState,
        travelState,
        campaignSeed,
        isInitialized: true,
        isLoading: false,
        error: null,
        bootstrapStatus: "ready",
        lastWorldGenError: null,
        lastWorldGenErrorAt: null,
        lastWorldGenSuccessAt: Date.now(),
        lastSavedAt: Date.now(),
      }));

      return { unified: unifiedState, travel: travelState };
    } catch (error) {
      const message = getErrorMessage(error) || "Failed to bootstrap world";
      setSessionState(prev => ({
        ...prev,
        error: message,
        isLoading: false,
        isInitialized: false,
        bootstrapStatus: "error",
        lastWorldGenError: lastEdgeError ?? error ?? null,
        lastWorldGenErrorAt: Date.now(),
      }));
      toast.error(message);
      return null;
    } finally {
      bootstrapInFlightRef.current = false;
      if (DEV_DEBUG) {
        console.info("DEV_DEBUG world bootstrap end", { campaignId, userId });
      }
    }
  }, [
    campaignId,
    userId,
    createDeterministicPosition,
    fetchContent,
    generateInitialWorld,
    getErrorMessage,
    lastEdgeError,
    mergeIntoWorldState,
    normalizeLocations,
    persistence,
    toKebab,
    worldContent,
    ensureMinimumWorldGraph,
  ]);

  const retryBootstrap = useCallback(async () => {
    if (!bootstrapSeedRef.current) return false;
    const result = await bootstrapWorld(bootstrapSeedRef.current, "manual_retry", true);
    return Boolean(result);
  }, [bootstrapWorld]);

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
    
    setSessionState(prev => ({ ...prev, isLoading: true, error: null, bootstrapStatus: "loading_from_db" }));
    initializedKeyRef.current = initKey;
    
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
      recordCampaignsRead();
      
      // Fetch saves directly to ensure we have latest data
      const { data: savesData, error: savesError } = await supabase
        .from("game_saves")
        .select("id, world_state, game_state, playtime_seconds, updated_at")
        .eq("campaign_id", campaignId)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false })
        .limit(1);

      let existingSaves = savesData ?? [];
      if (savesError) {
        const { toastMessage } = logSupabaseError("Game saves fetch", savesError);
        toast.error(toastMessage);
        existingSaves = [];
      } else if (existingSaves.length > 0) {
        recordSavesRead();
      }
      const latestSave = existingSaves[0]; // Most recent
      
      let unifiedState: UnifiedState;
      let travelState: TravelState | null = null;
      let initialPlaytime = 0;
      let loadedFromSupabase = false;
      let preMergeLocationsSize = 0;
      let lastLoadedAt: number | null = null;
      
      if (latestSave) {
        loadedFromSupabase = true;
        // Load from save without a second fetch
        const loaded = await persistence.loadGameFromRow(latestSave);
        if (loaded) {
          unifiedState = loaded;
          preMergeLocationsSize = unifiedState.world.locations.size;
          lastLoadedAt = Date.now();
          
          // Extract travel state from world state if available
          const worldWithTravel = loaded.world as unknown as TravelWorldState;
          const savedLocationId = worldWithTravel.travelState?.currentLocationId;
          const firstLocationId = Array.from(worldWithTravel.locations.keys())[0];
          if (!firstLocationId && !savedLocationId) {
            throw new Error("World state has no locations");
          }
          const resolvedLocationId = savedLocationId ?? firstLocationId ?? "";
          travelState = worldWithTravel.travelState ?? createTravelState(resolvedLocationId);
          initialPlaytime = latestSave.playtime_seconds;
          lastSaveIdRef.current = latestSave.id;
          bootstrapSeedRef.current = unifiedState.world.campaignSeed;
          
          // Re-merge world content to pick up any new generated content
          if (worldContent) {
            unifiedState = {
              ...unifiedState,
              world: mergeIntoWorldState(unifiedState.world, worldContent),
            };
            logWorldSnapshot("DEV_DEBUG gameSession post-merge", unifiedState.world, travelState);
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
        bootstrapSeedRef.current = campaignSeed;
        
        // Create base state
        unifiedState = createUnifiedState(campaignSeed, [], 10, 12);
        preMergeLocationsSize = unifiedState.world.locations.size;

        // Merge in generated content if available (this will add locations, NPCs, etc.)
        if (worldContent) {
          unifiedState = {
            ...unifiedState,
            world: mergeIntoWorldState(unifiedState.world, worldContent),
          };
        }

        const locationIds = Array.from(unifiedState.world.locations.keys());
        if (locationIds.length === 0) {
          setSessionState(prev => ({ ...prev, bootstrapStatus: "needs_bootstrap" }));
        } else {
          const startingId = locationIds[0];
          travelState = createTravelState(startingId);
          if (worldContent) {
            logWorldSnapshot("DEV_DEBUG gameSession post-merge", unifiedState.world, travelState);
          }
        }
      }

      const invariantResult = ensureWorldInvariants(
        unifiedState,
        travelState,
        worldContent?.locations.length ?? 0
      );
      if (!invariantResult.travel || invariantResult.unified.world.locations.size === 0) {
        await bootstrapWorld(unifiedState.world.campaignSeed, "empty_world");
        initializingRef.current = false;
        return;
      }
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
      
      const fingerprintToStore = computeFingerprint(unifiedState, travelState);
      if (loadedFromSupabase) {
        lastSavedFingerprintRef.current = fingerprintToStore;
      }
      queuedFingerprintRef.current = null;
      latestStateRef.current = { unified: unifiedState, travel: travelState };

      setSessionState(prev => ({
        ...prev,
        unifiedState,
        travelState,
        campaignSeed: unifiedState.world.campaignSeed,
        isInitialized: true,
        isLoading: false,
        error: null,
        bootstrapStatus: "ready",
        lastWorldGenError: null,
        lastWorldGenErrorAt: null,
        lastWorldGenSuccessAt: Date.now(),
        playtimeSeconds: initialPlaytime,
        loadedFromSupabase,
        lastSavedAt: prev.lastSavedAt,
        lastLoadedAt,
      }));
      
      initializingRef.current = false;
      if (DEV_DEBUG && unifiedState && travelState) {
        const currentLocation = unifiedState.world.locations.get(travelState.currentLocationId);
        console.info("DEV_DEBUG gameSession initialized", {
          source: loadedFromSupabase ? "db" : "fresh",
          loadedFromSupabase,
          preMergeLocationsSize,
          postMergeLocationsSize: unifiedState.world.locations.size,
          locationsSize: unifiedState.world.locations.size,
          currentLocationId: travelState.currentLocationId,
          currentLocationName: currentLocation?.name ?? null,
          connectedToCount: currentLocation?.connectedTo?.length ?? 0,
          npcsCount: unifiedState.world.npcs.size,
          questsCount: unifiedState.world.quests.size,
          itemsCount: unifiedState.world.items.size,
          locationIds: Array.from(unifiedState.world.locations.keys()).slice(0, 10),
          locationPositions: Array.from(unifiedState.world.locations.values()).slice(0, 3).map(location => ({
            id: location.id,
            x: location.position.x,
            y: location.position.y,
          })),
        });
      }
      
    } catch (error) {
      const { toastMessage } = logSupabaseError("Game session initialization", error);
      toast.error(toastMessage);
      initializingRef.current = false;
      initializedKeyRef.current = initKey;
      setSessionState(prev => ({
        ...prev,
        isInitialized: false,
        isLoading: false,
        error: toastMessage,
        bootstrapStatus: "error",
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
    logWorldSnapshot,
    computeFingerprint,
    bootstrapWorld,
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

  const performAutosave = useCallback(async (
    unifiedState: UnifiedState,
    travelState: TravelState,
    fingerprint: string,
    reason: string
  ) => {
    if (!userId) return;
    try {
      const saveId = await persistence.saveGame(
        unifiedState,
        travelState,
        "Autosave",
        playtimeRef.current,
        { refreshList: false, silent: true }
      );
      if (saveId) {
        lastSaveIdRef.current = saveId;
        lastSavedFingerprintRef.current = fingerprint;
        queuedFingerprintRef.current = null;
        setSessionState(prev => ({ ...prev, lastSavedAt: Date.now() }));
        if (DEV_DEBUG) {
          console.info("DEV_DEBUG autosave", {
            reason,
            saveId,
          });
        }
      } else {
        queuedFingerprintRef.current = null;
      }
    } catch (error) {
      queuedFingerprintRef.current = null;
      console.error("Autosave failed:", error);
    }
  }, [persistence, userId]);

  const autosaveImmediate = useCallback(async () => {
    const unifiedState = latestStateRef.current.unified;
    const travelState = latestStateRef.current.travel;
    if (!unifiedState || !travelState || !userId) return;
    const fingerprint = computeFingerprint(unifiedState, travelState);
    if (fingerprint === lastSavedFingerprintRef.current) return;
    await performAutosave(unifiedState, travelState, fingerprint, "immediate");
  }, [computeFingerprint, performAutosave, userId]);

  const autosaveNow = useCallback(async (
    unifiedOverride?: UnifiedState,
    travelOverride?: TravelState
  ) => {
    const unifiedState = unifiedOverride ?? sessionState.unifiedState;
    const travelState = travelOverride ?? sessionState.travelState;
    if (!unifiedState || !travelState || !userId) return;

    try {
      const fingerprint = computeFingerprint(unifiedState, travelState);
      await performAutosave(unifiedState, travelState, fingerprint, "manual");
    } catch (error) {
      console.error("Autosave failed:", error);
    }
  }, [sessionState.unifiedState, sessionState.travelState, userId, computeFingerprint, performAutosave]);

  const expandWorld = useCallback(async (count: number) => {
    if (!sessionState.unifiedState || !sessionState.travelState || !sessionState.campaignSeed) return false;
    const expandedLocations = expandWorldGraph(
      sessionState.campaignSeed,
      Array.from(sessionState.unifiedState.world.locations.values()) as EnhancedLocation[],
      count
    );
    const expandedWorld = mergeIntoWorldState(sessionState.unifiedState.world, {
      factions: [],
      npcs: [],
      quests: [],
      locations: expandedLocations,
      worldHooks: [],
    });
    const nextUnified = {
      ...sessionState.unifiedState,
      world: expandedWorld,
    };
    setSessionState(prev => ({
      ...prev,
      unifiedState: nextUnified,
    }));
    latestStateRef.current = { unified: nextUnified, travel: sessionState.travelState };
    await autosaveNow(nextUnified, sessionState.travelState);
    return true;
  }, [
    autosaveNow,
    expandWorldGraph,
    mergeIntoWorldState,
    sessionState.campaignSeed,
    sessionState.travelState,
    sessionState.unifiedState,
  ]);

  // Trigger autosave with debounce
  const triggerAutosave = useCallback((reason: string = "trigger") => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }
    const unifiedState = latestStateRef.current.unified;
    const travelState = latestStateRef.current.travel;
    if (!unifiedState || !travelState || !userId) return;
    const fingerprint = computeFingerprint(unifiedState, travelState);
    if (fingerprint === lastSavedFingerprintRef.current || fingerprint === queuedFingerprintRef.current) {
      return;
    }
    queuedFingerprintRef.current = fingerprint;
    autosaveTimeoutRef.current = setTimeout(() => {
      const currentUnified = latestStateRef.current.unified;
      const currentTravel = latestStateRef.current.travel;
      if (!currentUnified || !currentTravel) return;
      const currentFingerprint = computeFingerprint(currentUnified, currentTravel);
      if (currentFingerprint === lastSavedFingerprintRef.current) {
        queuedFingerprintRef.current = null;
        return;
      }
      void performAutosave(currentUnified, currentTravel, currentFingerprint, reason);
    }, 1000);
  }, [computeFingerprint, performAutosave, userId]);

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

  // Manual save
  const saveGame = useCallback(async (saveName: string) => {
    if (!sessionState.unifiedState || !sessionState.travelState) {
      toast.error("No game state to save");
      return null;
    }
    
    const saveId = await persistence.saveGame(
      sessionState.unifiedState,
      sessionState.travelState,
      saveName,
      playtimeRef.current,
      { refreshList: true, silent: false }
    );
    if (saveId) {
      setSessionState(prev => ({ ...prev, lastSavedAt: Date.now() }));
    }
    return saveId;
  }, [sessionState.unifiedState, sessionState.travelState, persistence]);

  // Load specific save
  const loadSave = useCallback(async (saveId: string) => {
    const loaded = await persistence.loadGame(saveId);
    if (loaded) {
      const worldWithTravel = loaded.world as unknown as TravelWorldState;
      const firstLocationId = Array.from(worldWithTravel.locations.keys())[0];
      const resolvedLocationId = worldWithTravel.travelState?.currentLocationId ?? firstLocationId ?? null;
      if (!resolvedLocationId) {
        setSessionState(prev => ({
          ...prev,
          isInitialized: false,
          isLoading: false,
          error: "Saved world has no locations.",
        }));
        return false;
      }
      const travelState = worldWithTravel.travelState ?? createTravelState(resolvedLocationId);
      const mergedWorld = worldContent
        ? mergeIntoWorldState(loaded.world, worldContent)
        : loaded.world;
      const invariantResult = ensureWorldInvariants(
        { ...loaded, world: mergedWorld },
        travelState,
        worldContent?.locations.length ?? 0
      );
      if (!invariantResult.travel) {
        setSessionState(prev => ({
          ...prev,
          isInitialized: false,
          isLoading: false,
          error: "Saved world has no active travel location.",
        }));
        return false;
      }
      
      lastSaveIdRef.current = saveId;
      lastSavedFingerprintRef.current = computeFingerprint(invariantResult.unified, invariantResult.travel);
      queuedFingerprintRef.current = null;
      latestStateRef.current = {
        unified: invariantResult.unified,
        travel: invariantResult.travel,
      };
      
      setSessionState(prev => ({
        ...prev,
        unifiedState: invariantResult.unified,
        travelState: invariantResult.travel,
        isInitialized: true,
        lastWorldGenError: null,
        lastWorldGenErrorAt: null,
        lastWorldGenSuccessAt: Date.now(),
        lastLoadedAt: Date.now(),
      }));
      
      return true;
    }
    return false;
  }, [persistence, ensureWorldInvariants, worldContent, mergeIntoWorldState]);

  const reloadLatestFromDb = useCallback(async () => {
    const autosaveId = await persistence.getOrCreateAutosave();
    if (autosaveId) {
      return loadSave(autosaveId);
    }
    await persistence.fetchSaves();
    const latestId = persistence.saves[0]?.id;
    if (latestId) {
      return loadSave(latestId);
    }
    return false;
  }, [persistence, loadSave]);

  // Start playtime tracking
  useEffect(() => {
    if (!sessionState.isInitialized) return;
    
    playtimeIntervalRef.current = setInterval(() => {
      playtimeRef.current += 1;
      if (playtimeRef.current % 10 === 0) {
        setSessionState(prev => ({ ...prev, playtimeSeconds: playtimeRef.current }));
      }
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
      void autosaveImmediate();
    };
    
    window.addEventListener("beforeunload", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [autosaveImmediate]);

  // Initialize on mount
  useEffect(() => {
    if (!campaignId || !userId) {
      setSessionState(prev => ({
        ...prev,
        isInitialized: false,
        isLoading: false,
        error: "Missing campaign or user information.",
        bootstrapStatus: "idle",
      }));
      initializedKeyRef.current = null;
      initializingRef.current = false;
      return;
    }

    if (!hasLoadedContent) return;
    if (initializingRef.current) return;

    const initKey = `${userId}:${campaignId}`;
    if (initializedKeyRef.current === initKey) return;
    if (bootstrapInFlightRef.current) return;

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
      triggerAutosave("post-init");
    }
  }, [sessionState.isInitialized, sessionState.unifiedState, sessionState.travelState, triggerAutosave]);

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
        prev.travelState,
        worldContent?.locations.length ?? 0
      );
      if (!invariantResult.travel) {
        return {
          ...prev,
          error: "World content missing locations.",
          isInitialized: false,
          isLoading: false,
        };
      }
      return {
        ...prev,
        unifiedState: invariantResult.unified,
        travelState: invariantResult.travel,
      };
    });
    triggerAutosave("world-content");
  }, [worldContent, mergeIntoWorldState, sessionState.unifiedState, ensureWorldInvariants, triggerAutosave]);

  useEffect(() => {
    latestStateRef.current = {
      unified: sessionState.unifiedState,
      travel: sessionState.travelState,
    };
    if (!sessionState.isInitialized || !sessionState.unifiedState || !sessionState.travelState) return;
    triggerAutosave("state-change");
  }, [sessionState.isInitialized, sessionState.unifiedState, sessionState.travelState, triggerAutosave]);

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
    reloadLatestFromDb,
    triggerAutosave,
    autosaveNow,
    retryBootstrap,
    expandWorld,
    fetchSaves: persistence.fetchSaves,
    deleteSave: persistence.deleteSave,
  };
}
