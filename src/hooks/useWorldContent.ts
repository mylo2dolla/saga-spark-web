/**
 * Hook to load AI-generated world content from the database and merge it 
 * into the unified engine state. Single source of truth is the unified state;
 * ai_generated_content is the persistence layer.
 */

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WorldState, NPC, Quest, Location, FactionInfo, Alignment, PersonalityTrait, StoryFlag } from "@/engine/narrative/types";
import type { EnhancedLocation, LocationService } from "@/engine/narrative/Travel";
import { toast } from "sonner";
import { recordDbRead } from "@/ui/data/networkHealth";

const DEV_DEBUG = import.meta.env.DEV;

interface WorldContent {
  factions: FactionInfo[];
  npcs: NPC[];
  quests: Quest[];
  locations: EnhancedLocation[];
  worldHooks: string[];
  storyFlags: StoryFlag[];
}

interface UseWorldContentOptions {
  campaignId: string;
}


// Valid personality traits
const VALID_TRAITS: PersonalityTrait[] = [
  "honest", "deceptive", "brave", "cowardly",
  "kind", "cruel", "greedy", "generous",
  "wise", "foolish", "proud", "humble",
  "loyal", "treacherous", "patient", "impulsive"
];

// Valid location services
const VALID_SERVICES: LocationService[] = [
  "rest", "trade", "repair", "heal", "enchant", "stable", "bank"
];

