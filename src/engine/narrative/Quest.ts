/**
 * Quest system with objectives, progress tracking, and dynamic generation.
 * Pure functions only - no mutations.
 */

import type {
  Quest,
  QuestState,
  QuestObjective,
  QuestReward,
  ObjectiveType,
  CampaignSeed,
  NPC,
  WorldEvent,
} from "./types";
import type { Vec2 } from "../types";

// ============= Quest Factory =============

let questIdCounter = 0;

export function createQuest(params: {
  id?: string;
  title: string;
  description: string;
  briefDescription?: string;
  giverId: string;
  objectives: Omit<QuestObjective, "current">[];
  rewards: QuestReward;
  failureConsequences?: QuestReward;
  timeLimit?: number;
  prerequisites?: string[];
  conflictsWith?: string[];
  storyArc?: string;
  importance?: "side" | "main" | "legendary";
}): Quest {
  return {
    id: params.id ?? `quest_${++questIdCounter}`,
    title: params.title,
    description: params.description,
    briefDescription: params.briefDescription ?? params.title,
    giverId: params.giverId,
    state: "available",
    objectives: params.objectives.map(obj => ({ ...obj, current: 0 })),
    rewards: params.rewards,
    failureConsequences: params.failureConsequences,
    timeLimit: params.timeLimit,
    turnsElapsed: 0,
    prerequisites: params.prerequisites ?? [],
    conflictsWith: params.conflictsWith ?? [],
    storyArc: params.storyArc,
    importance: params.importance ?? "side",
  };
}

// ============= Quest State Management =============

export function startQuest(quest: Quest): Quest {
  if (quest.state !== "available") return quest;
  return { ...quest, state: "active" };
}

export function completeQuest(quest: Quest): Quest {
  if (quest.state !== "active") return quest;
  return { ...quest, state: "completed" };
}

export function failQuest(quest: Quest): Quest {
  if (quest.state !== "active") return quest;
  return { ...quest, state: "failed" };
}

export function abandonQuest(quest: Quest): Quest {
  if (quest.state !== "active") return quest;
  return { ...quest, state: "abandoned" };
}

// ============= Objective Progress =============

export function updateObjective(
  quest: Quest,
  objectiveId: string,
  progressDelta: number
): { quest: Quest; completed: boolean; objectiveCompleted: boolean } {
  if (quest.state !== "active") {
    return { quest, completed: false, objectiveCompleted: false };
  }

  let objectiveCompleted = false;
  const newObjectives = quest.objectives.map(obj => {
    if (obj.id === objectiveId) {
      const newCurrent = Math.min(obj.required, obj.current + progressDelta);
      if (newCurrent >= obj.required && obj.current < obj.required) {
        objectiveCompleted = true;
      }
      return { ...obj, current: newCurrent };
    }
    return obj;
  });

  const allComplete = newObjectives
    .filter(obj => !obj.optional)
    .every(obj => obj.current >= obj.required);

  const newQuest = { ...quest, objectives: newObjectives };

  if (allComplete) {
    return { quest: completeQuest(newQuest), completed: true, objectiveCompleted };
  }

  return { quest: newQuest, completed: false, objectiveCompleted };
}

export function setObjectiveProgress(
  quest: Quest,
  objectiveId: string,
  current: number
): Quest {
  const newObjectives = quest.objectives.map(obj =>
    obj.id === objectiveId ? { ...obj, current: Math.min(obj.required, current) } : obj
  );
  return { ...quest, objectives: newObjectives };
}

export function revealHiddenObjective(quest: Quest, objectiveId: string): Quest {
  const newObjectives = quest.objectives.map(obj =>
    obj.id === objectiveId ? { ...obj, hidden: false } : obj
  );
  return { ...quest, objectives: newObjectives };
}

// ============= Quest Queries =============

export function isQuestComplete(quest: Quest): boolean {
  return quest.objectives
    .filter(obj => !obj.optional)
    .every(obj => obj.current >= obj.required);
}

export function getActiveObjectives(quest: Quest): readonly QuestObjective[] {
  return quest.objectives.filter(obj => !obj.hidden && obj.current < obj.required);
}

