/**
 * World state management - the narrative equivalent of GameState.
 * Integrates NPCs, quests, items, locations, and story flags.
 * Pure functions only - no mutations.
 */

import type {
  WorldState,
  CampaignSeed,
  NPC,
  Quest,
  Item,
  Location,
  StoryFlag,
  CharacterProgression,
  WorldAction,
  WorldEvent,
  FactionInfo,
  QuestReward,
} from "./types.ts";
import * as NPCModule from "./NPC";
import * as QuestModule from "./Quest";
import * as ItemModule from "./Item";
import * as ProgressionModule from "./Progression";

// ============= World Factory =============

export function createWorldState(seed: CampaignSeed): WorldState {
  return {
    campaignSeed: seed,
    npcs: new Map(),
    quests: new Map(),
    items: new Map(),
    locations: new Map(),
    storyFlags: new Map(),
    globalTime: 0,
    playerProgression: new Map(),
  };
}

export function createCampaignSeed(
  title: string,
  description: string,
  themes: string[] = [],
  factions: FactionInfo[] = []
): CampaignSeed {
  return {
    id: `campaign_${Date.now()}`,
    title,
    description,
    themes,
    factions,
    createdAt: Date.now(),
  };
}

// ============= Entity Management =============

export function addNPC(world: WorldState, npc: NPC): WorldState {
  const newNPCs = new Map(world.npcs);
  newNPCs.set(npc.id, npc);
  return { ...world, npcs: newNPCs };
}

export function updateNPC(world: WorldState, npc: NPC): WorldState {
  const newNPCs = new Map(world.npcs);
  newNPCs.set(npc.id, npc);
  return { ...world, npcs: newNPCs };
}

export function removeNPC(world: WorldState, npcId: string): WorldState {
  const newNPCs = new Map(world.npcs);
  newNPCs.delete(npcId);
  return { ...world, npcs: newNPCs };
}

export function addQuest(world: WorldState, quest: Quest): WorldState {
  const newQuests = new Map(world.quests);
  newQuests.set(quest.id, quest);
  return { ...world, quests: newQuests };
}

export function updateQuest(world: WorldState, quest: Quest): WorldState {
  const newQuests = new Map(world.quests);
  newQuests.set(quest.id, quest);
  return { ...world, quests: newQuests };
}

export function addItem(world: WorldState, item: Item): WorldState {
  const newItems = new Map(world.items);
  newItems.set(item.id, item);
  return { ...world, items: newItems };
}

export function addLocation(world: WorldState, location: Location): WorldState {
  const newLocations = new Map(world.locations);
  newLocations.set(location.id, location);
  return { ...world, locations: newLocations };
}

export function updateLocation(world: WorldState, location: Location): WorldState {
  const newLocations = new Map(world.locations);
  newLocations.set(location.id, location);
  return { ...world, locations: newLocations };
}

// ============= Story Flags =============

export function setFlag(
  world: WorldState,
  id: string,
  value: boolean | number | string,
  source: string
): WorldState {
  const flag: StoryFlag = {
    id,
    value,
    setAt: world.globalTime,
    source,
  };
  const newFlags = new Map(world.storyFlags);
  newFlags.set(id, flag);
  return { ...world, storyFlags: newFlags };
}

export function getFlag(world: WorldState, id: string): StoryFlag | undefined {
  return world.storyFlags.get(id);
}

export function hasFlag(world: WorldState, id: string): boolean {
  const flag = world.storyFlags.get(id);
  return flag !== undefined && flag.value === true;
}

export function getFlagValue<T extends boolean | number | string>(
  world: WorldState,
  id: string,
  defaultValue: T
): T {
  const flag = world.storyFlags.get(id);
  return (flag?.value as T) ?? defaultValue;
}

// ============= Player Progression =============

export function initPlayerProgression(
  world: WorldState,
  entityId: string
): WorldState {
  const progression = ProgressionModule.createProgression(entityId);
  const newProgressions = new Map(world.playerProgression);
  newProgressions.set(entityId, progression);
  return { ...world, playerProgression: newProgressions };
}

export function updatePlayerProgression(
  world: WorldState,
  progression: CharacterProgression
): WorldState {
  const newProgressions = new Map(world.playerProgression);
  newProgressions.set(progression.entityId, progression);
  return { ...world, playerProgression: newProgressions };
}

// ============= Action Processing =============

export interface WorldActionResult {
  world: WorldState;
  events: WorldEvent[];
  success: boolean;
  message: string;
}