export function useWorldContent({ campaignId }: UseWorldContentOptions) {
  const [content, setContent] = useState<WorldContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasLoadedContent, setHasLoadedContent] = useState(false);

  // Fetch all generated content for this campaign
  const fetchContent = useCallback(async (): Promise<WorldContent | null> => {
    if (!campaignId) return null;
    
    setIsLoading(true);
    setHasLoadedContent(false);
    setError(null);
    
    try {
      const { data, error: fetchError } = await supabase
        .from("ai_generated_content")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true });

      if (fetchError) throw fetchError;
      recordDbRead();
      if (!data || data.length === 0) {
        return null;
      }

      // Group content by type
      const factions: FactionInfo[] = [];
      const npcs: NPC[] = [];
      const quests: Quest[] = [];
      const locations: EnhancedLocation[] = [];
      const worldHooks: string[] = [];
      const storyFlags: StoryFlag[] = [];
      const rawLocationSamples: Array<{ contentId: string; rawId?: string; rawName?: string }> = [];

      for (const item of data) {
        const raw = item.content as Record<string, unknown>;
        if (isMockContent(item.content_type, raw)) {
          continue;
        }
        
        switch (item.content_type) {
          case "faction":
            {
              const faction = convertToFaction(raw, item.content_id);
              if (faction) {
                factions.push(faction);
              }
              break;
            }
          case "npc":
            {
              const npc = convertToNPC(raw, item.content_id);
              if (npc) {
                npcs.push(npc);
              }
              break;
            }
          case "quest":
            {
              const quest = convertToQuest(raw, item.content_id);
              if (quest) {
                quests.push(quest);
              }
              break;
            }
          case "location":
            {
              rawLocationSamples.push({
                contentId: item.content_id,
                rawId: getString(raw.id) || undefined,
                rawName: getString(raw.name) || undefined,
              });
              const location = convertToLocation(raw, item.content_id);
              if (location) {
                locations.push(location);
              }
              break;
            }
          case "world_hooks":
            if (Array.isArray(raw)) {
              worldHooks.push(
                ...(raw as string[]).filter((hook) => !containsMockNarrative(hook))
              );
            }
            break;
          case "story_flag":
            {
              const flag = convertToStoryFlag(raw, item.content_id);
              if (flag) {
                storyFlags.push(flag);
              }
              break;
            }
        }
      }

      if (DEV_DEBUG) {
        console.info("DEV_DEBUG worldContent raw locations", {
          rawLocationsCount: rawLocationSamples.length,
          sample: rawLocationSamples.slice(0, 3),
        });
      }

      const result: WorldContent = { factions, npcs, quests, locations, worldHooks, storyFlags };
      if (DEV_DEBUG) {
        const locationPositions = result.locations.slice(0, 3).map(location => ({
          id: location.id,
          x: location.position.x,
          y: location.position.y,
        }));
        const connectedToLengths = result.locations.slice(0, 3).map(location => ({
          id: location.id,
          connectedToCount: location.connectedTo.length,
        }));
        console.info("DEV_DEBUG worldContent loaded", {
          locationsCount: result.locations.length,
          npcsCount: result.npcs.length,
          questsCount: result.quests.length,
          itemsCount: 0,
          locationIds: result.locations.slice(0, 10).map(location => location.id),
          locationPositions,
          connectedToLengths,
        });
        if (result.locations.length === 1) {
          toast.error("World generation returned 1 location");
        }
      }
      setContent(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load world content";
      setError(message);
      console.error("Error loading world content:", err);
      toast.error(message);
      return null;
    } finally {
      setIsLoading(false);
      setHasLoadedContent(true);
    }
  }, [campaignId]);

  // Merge content into a WorldState
  const mergeIntoWorldState = useCallback((
    baseWorld: WorldState,
    worldContent: WorldContent
  ): WorldState => {
    const contentNPCs = Array.isArray(worldContent?.npcs) ? worldContent.npcs : [];
    const contentQuests = Array.isArray(worldContent?.quests) ? worldContent.quests : [];
    const contentLocations = Array.isArray(worldContent?.locations) ? worldContent.locations : [];
    const contentStoryFlags = Array.isArray(worldContent?.storyFlags) ? worldContent.storyFlags : [];
    const contentFactions = Array.isArray(worldContent?.factions) ? worldContent.factions : [];

    const newNPCs = new Map(baseWorld.npcs);
    const newQuests = new Map(baseWorld.quests);
    const newLocations = new Map(baseWorld.locations as ReadonlyMap<string, EnhancedLocation>);
    const newStoryFlags = new Map(baseWorld.storyFlags);
    const hasRealContentLocations = contentLocations.some(
      location => location.id !== "starting_location"
    );
    if (contentLocations.length > 0 && hasRealContentLocations) {
      newLocations.delete("starting_location");
    }

    // Merge NPCs (avoid duplicates by ID)
    for (const npc of contentNPCs) {
      if (!newNPCs.has(npc.id)) {
        newNPCs.set(npc.id, npc);
      }
    }

    // Merge Quests
    for (const quest of contentQuests) {
      if (!newQuests.has(quest.id)) {
        newQuests.set(quest.id, quest);
      }
    }

    // Merge Locations
    for (const location of contentLocations) {
      if (hasRealContentLocations && location.id === "starting_location") {
        continue;
      }
      newLocations.set(location.id, location);
    }

    // Merge Story Flags
    for (const flag of contentStoryFlags) {
      newStoryFlags.set(flag.id, flag);
    }

    const resolvedLocations = resolveLocationConnections(newLocations);

    // Update campaign seed with factions if not already present
    const existingFactionIds = new Set(baseWorld.campaignSeed.factions?.map(f => f.id) ?? []);
    const newFactions = [
      ...(baseWorld.campaignSeed.factions ?? []),
      ...contentFactions.filter(f => !existingFactionIds.has(f.id)),
    ];

    return {
      ...baseWorld,
      npcs: newNPCs,
      quests: newQuests,
      locations: resolvedLocations as unknown as ReadonlyMap<string, Location>,
      storyFlags: newStoryFlags,
      campaignSeed: {
        ...baseWorld.campaignSeed,
        factions: newFactions,
      },
    };
  }, []);

  // Load on mount
  useEffect(() => {
    if (!campaignId) {
      setContent(null);
      setIsLoading(false);
      setHasLoadedContent(true); // Must be true so session can initialize
      return;
    }
    fetchContent();
  }, [campaignId, fetchContent]);

  return {
    content,
    isLoading,
    error,
    hasLoadedContent,
    fetchContent,
    mergeIntoWorldState,
  };
}