export function getProgress(quest: Quest): number {
  const required = quest.objectives.filter(obj => !obj.optional);
  if (required.length === 0) return 100;
  
  const total = required.reduce((sum, obj) => sum + obj.required, 0);
  const current = required.reduce((sum, obj) => sum + obj.current, 0);
  return Math.round((current / total) * 100);
}

export function canStartQuest(
  quest: Quest,
  completedQuests: Set<string>
): boolean {
  if (quest.state !== "available") return false;
  return quest.prerequisites.every(prereq => completedQuests.has(prereq));
}

// ============= Time Management =============

export function tickQuestTime(quest: Quest): { quest: Quest; failed: boolean } {
  if (quest.state !== "active" || !quest.timeLimit) {
    return { quest, failed: false };
  }

  const newTurnsElapsed = quest.turnsElapsed + 1;
  
  if (newTurnsElapsed >= quest.timeLimit) {
    return { quest: failQuest({ ...quest, turnsElapsed: newTurnsElapsed }), failed: true };
  }

  return { quest: { ...quest, turnsElapsed: newTurnsElapsed }, failed: false };
}

export function getRemainingTime(quest: Quest): number | null {
  if (!quest.timeLimit) return null;
  return Math.max(0, quest.timeLimit - quest.turnsElapsed);
}

// ============= Event Processing =============

export interface QuestUpdateResult {
  quest: Quest;
  events: WorldEvent[];
  completed: boolean;
  failed: boolean;
}

export function processKillEvent(
  quest: Quest,
  targetId: string,
  targetType: string
): QuestUpdateResult {
  const events: WorldEvent[] = [];
  let updated = quest;
  let anyCompleted = false;

  for (const obj of quest.objectives) {
    if (obj.type === "kill" && obj.targetId === targetId) {
      const result = updateObjective(updated, obj.id, 1);
      updated = result.quest;
      if (result.objectiveCompleted) {
        events.push({
          type: "quest_updated",
          questId: quest.id,
          description: `Objective complete: ${obj.description}`,
          timestamp: Date.now(),
        });
      }
      anyCompleted = anyCompleted || result.completed;
    }
    if (obj.type === "kill_type" && obj.targetType === targetType) {
      const result = updateObjective(updated, obj.id, 1);
      updated = result.quest;
      if (result.objectiveCompleted) {
        events.push({
          type: "quest_updated",
          questId: quest.id,
          description: `Objective complete: ${obj.description}`,
          timestamp: Date.now(),
        });
      }
      anyCompleted = anyCompleted || result.completed;
    }
  }

  if (anyCompleted) {
    events.push({
      type: "quest_completed",
      questId: quest.id,
      description: `Quest complete: ${quest.title}`,
      timestamp: Date.now(),
    });
  }

  return { quest: updated, events, completed: anyCompleted, failed: false };
}

export function processCollectEvent(
  quest: Quest,
  itemId: string
): QuestUpdateResult {
  const events: WorldEvent[] = [];
  let updated = quest;
  let anyCompleted = false;

  for (const obj of quest.objectives) {
    if (obj.type === "collect" && obj.targetId === itemId) {
      const result = updateObjective(updated, obj.id, 1);
      updated = result.quest;
      if (result.objectiveCompleted) {
        events.push({
          type: "quest_updated",
          questId: quest.id,
          description: `Item collected: ${obj.description}`,
          timestamp: Date.now(),
        });
      }
      anyCompleted = anyCompleted || result.completed;
    }
  }

  if (anyCompleted) {
    events.push({
      type: "quest_completed",
      questId: quest.id,
      description: `Quest complete: ${quest.title}`,
      timestamp: Date.now(),
    });
  }

  return { quest: updated, events, completed: anyCompleted, failed: false };
}

export function processTalkEvent(
  quest: Quest,
  npcId: string
): QuestUpdateResult {
  const events: WorldEvent[] = [];
  let updated = quest;
  let anyCompleted = false;

  for (const obj of quest.objectives) {
    if (obj.type === "talk" && obj.targetId === npcId) {
      const result = updateObjective(updated, obj.id, 1);
      updated = result.quest;
      if (result.objectiveCompleted) {
        events.push({
          type: "quest_updated",
          questId: quest.id,
          description: `Spoke with target: ${obj.description}`,
          timestamp: Date.now(),
        });
      }
      anyCompleted = anyCompleted || result.completed;
    }
  }

  if (anyCompleted) {
    events.push({
      type: "quest_completed",
      questId: quest.id,
      description: `Quest complete: ${quest.title}`,
      timestamp: Date.now(),
    });
  }

  return { quest: updated, events, completed: anyCompleted, failed: false };
}