export function processWorldAction(
  world: WorldState,
  action: WorldAction
): WorldActionResult {
  const events: WorldEvent[] = [];
  let newWorld = world;

  switch (action.type) {
    case "accept_quest": {
      if (!action.questId) return { world, events: [], success: false, message: "No quest specified" };
      
      const quest = world.quests.get(action.questId);
      if (!quest) return { world, events: [], success: false, message: "Quest not found" };
      
      const startedQuest = QuestModule.startQuest(quest);
      newWorld = updateQuest(newWorld, startedQuest);
      
      events.push({
        type: "quest_started",
        questId: action.questId,
        entityId: action.entityId,
        description: `Quest accepted: ${quest.title}`,
        timestamp: Date.now(),
      });
      
      return { world: newWorld, events, success: true, message: `Accepted quest: ${quest.title}` };
    }

    case "complete_quest": {
      if (!action.questId) return { world, events: [], success: false, message: "No quest specified" };
      
      const quest = world.quests.get(action.questId);
      if (!quest) return { world, events: [], success: false, message: "Quest not found" };
      
      const completedQuest = QuestModule.completeQuest(quest);
      newWorld = updateQuest(newWorld, completedQuest);
      
      // Apply rewards
      const rewards = quest.rewards;
      const progression = world.playerProgression.get(action.entityId);
      if (progression && rewards.xp > 0) {
        const result = ProgressionModule.gainXp(
          progression,
          rewards.xp,
          "quest",
          `Completed: ${quest.title}`
        );
        newWorld = updatePlayerProgression(newWorld, result.progression);
        
        if (result.leveledUp) {
          events.push({
            type: "level_up",
            entityId: action.entityId,
            value: result.newLevel,
            description: `Level up! Now level ${result.newLevel}`,
            timestamp: Date.now(),
          });
        }
      }
      
      // Set story flags from rewards
      for (const flag of rewards.storyFlags ?? []) {
        newWorld = setFlag(newWorld, flag, true, `quest:${quest.id}`);
      }
      
      events.push({
        type: "quest_completed",
        questId: action.questId,
        entityId: action.entityId,
        description: `Quest completed: ${quest.title}`,
        timestamp: Date.now(),
      });
      
      return { world: newWorld, events, success: true, message: `Completed quest: ${quest.title}` };
    }

    case "gain_xp": {
      if (!action.xpAmount) return { world, events: [], success: false, message: "No XP amount" };
      
      const progression = world.playerProgression.get(action.entityId);
      if (!progression) return { world, events: [], success: false, message: "No progression found" };
      
      const result = ProgressionModule.gainXp(
        progression,
        action.xpAmount,
        action.xpSource ?? "combat",
        action.message ?? "Gained experience"
      );
      newWorld = updatePlayerProgression(newWorld, result.progression);
      
      events.push({
        type: "xp_gained",
        entityId: action.entityId,
        value: action.xpAmount,
        description: `Gained ${action.xpAmount} XP`,
        timestamp: Date.now(),
      });
      
      if (result.leveledUp) {
        events.push({
          type: "level_up",
          entityId: action.entityId,
          value: result.newLevel,
          description: `Level up! Now level ${result.newLevel}`,
          timestamp: Date.now(),
        });
      }
      
      return { world: newWorld, events, success: true, message: `Gained ${action.xpAmount} XP` };
    }

    case "talk": {
      if (!action.targetId) return { world, events: [], success: false, message: "No target" };
      
      const npc = world.npcs.get(action.targetId);
      if (!npc) return { world, events: [], success: false, message: "NPC not found" };
      
      // Add memory of conversation
      const updatedNPC = NPCModule.addMemory(
        npc,
        `Had conversation with player`,
        [action.entityId, "conversation"],
        1
      );
      newWorld = updateNPC(newWorld, updatedNPC);
      
      events.push({
        type: "npc_spoke",
        entityId: action.entityId,
        targetId: action.targetId,
        description: `Spoke with ${npc.name}`,
        timestamp: Date.now(),
      });
      
      // Update quest progress for talk objectives
      for (const [questId, quest] of world.quests) {
        if (quest.state === "active") {
          const result = QuestModule.processTalkEvent(quest, action.targetId);
          if (result.events.length > 0) {
            newWorld = updateQuest(newWorld, result.quest);
            events.push(...result.events);
          }
        }
      }
      
      return { world: newWorld, events, success: true, message: `Talked to ${npc.name}` };
    }

    case "discover_location": {
      if (!action.targetId) return { world, events: [], success: false, message: "No location" };
      
      const location = world.locations.get(action.targetId);
      if (!location) return { world, events: [], success: false, message: "Location not found" };
      
      const discoveredLocation = { ...location, discovered: true };
      newWorld = updateLocation(newWorld, discoveredLocation);
      
      // Grant discovery XP
      const progression = world.playerProgression.get(action.entityId);
      if (progression) {
        const xp = ProgressionModule.calculateDiscoveryXp(progression.level);
        const result = ProgressionModule.gainXp(
          progression,
          xp,
          "discovery",
          `Discovered: ${location.name}`
        );
        newWorld = updatePlayerProgression(newWorld, result.progression);
        
        events.push({
          type: "xp_gained",
          entityId: action.entityId,
          value: xp,
          description: `Gained ${xp} XP for discovery`,
          timestamp: Date.now(),
        });
        
        if (result.leveledUp) {
          events.push({
            type: "level_up",
            entityId: action.entityId,
            value: result.newLevel,
            description: `Level up! Now level ${result.newLevel}`,
            timestamp: Date.now(),
          });
        }
      }
      
      events.push({
        type: "location_discovered",
        entityId: action.entityId,
        targetId: action.targetId,
        description: `Discovered: ${location.name}`,
        timestamp: Date.now(),
      });
      
      return { world: newWorld, events, success: true, message: `Discovered ${location.name}` };
    }

    case "set_flag": {
      if (!action.flagId) return { world, events: [], success: false, message: "No flag ID" };
      
      newWorld = setFlag(newWorld, action.flagId, action.flagValue ?? true, action.entityId);
      
      events.push({
        type: "flag_set",
        entityId: action.entityId,
        description: `Flag set: ${action.flagId}`,
        timestamp: Date.now(),
      });
      
      return { world: newWorld, events, success: true, message: `Set flag: ${action.flagId}` };
    }

    default:
      return { world, events: [], success: false, message: `Unknown action: ${action.type}` };
  }
}