// ============= Converters =============

function convertToStoryFlag(raw: Record<string, unknown>, contentId: string): StoryFlag | null {
  const id = getString(raw.id) || contentId;
  if (!id) return null;
  const value = raw.value as StoryFlag["value"];
  if (value === undefined) return null;
  const setAt = typeof raw.setAt === "number" ? raw.setAt : Date.now();
  const source = getString(raw.source) || "action";
  return { id, value, setAt, source };
}

function convertToFaction(raw: Record<string, unknown>, contentId: string): FactionInfo | null {
  const name = getString(raw.name);
  if (!name || containsMockNarrative(name)) return null;

  return {
    id: getString(raw.id) || contentId,
    name,
    description: getString(raw.description),
    alignment: (raw.alignment as Alignment) ?? "true_neutral",
    goals: toStringArray(raw.goals),
    enemies: toStringArray(raw.enemies),
    allies: toStringArray(raw.allies),
  };
}

function parsePersonalityTraits(rawTraits: unknown): readonly PersonalityTrait[] {
  if (!Array.isArray(rawTraits)) return [];
  
  return rawTraits
    .filter((t): t is string => typeof t === "string")
    .map(t => t.toLowerCase() as PersonalityTrait)
    .filter(t => VALID_TRAITS.includes(t))
    .slice(0, 4) as readonly PersonalityTrait[];
}

function convertToNPC(raw: Record<string, unknown>, contentId: string): NPC | null {
  const npcId = (raw.id as string) ?? contentId;
  const entityId = `entity_${npcId}`;
  
  const goals = Array.isArray(raw.goals)
    ? (raw.goals as Array<{ id?: string; description?: string; priority?: number }>)
    : [];
  const dialogue = raw.dialogue as { text?: string; responses?: unknown } | undefined;
  const dialogueResponses = Array.isArray(dialogue?.responses)
    ? (dialogue?.responses as Array<{ text?: string; nextNodeId?: string }>)
    : [];
  
  const name = getString(raw.name);
  if (!name || containsMockNarrative(name)) return null;

  if (containsMockNarrative(getString(raw.title))) return null;
  if (containsMockNarrative(getString(dialogue?.text))) return null;
  if (dialogueResponses.some((response) => containsMockNarrative(getString(response.text)))) {
    return null;
  }

  const personality = parsePersonalityTraits(raw.personality);
  
  return {
    id: npcId,
    entityId,
    name,
    title: getString(raw.title) || undefined,
    factionId: (raw.factionId as string) ?? "neutral",
    personality,
    goals: goals
      .map((g, i) => ({
        id: g.id ?? `goal_${i}`,
        description: getString(g.description),
        priority: g.priority ?? 1,
        progress: 0,
        completed: false,
      }))
      .filter(goal => goal.description.length > 0),
    relationships: [],
    memories: [],
    inventory: { slots: [], maxSlots: 20, gold: 0 },
    equipment: {},
    dialogue: dialogue?.text
      ? [{
          id: "greeting",
          text: dialogue.text,
          responses: dialogueResponses
            .map((r) => ({
              text: getString(r.text),
              nextNodeId: r.nextNodeId,
            }))
            .filter((r) => r.text.length > 0),
        }]
      : [],
    questsOffered: [],
    canTrade: (raw.canTrade as boolean) ?? false,
    priceModifier: 1.0,
    knownSecrets: toStringArray(raw.secrets),
    isEssential: false,
  };
}

