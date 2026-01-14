/**
 * NPC system with personality, goals, relationships, and memory.
 * Pure functions only - no mutations.
 */

import type {
  NPC,
  NPCMemory,
  NPCGoal,
  NPCRelationship,
  PersonalityTrait,
  Disposition,
  DialogueNode,
  DialogueResponse,
  Inventory,
  Equipment,
} from "./types";
import { createInventory, createEquipment } from "./Item";

// ============= NPC Factory =============

let npcIdCounter = 0;

export function createNPC(params: {
  id?: string;
  entityId: string;
  name: string;
  title?: string;
  factionId: string;
  personality?: PersonalityTrait[];
  goals?: NPCGoal[];
  canTrade?: boolean;
  isEssential?: boolean;
  inventory?: Inventory;
  equipment?: Equipment;
}): NPC {
  return {
    id: params.id ?? `npc_${++npcIdCounter}`,
    entityId: params.entityId,
    name: params.name,
    title: params.title,
    factionId: params.factionId,
    personality: params.personality ?? [],
    goals: params.goals ?? [],
    relationships: [],
    memories: [],
    inventory: params.inventory ?? createInventory(),
    equipment: params.equipment ?? createEquipment(),
    dialogue: [],
    questsOffered: [],
    canTrade: params.canTrade ?? false,
    priceModifier: 1.0,
    knownSecrets: [],
    isEssential: params.isEssential ?? false,
  };
}

// ============= Memory System =============

export function addMemory(
  npc: NPC,
  event: string,
  tags: string[],
  emotionalImpact: number = 0
): NPC {
  const memory: NPCMemory = {
    timestamp: Date.now(),
    event,
    tags,
    emotionalImpact: Math.max(-10, Math.min(10, emotionalImpact)),
    decay: 0.1, // Loses 10% relevance per day
  };

  // Keep most recent 50 memories
  const newMemories = [memory, ...npc.memories].slice(0, 50);

  return { ...npc, memories: newMemories };
}

export function forgetOldMemories(npc: NPC, threshold: number = 0.1): NPC {
  // Remove memories whose impact has decayed below threshold
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  const newMemories = npc.memories.filter(memory => {
    const ageInDays = (now - memory.timestamp) / dayMs;
    const decayedImpact = Math.abs(memory.emotionalImpact) * Math.pow(1 - memory.decay, ageInDays);
    return decayedImpact >= threshold;
  });

  return { ...npc, memories: newMemories };
}

export function recallMemories(npc: NPC, tags: string[]): readonly NPCMemory[] {
  return npc.memories.filter(memory =>
    tags.some(tag => memory.tags.includes(tag))
  );
}

export function hasMemoryOf(npc: NPC, entityId: string): boolean {
  return npc.memories.some(m => m.tags.includes(entityId));
}

// ============= Relationship System =============

export function getRelationship(npc: NPC, entityId: string): NPCRelationship | undefined {
  return npc.relationships.find(r => r.entityId === entityId);
}

export function createRelationship(
  entityId: string,
  disposition: Disposition = "neutral"
): NPCRelationship {
  return {
    entityId,
    disposition,
    trust: 0,
    respect: 0,
    fear: 0,
    history: [],
  };
}

export function updateRelationship(
  npc: NPC,
  entityId: string,
  changes: Partial<Omit<NPCRelationship, "entityId" | "history">>,
  historyEntry?: string
): NPC {
  const existingIndex = npc.relationships.findIndex(r => r.entityId === entityId);
  let relationship: NPCRelationship;
  
  if (existingIndex >= 0) {
    const existing = npc.relationships[existingIndex];
    relationship = {
      ...existing,
      trust: Math.max(-100, Math.min(100, (existing.trust + (changes.trust ?? 0)))),
      respect: Math.max(-100, Math.min(100, (existing.respect + (changes.respect ?? 0)))),
      fear: Math.max(0, Math.min(100, (existing.fear + (changes.fear ?? 0)))),
      disposition: changes.disposition ?? calculateDisposition(
        existing.trust + (changes.trust ?? 0),
        existing.respect + (changes.respect ?? 0),
        existing.fear + (changes.fear ?? 0)
      ),
      history: historyEntry 
        ? [...existing.history, historyEntry].slice(-20)
        : existing.history,
    };
    
    const newRelationships = [...npc.relationships];
    newRelationships[existingIndex] = relationship;
    return { ...npc, relationships: newRelationships };
  } else {
    relationship = {
      entityId,
      trust: changes.trust ?? 0,
      respect: changes.respect ?? 0,
      fear: changes.fear ?? 0,
      disposition: changes.disposition ?? "neutral",
      history: historyEntry ? [historyEntry] : [],
    };
    return { ...npc, relationships: [...npc.relationships, relationship] };
  }
}

export function calculateDisposition(trust: number, respect: number, fear: number): Disposition {
  const score = trust * 0.5 + respect * 0.3 + (fear > 50 ? -fear * 0.2 : 0);
  
  if (score >= 60) return "allied";
  if (score >= 30) return "friendly";
  if (score >= -20) return "neutral";
  if (score >= -50) return "unfriendly";
  return "hostile";
}

