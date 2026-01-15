/**
 * Hook to load AI-generated world content from the database and merge it 
 * into the unified engine state. Single source of truth is the unified state;
 * ai_generated_content is the persistence layer.
 */

import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { WorldState, NPC, Quest, Location, FactionInfo, Alignment, PersonalityTrait } from "@/engine/narrative/types";
import type { EnhancedLocation, LocationService } from "@/engine/narrative/Travel";
import { toast } from "sonner";

interface WorldContent {
  factions: FactionInfo[];
  npcs: NPC[];
  quests: Quest[];
  locations: EnhancedLocation[];
  worldHooks: string[];
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all generated content for this campaign
  const fetchContent = useCallback(async (): Promise<WorldContent | null> => {
    if (!campaignId) return null;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const { data, error: fetchError } = await supabase
        .from("ai_generated_content")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: true });

      if (fetchError) throw fetchError;
      if (!data || data.length === 0) {
        return null;
      }

      // Group content by type
      const factions: FactionInfo[] = [];
      const npcs: NPC[] = [];
      const quests: Quest[] = [];
      const locations: EnhancedLocation[] = [];
      const worldHooks: string[] = [];

      for (const item of data) {
        const raw = item.content as Record<string, unknown>;
        
        switch (item.content_type) {
          case "faction":
            factions.push(convertToFaction(raw, item.content_id));
            break;
          case "npc":
            npcs.push(convertToNPC(raw, item.content_id));
            break;
          case "quest":
            quests.push(convertToQuest(raw, item.content_id));
            break;
          case "location":
            locations.push(convertToLocation(raw, item.content_id));
            break;
          case "world_hooks":
            if (Array.isArray(raw)) {
              worldHooks.push(...raw as string[]);
            }
            break;
        }
      }

      const result: WorldContent = { factions, npcs, quests, locations, worldHooks };
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
    }
  }, [campaignId]);

  // Merge content into a WorldState
  const mergeIntoWorldState = useCallback((
    baseWorld: WorldState,
    worldContent: WorldContent
  ): WorldState => {
    const newNPCs = new Map(baseWorld.npcs);
    const newQuests = new Map(baseWorld.quests);
    const newLocations = new Map(baseWorld.locations);

    // Merge NPCs (avoid duplicates by ID)
    for (const npc of worldContent.npcs) {
      if (!newNPCs.has(npc.id)) {
        newNPCs.set(npc.id, npc);
      }
    }

    // Merge Quests
    for (const quest of worldContent.quests) {
      if (!newQuests.has(quest.id)) {
        newQuests.set(quest.id, quest);
      }
    }

    // Merge Locations
    for (const location of worldContent.locations) {
      if (!newLocations.has(location.id)) {
        newLocations.set(location.id, location);
      }
    }

    // Update campaign seed with factions if not already present
    const existingFactionIds = new Set(baseWorld.campaignSeed.factions?.map(f => f.id) ?? []);
    const newFactions = [
      ...(baseWorld.campaignSeed.factions ?? []),
      ...worldContent.factions.filter(f => !existingFactionIds.has(f.id)),
    ];

    return {
      ...baseWorld,
      npcs: newNPCs,
      quests: newQuests,
      locations: newLocations,
      campaignSeed: {
        ...baseWorld.campaignSeed,
        factions: newFactions,
      },
    };
  }, []);

  // Load on mount
  useEffect(() => {
    if (campaignId) {
      fetchContent();
    }
  }, [campaignId, fetchContent]);

  return {
    content,
    isLoading,
    error,
    fetchContent,
    mergeIntoWorldState,
  };
}

// ============= Converters =============

function convertToFaction(raw: Record<string, unknown>, contentId: string): FactionInfo {
  return {
    id: (raw.id as string) ?? contentId,
    name: (raw.name as string) ?? "Unknown Faction",
    description: (raw.description as string) ?? "",
    alignment: (raw.alignment as Alignment) ?? "true_neutral",
    goals: (raw.goals as string[]) ?? [],
    enemies: (raw.enemies as string[]) ?? [],
    allies: (raw.allies as string[]) ?? [],
  };
}

function parsePersonalityTraits(rawTraits: unknown): readonly PersonalityTrait[] {
  if (!Array.isArray(rawTraits)) return ["neutral" as PersonalityTrait];
  
  return rawTraits
    .filter((t): t is string => typeof t === "string")
    .map(t => t.toLowerCase() as PersonalityTrait)
    .filter(t => VALID_TRAITS.includes(t))
    .slice(0, 4) as readonly PersonalityTrait[];
}