function convertToQuest(raw: Record<string, unknown>, contentId: string): Quest | null {
  const questId = (raw.id as string) ?? contentId;
  const giverId = (raw.giverId as string) ?? (raw.giver_id as string) ?? (raw.giver as string);
  const title = getString(raw.title);
  const description = getString(raw.description);
  if (!title || !description || containsMockNarrative(title) || containsMockNarrative(description)) {
    return null;
  }

  const objectives = Array.isArray(raw.objectives)
    ? (raw.objectives as Array<{
        type?: string;
        description?: string;
        targetType?: string;
        required?: number;
      }>)
    : [];
  
  const rewards = typeof raw.rewards === "object" && raw.rewards !== null
    ? (raw.rewards as {
        xp?: number;
        gold?: number;
        items?: unknown;
        storyFlags?: unknown;
      })
    : undefined;
  
  const rewardItems = toStringArray(rewards?.items);
  const rewardFlags = toStringArray(rewards?.storyFlags);
  
  const normalizedObjectives = objectives
    .map((obj, i) => ({
      id: `obj_${i}`,
      type: (obj.type as Quest["objectives"][0]["type"]) ?? "explore",
      description: getString(obj.description),
      targetType: obj.targetType,
      current: 0,
      required: obj.required ?? 1,
      optional: false,
      hidden: false,
    }))
    .filter(obj => obj.description.length > 0 && !containsMockNarrative(obj.description));

  if (normalizedObjectives.length === 0) {
    return null;
  }

  return {
    id: questId,
    title,
    description,
    briefDescription: getString(raw.briefDescription) || description.slice(0, 100),
    giverId: giverId ?? "unknown",
    state: "available",
    objectives: normalizedObjectives,
    rewards: {
      xp: rewards?.xp ?? 0,
      gold: rewards?.gold ?? 0,
      items: rewardItems,
      storyFlags: rewardFlags,
    },
    timeLimit: raw.timeLimit as number | undefined,
    turnsElapsed: 0,
    prerequisites: [],
    conflictsWith: [],
    storyArc: raw.storyArc as string | undefined,
    importance: (raw.importance as "side" | "main" | "legendary") ?? "side",
  };
}