// ============= Goals System =============

export function addGoal(npc: NPC, goal: Omit<NPCGoal, "progress" | "completed">): NPC {
  const newGoal: NPCGoal = {
    ...goal,
    progress: 0,
    completed: false,
  };
  return { ...npc, goals: [...npc.goals, newGoal] };
}

export function updateGoalProgress(npc: NPC, goalId: string, progress: number): NPC {
  const newGoals = npc.goals.map(goal => {
    if (goal.id === goalId) {
      const newProgress = Math.max(0, Math.min(100, goal.progress + progress));
      return {
        ...goal,
        progress: newProgress,
        completed: newProgress >= 100,
      };
    }
    return goal;
  });
  return { ...npc, goals: newGoals };
}

export function getActiveGoals(npc: NPC): readonly NPCGoal[] {
  return npc.goals.filter(g => !g.completed);
}

export function getHighestPriorityGoal(npc: NPC): NPCGoal | undefined {
  const active = getActiveGoals(npc);
  if (active.length === 0) return undefined;
  return active.reduce((a, b) => a.priority > b.priority ? a : b);
}

// ============= Personality System =============

export function hasTrait(npc: NPC, trait: PersonalityTrait): boolean {
  return npc.personality.includes(trait);
}

export function getPersonalityScore(npc: NPC, positiveTraits: PersonalityTrait[], negativeTraits: PersonalityTrait[]): number {
  let score = 0;
  for (const trait of npc.personality) {
    if (positiveTraits.includes(trait)) score++;
    if (negativeTraits.includes(trait)) score--;
  }
  return score;
}

export function willLie(npc: NPC, toEntityId: string): boolean {
  const relationship = getRelationship(npc, toEntityId);
  const baseChance = hasTrait(npc, "deceptive") ? 0.5 : hasTrait(npc, "honest") ? 0.05 : 0.2;
  
  // More likely to lie to enemies
  const relationshipMod = relationship 
    ? (100 - relationship.trust) / 200 
    : 0;
  
  return Math.random() < baseChance + relationshipMod;
}

export function willHelp(npc: NPC, entityId: string): boolean {
  const relationship = getRelationship(npc, entityId);
  const baseChance = hasTrait(npc, "kind") ? 0.7 : hasTrait(npc, "cruel") ? 0.1 : 0.4;
  
  const relationshipMod = relationship 
    ? relationship.trust / 100 * 0.5 
    : 0;
  
  return Math.random() < baseChance + relationshipMod;
}

// ============= Trading System =============

export function calculateTradePrice(npc: NPC, basePrice: number, entityId: string): number {
  const relationship = getRelationship(npc, entityId);
  let modifier = npc.priceModifier;
  
  // Greed affects prices
  if (hasTrait(npc, "greedy")) modifier *= 1.3;
  if (hasTrait(npc, "generous")) modifier *= 0.8;
  
  // Relationship affects prices
  if (relationship) {
    modifier *= 1 - (relationship.trust / 200); // Max 50% discount at 100 trust
    if (relationship.fear > 50) modifier *= 0.9; // Fear gives small discount
  }
  
  return Math.max(1, Math.round(basePrice * modifier));
}

export function setCanTrade(npc: NPC, canTrade: boolean): NPC {
  return { ...npc, canTrade };
}

// ============= Dialogue System =============

export function addDialogue(npc: NPC, node: DialogueNode): NPC {
  return { ...npc, dialogue: [...npc.dialogue, node] };
}

export function setDialogue(npc: NPC, dialogue: DialogueNode[]): NPC {
  return { ...npc, dialogue };
}

export function getDialogueNode(npc: NPC, nodeId: string): DialogueNode | undefined {
  return npc.dialogue.find(d => d.id === nodeId);
}

export function getAvailableResponses(
  npc: NPC,
  nodeId: string,
  context: {
    questStates: Map<string, string>;
    playerItems: Set<string>;
    storyFlags: Set<string>;
  }
): readonly DialogueResponse[] {
  const node = getDialogueNode(npc, nodeId);
  if (!node) return [];
  
  return node.responses.filter(response => {
    // For now, return all responses. Conditions can be checked later
    return true;
  });
}

// ============= Quest Offering =============

export function addQuestOffered(npc: NPC, questId: string): NPC {
  if (npc.questsOffered.includes(questId)) return npc;
  return { ...npc, questsOffered: [...npc.questsOffered, questId] };
}

export function removeQuestOffered(npc: NPC, questId: string): NPC {
  return { ...npc, questsOffered: npc.questsOffered.filter(q => q !== questId) };
}

// ============= Secrets =============

export function addSecret(npc: NPC, secret: string): NPC {
  if (npc.knownSecrets.includes(secret)) return npc;
  return { ...npc, knownSecrets: [...npc.knownSecrets, secret] };
}

export function knowsSecret(npc: NPC, secret: string): boolean {
  return npc.knownSecrets.includes(secret);
}