export function processExploreEvent(
  quest: Quest,
  position: Vec2,
  locationId: string
): QuestUpdateResult {
  const events: WorldEvent[] = [];
  let updated = quest;
  let anyCompleted = false;

  for (const obj of quest.objectives) {
    if (obj.type === "explore" && obj.targetId === locationId) {
      const result = updateObjective(updated, obj.id, 1);
      updated = result.quest;
      if (result.objectiveCompleted) {
        events.push({
          type: "quest_updated",
          questId: quest.id,
          description: `Location discovered: ${obj.description}`,
          timestamp: Date.now(),
        });
      }
      anyCompleted = anyCompleted || result.completed;
    }
  }

  if (anyCompleted) {
    events.push({
      type: "quest_completed",
      questId: quest.id,
      description: `Quest complete: ${quest.title}`,
      timestamp: Date.now(),
    });
  }

  return { quest: updated, events, completed: anyCompleted, failed: false };
}

// ============= Quest Generation Templates =============

export function createKillQuest(
  giverId: string,
  targetType: string,
  count: number,
  xpReward: number,
  goldReward: number
): Quest {
  return createQuest({
    title: `Slay ${count} ${targetType}${count > 1 ? "s" : ""}`,
    description: `The threat of ${targetType}s grows. Eliminate ${count} of them to restore peace.`,
    giverId,
    objectives: [{
      id: "kill_targets",
      type: "kill_type",
      description: `Kill ${count} ${targetType}${count > 1 ? "s" : ""}`,
      targetType,
      required: count,
      optional: false,
      hidden: false,
    }],
    rewards: {
      xp: xpReward,
      gold: goldReward,
      items: [],
    },
    importance: "side",
  });
}

export function createFetchQuest(
  giverId: string,
  itemId: string,
  itemName: string,
  count: number,
  xpReward: number,
  goldReward: number
): Quest {
  return createQuest({
    title: `Retrieve ${itemName}`,
    description: `${count > 1 ? `${count} ${itemName}s are` : `The ${itemName} is`} needed. Find and return ${count > 1 ? "them" : "it"}.`,
    giverId,
    objectives: [{
      id: "collect_items",
      type: "collect",
      description: `Collect ${count} ${itemName}${count > 1 ? "s" : ""}`,
      targetId: itemId,
      required: count,
      optional: false,
      hidden: false,
    }, {
      id: "return_to_giver",
      type: "talk",
      description: "Return to the quest giver",
      targetId: giverId,
      required: 1,
      optional: false,
      hidden: false,
    }],
    rewards: {
      xp: xpReward,
      gold: goldReward,
      items: [],
    },
    importance: "side",
  });
}

export function createEscortQuest(
  giverId: string,
  escorteeId: string,
  escorteeName: string,
  destinationId: string,
  destinationName: string,
  xpReward: number,
  goldReward: number
): Quest {
  return createQuest({
    title: `Escort ${escorteeName}`,
    description: `${escorteeName} needs safe passage to ${destinationName}. Protect them on the journey.`,
    giverId,
    objectives: [{
      id: "reach_destination",
      type: "escort",
      description: `Escort ${escorteeName} to ${destinationName}`,
      targetId: destinationId,
      required: 1,
      optional: false,
      hidden: false,
    }, {
      id: "protect_target",
      type: "protect",
      description: `Keep ${escorteeName} alive`,
      targetId: escorteeId,
      required: 1,
      optional: false,
      hidden: false,
    }],
    rewards: {
      xp: xpReward,
      gold: goldReward,
      items: [],
    },
    failureConsequences: {
      xp: 0,
      gold: 0,
      items: [],
      reputation: [{ factionId: "quest_giver_faction", change: -20 }],
    },
    importance: "side",
  });
}
