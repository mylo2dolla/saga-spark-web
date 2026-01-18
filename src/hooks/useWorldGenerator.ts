/**
 * Hook for AI-driven world generation using the world-generator edge function.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { 
  CampaignSeed, 
  NPC, 
  Quest, 
  FactionInfo,
  DialogueNode,
  NPCGoal,
  PersonalityTrait,
  QuestObjective,
  ObjectiveType,
  Alignment,
  Inventory,
  Equipment,
} from "@/engine/narrative/types";
import { toast } from "sonner";
import { recordEdgeCall, recordEdgeResponse } from "@/ui/data/networkHealth";

const DEV_DEBUG = import.meta.env.DEV;

export interface GeneratedNPC {
  name: string;
  title?: string;
  personality: PersonalityTrait[];
  goals: { id: string; description: string; priority: number }[];
  factionId: string;
  canTrade: boolean;
  dialogue: { text: string; responses: { text: string; nextNodeId?: string }[] };
  questHook?: { title: string; description: string; objectiveType: string };
  secrets?: string[];
}

export interface GeneratedQuest {
  title: string;
  description: string;
  briefDescription: string;
  importance: "side" | "main" | "legendary";
  objectives: {
    type: string;
    description: string;
    targetType?: string;
    required: number;
  }[];
  rewards: {
    xp: number;
    gold: number;
    items: string[];
    storyFlags: string[];
  };
  storyArc?: string;
  timeLimit?: number;
}

export interface GeneratedWorld {
  factions: {
    id: string;
    name: string;
    description: string;
    alignment: string;
    goals: string[];
    enemies: string[];
    allies: string[];
  }[];
  locations: {
    id: string;
    name: string;
    description: string;
    type: string;
    dangerLevel?: number;
    position?: { x: number; y: number };
    connectedTo?: string[];
  }[];
  startingLocationId: string;
  npcs: GeneratedNPC[];
  initialQuest: GeneratedQuest;
  worldHooks: string[];
}

interface GenerationContext {
  playerLevel?: number;
  existingNPCs?: string[];
  existingQuests?: string[];
  playerActions?: string[];
  npcId?: string;
  npcName?: string;
  npcPersonality?: string[];
  playerRelationship?: string;
  worldState?: Record<string, unknown>;
  campaignId?: string;
}

export function useWorldGenerator() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastEdgeError, setLastEdgeError] = useState<unknown | null>(null);

  const generate = useCallback(async <T>(
    type: "npc" | "quest" | "dialog" | "faction" | "location" | "initial_world",
    campaignSeed: { title: string; description: string; themes?: string[] },
    context?: GenerationContext
  ): Promise<T | null> => {
    setIsGenerating(true);
    setError(null);
    setLastEdgeError(null);

    try {
      if (DEV_DEBUG) {
        console.info("DEV_DEBUG worldGenerator invoke start", {
          type,
          campaignTitle: campaignSeed.title,
        });
      }

      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? null;
      if (DEV_DEBUG) {
        console.info("DEV_DEBUG worldGenerator auth", {
          type,
          hasAccessToken: Boolean(accessToken),
          userId: session?.user?.id ?? null,
        });
      }

      recordEdgeCall();
      const invokePromise = supabase.functions.invoke("world-generator", {
        body: { type, campaignSeed, context },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("World generation timed out")), 90000);
      });

      const { data, error: fnError } = await Promise.race([invokePromise, timeoutPromise]);

      if (fnError) {
        setLastEdgeError({
          ok: false,
          code: "invoke_error",
          message: fnError.message || "Generation failed",
          details: fnError,
        });
        throw new Error(fnError.message || "Generation failed");
      }

      if (data?.ok === false) {
        setLastEdgeError(data);
        throw new Error(data.message || "Generation failed");
      }
      if (data?.error) {
        setLastEdgeError({
          ok: false,
          code: "function_error",
          message: data.error,
          details: data,
        });
        throw new Error(data.error);
      }
      recordEdgeResponse();

      if (DEV_DEBUG) {
        console.info("DEV_DEBUG worldGenerator invoke success", {
          type,
          hasContent: Boolean(data.content),
        });
      }

      return data.content as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      if (DEV_DEBUG) {
        console.error("DEV_DEBUG worldGenerator invoke error", {
          type,
          message,
        });
      }
      
      if (message.includes("Rate limit")) {
        toast.error("Rate limit exceeded. Please wait a moment.");
      } else if (message.includes("Usage limit")) {
        toast.error("AI credits needed. Please add credits to continue.");
      } else {
        toast.error(`Generation failed: ${message}`);
      }
      
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  // Generate initial world for a new campaign
  const generateInitialWorld = useCallback(async (
    seed: { title: string; description: string; themes?: string[] },
    context?: GenerationContext
  ): Promise<GeneratedWorld | null> => {
    return generate<GeneratedWorld>("initial_world", seed, context);
  }, [generate]);

  // Generate a single NPC
  const generateNPC = useCallback(async (
    seed: { title: string; description: string; themes?: string[] },
    context?: GenerationContext
  ): Promise<GeneratedNPC | null> => {
    return generate<GeneratedNPC>("npc", seed, context);
  }, [generate]);

  // Generate a quest
  const generateQuest = useCallback(async (
    seed: { title: string; description: string; themes?: string[] },
    context?: GenerationContext
  ): Promise<GeneratedQuest | null> => {
    return generate<GeneratedQuest>("quest", seed, context);
  }, [generate]);

  const generateLocation = useCallback(async (
    seed: { title: string; description: string; themes?: string[] },
    context?: GenerationContext
  ): Promise<GeneratedWorld["locations"][number] | null> => {
    return generate<GeneratedWorld["locations"][number]>("location", seed, context);
  }, [generate]);

  // Generate dialogue for an NPC
  const generateDialog = useCallback(async (
    seed: { title: string; description: string; themes?: string[] },
    npcName: string,
    npcPersonality: string[],
    playerRelationship: string
  ): Promise<{ greeting: string; nodes: DialogueNode[] } | null> => {
    return generate("dialog", seed, {
      npcName,
      npcPersonality,
      playerRelationship,
    });
  }, [generate]);

  // Convert generated NPC to engine NPC type
  const toEngineNPC = useCallback((
    generated: GeneratedNPC,
    entityId: string
  ): NPC => {
    const npcId = `npc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    
    return {
      id: npcId,
      entityId,
      name: generated.name,
      title: generated.title,
      factionId: generated.factionId,
      personality: generated.personality,
      goals: generated.goals.map(g => ({
        id: g.id,
        description: g.description,
        priority: g.priority,
        progress: 0,
        completed: false,
      })),
      relationships: [],
      memories: [],
      inventory: { slots: [], maxSlots: 20, gold: Math.floor(Math.random() * 100) },
      equipment: {},
      dialogue: [{
        id: "greeting",
        text: generated.dialogue.text,
        responses: generated.dialogue.responses.map((r, i) => ({
          text: r.text,
          nextNodeId: r.nextNodeId,
        })),
      }],
      questsOffered: [],
      canTrade: generated.canTrade,
      priceModifier: 1.0,
      knownSecrets: generated.secrets ?? [],
      isEssential: false,
    };
  }, []);

  // Convert generated quest to engine Quest type
  const toEngineQuest = useCallback((
    generated: GeneratedQuest,
    giverId: string
  ): Quest => {
    const questId = `quest_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    
    return {
      id: questId,
      title: generated.title,
      description: generated.description,
      briefDescription: generated.briefDescription,
      giverId,
      state: "available",
      objectives: generated.objectives.map((obj, i) => ({
        id: `obj_${i}`,
        type: obj.type as ObjectiveType,
        description: obj.description,
        targetType: obj.targetType,
        current: 0,
        required: obj.required,
        optional: false,
        hidden: false,
      })),
      rewards: {
        xp: generated.rewards.xp,
        gold: generated.rewards.gold,
        items: generated.rewards.items,
        storyFlags: generated.rewards.storyFlags,
      },
      timeLimit: generated.timeLimit,
      turnsElapsed: 0,
      prerequisites: [],
      conflictsWith: [],
      storyArc: generated.storyArc,
      importance: generated.importance,
    };
  }, []);

  // Convert generated factions to engine FactionInfo type
  const toEngineFactions = useCallback((
    generated: GeneratedWorld["factions"]
  ): FactionInfo[] => {
    return generated.map(f => ({
      id: f.id,
      name: f.name,
      description: f.description,
      alignment: f.alignment as Alignment,
      goals: f.goals,
      enemies: f.enemies,
      allies: f.allies,
    }));
  }, []);

  return {
    isGenerating,
    error,
    lastEdgeError,
    generateInitialWorld,
    generateNPC,
    generateQuest,
    generateDialog,
    generateLocation,
    toEngineNPC,
    toEngineQuest,
    toEngineFactions,
  };
}