// ============= Time Management =============

export function advanceTime(world: WorldState, ticks: number = 1): WorldState {
  return { ...world, globalTime: world.globalTime + ticks };
}

export function tickAllQuests(world: WorldState): { world: WorldState; events: WorldEvent[] } {
  const events: WorldEvent[] = [];
  let newWorld = world;
  
  for (const [questId, quest] of world.quests) {
    if (quest.state === "active") {
      const result = QuestModule.tickQuestTime(quest);
      if (result.failed) {
        events.push({
          type: "quest_failed",
          questId,
          description: `Quest failed: ${quest.title} - Time expired!`,
          timestamp: Date.now(),
        });
      }
      newWorld = updateQuest(newWorld, result.quest);
    }
  }
  
  return { world: newWorld, events };
}

// ============= Query Helpers =============

export function getActiveQuests(world: WorldState): Quest[] {
  return Array.from(world.quests.values()).filter(q => q.state === "active");
}

export function getCompletedQuests(world: WorldState): Quest[] {
  return Array.from(world.quests.values()).filter(q => q.state === "completed");
}

export function getAvailableQuests(world: WorldState): Quest[] {
  const completed = new Set(
    Array.from(world.quests.values())
      .filter(q => q.state === "completed")
      .map(q => q.id)
  );
  
  return Array.from(world.quests.values()).filter(quest => 
    quest.state === "available" && 
    QuestModule.canStartQuest(quest, completed)
  );
}

export function getNPCsByFaction(world: WorldState, factionId: string): NPC[] {
  return Array.from(world.npcs.values()).filter(npc => npc.factionId === factionId);
}

export function getDiscoveredLocations(world: WorldState): Location[] {
  return Array.from(world.locations.values()).filter(loc => loc.discovered);
}

export function getNPCsAtLocation(world: WorldState, locationId: string): NPC[] {
  const location = world.locations.get(locationId);
  if (!location) return [];
  
  return location.npcs
    .map(npcId => world.npcs.get(npcId))
    .filter((npc): npc is NPC => npc !== undefined);
}

// ============= Serialization =============

export function serializeWorld(world: WorldState): string {
  return JSON.stringify({
    campaignSeed: world.campaignSeed,
    npcs: Array.from(world.npcs.entries()),
    quests: Array.from(world.quests.entries()),
    items: Array.from(world.items.entries()),
    locations: Array.from(world.locations.entries()),
    storyFlags: Array.from(world.storyFlags.entries()),
    globalTime: world.globalTime,
    playerProgression: Array.from(world.playerProgression.entries()),
  });
}

export function deserializeWorld(json: string): WorldState {
  const data = JSON.parse(json);
  const locations = normalizeLocationEntries(data.locations);
  return {
    campaignSeed: data.campaignSeed,
    npcs: new Map(data.npcs),
    quests: new Map(data.quests),
    items: new Map(data.items),
    locations: new Map(locations),
    storyFlags: new Map(data.storyFlags),
    globalTime: data.globalTime,
    playerProgression: new Map(data.playerProgression),
  };
}

function normalizeLocationEntries(locations: unknown): Array<[string, Location]> {
  if (!locations) {
    return [];
  }
  if (Array.isArray(locations)) {
    return locations as Array<[string, Location]>;
  }
  if (typeof locations === "object") {
    return Object.entries(locations as Record<string, Location>);
  }
  return [];
}