function convertToNPC(raw: Record<string, unknown>, contentId: string): NPC {
  const npcId = `npc_${contentId}_${Date.now().toString(36).slice(-4)}`;
  const entityId = `entity_${npcId}`;
  
  const goals = Array.isArray(raw.goals)
    ? (raw.goals as Array<{ id?: string; description?: string; priority?: number }>)
    : [];
  const dialogue = raw.dialogue as { text?: string; responses?: unknown } | undefined;
  const dialogueResponses = Array.isArray(dialogue?.responses)
    ? (dialogue?.responses as Array<{ text?: string; nextNodeId?: string }>)
    : [];
  
  const personality = parsePersonalityTraits(raw.personality);
  
  return {
    id: npcId,
    entityId,
    name: (raw.name as string) ?? "Unknown NPC",
    title: raw.title as string | undefined,
    factionId: (raw.factionId as string) ?? "neutral",
    personality: personality.length > 0 ? personality : ["honest" as PersonalityTrait],
    goals: goals.map((g, i) => ({
      id: g.id ?? `goal_${i}`,
      description: g.description ?? "Unknown goal",
      priority: g.priority ?? 1,
      progress: 0,
      completed: false,
    })),
    relationships: [],
    memories: [],
    inventory: { slots: [], maxSlots: 20, gold: Math.floor(Math.random() * 100) + 10 },
    equipment: {},
    dialogue: dialogue ? [{
      id: "greeting",
      text: dialogue.text ?? "Hello, traveler.",
      responses: dialogueResponses.map((r) => ({
        text: r.text ?? "Hello.",
        nextNodeId: r.nextNodeId,
      })),
    }] : [{
      id: "greeting",
      text: "Hello, traveler.",
      responses: [{ text: "Hello." }],
    }],
    questsOffered: [],
    canTrade: (raw.canTrade as boolean) ?? false,
    priceModifier: 1.0,
    knownSecrets: toStringArray(raw.secrets),
    isEssential: false,
  };
}

function convertToQuest(raw: Record<string, unknown>, contentId: string): Quest {
  const questId = `quest_${contentId}_${Date.now().toString(36).slice(-4)}`;
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
  
  return {
    id: questId,
    title: (raw.title as string) ?? "Unknown Quest",
    description: (raw.description as string) ?? "",
    briefDescription: (raw.briefDescription as string) ?? (raw.description as string)?.slice(0, 100) ?? "",
    giverId: "unknown",
    state: "available",
    objectives: objectives.map((obj, i) => ({
      id: `obj_${i}`,
      type: (obj.type as Quest["objectives"][0]["type"]) ?? "explore",
      description: obj.description ?? "Unknown objective",
      targetType: obj.targetType,
      current: 0,
      required: obj.required ?? 1,
      optional: false,
      hidden: false,
    })),
    rewards: {
      xp: rewards?.xp ?? 100,
      gold: rewards?.gold ?? 50,
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

function convertToLocation(raw: Record<string, unknown>, contentId: string): EnhancedLocation {
  const locationId = contentId === "starting_location" 
    ? "starting_location" 
    : `loc_${contentId}_${Date.now().toString(36).slice(-4)}`;
  
  const connectedTo = toStringArray(raw.connectedTo);
  const services = parseServices(raw.services);
  
  return {
    id: locationId,
    name: (raw.name as string) ?? "Unknown Location",
    description: (raw.description as string) ?? "",
    type: (raw.type as EnhancedLocation["type"]) ?? "town",
    connectedTo,
    position: { x: Math.floor(Math.random() * 200) + 100, y: Math.floor(Math.random() * 200) + 100 },
    radius: 30,
    discovered: locationId === "starting_location",
    items: [],
    // Enhanced fields
    dangerLevel: typeof raw.dangerLevel === "number" ? raw.dangerLevel : 1,
    npcs: toStringArray(raw.inhabitants),
    factionControl: null,
    questHooks: [],
    services: services.length > 0 ? services : ["rest", "trade"] as readonly LocationService[],
    ambientDescription: (raw.description as string) ?? "",
    shops: [],
    inn: true,
    travelTime: {},
    currentEvents: [],
  };
}