function parseServices(rawServices: unknown): readonly LocationService[] {
  if (!Array.isArray(rawServices)) return ["rest", "trade"] as readonly LocationService[];
  
  return rawServices
    .filter((s): s is string => typeof s === "string")
    .map(s => s.toLowerCase() as LocationService)
    .filter(s => VALID_SERVICES.includes(s)) as readonly LocationService[];
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function containsMockNarrative(_text?: string): boolean {
  return false;
}

function isMockContent(_contentType: string, _raw: Record<string, unknown>): boolean {
  return false;
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function createDeterministicPosition(seed: string): { x: number; y: number } {
  const hashed = hashString(seed);
  const x = 100 + (hashed % 400);
  const y = 100 + ((hashed >>> 16) % 400);
  return { x, y };
}

function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveLocationConnections(
  locations: Map<string, EnhancedLocation>
): Map<string, EnhancedLocation> {
  if (locations.size === 0) return locations;

  const idSet = new Set(locations.keys());
  const nameToIds = new Map<string, string[]>();
  const typeToIds = new Map<string, string[]>();

  for (const location of locations.values()) {
    const nameKey = normalizeKey(location.name);
    if (!nameToIds.has(nameKey)) {
      nameToIds.set(nameKey, []);
    }
    nameToIds.get(nameKey)?.push(location.id);

    const typeKey = location.type.toLowerCase();
    if (!typeToIds.has(typeKey)) {
      typeToIds.set(typeKey, []);
    }
    typeToIds.get(typeKey)?.push(location.id);
  }

  let didChange = false;
  const nextLocations = new Map(locations);
  let hasAnyConnections = false;

  for (const location of locations.values()) {
    if (location.connectedTo.length === 0) continue;
    hasAnyConnections = true;

    const resolved = new Set<string>();
    for (const raw of location.connectedTo) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (idSet.has(trimmed)) {
        resolved.add(trimmed);
        continue;
      }

      const nameMatches = nameToIds.get(normalizeKey(trimmed));
      if (nameMatches && nameMatches.length > 0) {
        nameMatches.forEach(id => resolved.add(id));
        continue;
      }

      const typeMatches = typeToIds.get(trimmed.toLowerCase());
      if (typeMatches && typeMatches.length > 0) {
        typeMatches.forEach(id => resolved.add(id));
      }
    }

    resolved.delete(location.id);
    const resolvedIds = Array.from(resolved);
    const normalizedCurrent = location.connectedTo.filter(id => idSet.has(id));

    const sameConnections =
      normalizedCurrent.length === resolvedIds.length &&
      normalizedCurrent.every(id => resolved.has(id));

    if (!sameConnections) {
      didChange = true;
      const nextTravelTime = { ...location.travelTime };
      for (const id of resolvedIds) {
        if (typeof nextTravelTime[id] !== "number") {
          nextTravelTime[id] = 1;
        }
      }
      nextLocations.set(location.id, {
        ...location,
        connectedTo: resolvedIds,
        travelTime: nextTravelTime,
      });
    }
  }

  if (!hasAnyConnections && locations.size > 1) {
    const locationList = Array.from(nextLocations.values());
    const getDistance = (a: EnhancedLocation, b: EnhancedLocation) => {
      const dx = a.position.x - b.position.x;
      const dy = a.position.y - b.position.y;
      return Math.hypot(dx, dy);
    };

    for (const location of locationList) {
      const nearest = locationList
        .filter(candidate => candidate.id !== location.id)
        .sort((a, b) => getDistance(location, a) - getDistance(location, b))[0];
      if (!nearest) continue;

      const currentConnections = new Set(location.connectedTo);
      currentConnections.add(nearest.id);
      const nextTravelTime = { ...location.travelTime };
      if (typeof nextTravelTime[nearest.id] !== "number") {
        nextTravelTime[nearest.id] = 1;
      }
      nextLocations.set(location.id, {
        ...location,
        connectedTo: Array.from(currentConnections),
        travelTime: nextTravelTime,
      });

      const nearestConnections = new Set(nextLocations.get(nearest.id)?.connectedTo ?? []);
      if (!nearestConnections.has(location.id)) {
        const nearestTravelTime = { ...nearest.travelTime };
        if (typeof nearestTravelTime[location.id] !== "number") {
          nearestTravelTime[location.id] = 1;
        }
        nextLocations.set(nearest.id, {
          ...nearest,
          connectedTo: Array.from(nearestConnections).concat(location.id),
          travelTime: nearestTravelTime,
        });
      }

      didChange = true;
    }
  }

  return didChange ? nextLocations : locations;
}

function convertToLocation(raw: Record<string, unknown>, contentId: string): EnhancedLocation | null {
  const locationId = (raw.id as string) ?? contentId;
  const fallbackPosition = createDeterministicPosition(locationId);
  const rawPosition = raw.position as { x?: number; y?: number } | undefined;
  
  const name = getString(raw.name);
  if (!name || containsMockNarrative(name)) return null;

  const connectedTo = toStringArray(raw.connectedTo);
  const services = parseServices(raw.services);
  
  return {
    id: locationId,
    name,
    description: getString(raw.description),
    type: (raw.type as EnhancedLocation["type"]) ?? "town",
    connectedTo,
    position: typeof rawPosition?.x === "number" && typeof rawPosition?.y === "number"
      ? { x: rawPosition.x, y: rawPosition.y }
      : fallbackPosition,
    radius: 30,
    discovered: raw.isStartingLocation === true || raw.isStarting === true,
    items: [],
    // Enhanced fields
    dangerLevel: typeof raw.dangerLevel === "number" ? raw.dangerLevel : 1,
    npcs: toStringArray(raw.inhabitants),
    factionControl: null,
    questHooks: [],
    services: services.length > 0 ? services : ["rest", "trade"] as readonly LocationService[],
    ambientDescription: getString(raw.ambientDescription) || getString(raw.description),
    shops: [],
    inn: true,
    travelTime: {},
    currentEvents: [],
  };
}
