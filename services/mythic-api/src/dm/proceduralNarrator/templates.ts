import { articleFor, compactSentence, pluralize, thirdPerson } from "./grammar.js";
import type { ProceduralTemplate } from "./types.js";

export const PROCEDURAL_TEMPLATES: readonly ProceduralTemplate[] = [
  {
    id: "combat_hit_01",
    eventType: "COMBAT_ATTACK_RESOLVED",
    weight: 4,
    tags: ["combat", "grim", "high"],
    render: (vars) =>
      compactSentence(`${vars.actor} ${thirdPerson(vars.attackVerb)} ${vars.target} for ${Math.max(0, vars.amount ?? 0)}. ${vars.recoveryBeat}`),
  },
  {
    id: "combat_hit_02",
    eventType: "COMBAT_ATTACK_RESOLVED",
    weight: 3,
    tags: ["combat", "dark", "med"],
    render: (vars) =>
      compactSentence(`${vars.actor} drives ${articleFor(vars.flavorNoun)} ${vars.flavorNoun} into ${vars.target}. Pressure stays on: ${vars.actionSummary}`),
  },
  {
    id: "combat_hit_03",
    eventType: "COMBAT_ATTACK_RESOLVED",
    weight: 2,
    tags: ["combat", "heroic", "high"],
    render: (vars) =>
      compactSentence(`${vars.actor} lands the turn and rips momentum away from ${vars.target}. ${vars.recoveryBeat}`),
  },
  {
    id: "combat_status_01",
    eventType: "STATUS_TICK",
    weight: 3,
    tags: ["combat", "grim", "med"],
    render: (vars) =>
      compactSentence(`${vars.target} eats another tick of ${vars.status ?? "pressure"} while ${vars.actor} keeps the lane sealed.`),
  },
  {
    id: "combat_status_02",
    eventType: "STATUS_TICK",
    weight: 2,
    tags: ["combat", "dark", "high"],
    render: (vars) =>
      compactSentence(`${vars.status ?? "The effect"} keeps chewing through ${vars.target}. ${vars.recoveryBeat}`),
  },
  {
    id: "loot_drop_01",
    eventType: "LOOT_DROPPED",
    weight: 3,
    tags: ["loot", "mischievous", "med"],
    render: (vars) =>
      compactSentence(`The dust settles and a prize drops out of the noise. ${vars.boardAnchor} just paid up.`),
  },
  {
    id: "loot_drop_02",
    eventType: "LOOT_DROPPED",
    weight: 2,
    tags: ["loot", "heroic", "low"],
    render: (vars) =>
      compactSentence(`${vars.actor} pulls spoils from the wreckage. ${vars.summaryObjective ? `Objective: ${vars.summaryObjective}.` : vars.recoveryBeat}`),
  },
  {
    id: "travel_step_01",
    eventType: "TRAVEL_STEP",
    weight: 3,
    tags: ["travel", "tactical", "med"],
    render: (vars) =>
      compactSentence(`Boots hit the road and ${vars.motionVerb} toward ${vars.boardAnchor}. ${vars.recoveryBeat}`),
  },
  {
    id: "travel_step_02",
    eventType: "TRAVEL_STEP",
    weight: 2,
    tags: ["travel", "dark", "low"],
    render: (vars) =>
      compactSentence(`The route narrows. ${vars.summaryRumor ? `Rumor bite: ${vars.summaryRumor}.` : vars.boardNarration}`),
  },
  {
    id: "dungeon_enter_01",
    eventType: "DUNGEON_ROOM_ENTERED",
    weight: 3,
    tags: ["dungeon", "grim", "high"],
    render: (vars) =>
      compactSentence(`You cross the threshold and the room answers immediately. ${vars.actionSummary}`),
  },
  {
    id: "dungeon_enter_02",
    eventType: "DUNGEON_ROOM_ENTERED",
    weight: 2,
    tags: ["dungeon", "dark", "med"],
    render: (vars) =>
      compactSentence(`Stone, stale air, and one clean decision point: ${vars.recoveryBeat}`),
  },
  {
    id: "npc_dialogue_01",
    eventType: "NPC_DIALOGUE",
    weight: 3,
    tags: ["town", "comic", "low"],
    render: (vars) =>
      compactSentence(`A local cuts through the noise with a live lead. ${vars.summaryRumor ? vars.summaryRumor : vars.actionSummary}`),
  },
  {
    id: "npc_dialogue_02",
    eventType: "NPC_DIALOGUE",
    weight: 2,
    tags: ["town", "mischievous", "med"],
    render: (vars) =>
      compactSentence(`The conversation turns sharp, then useful. ${vars.summaryObjective ? vars.summaryObjective : vars.recoveryBeat}`),
  },
  {
    id: "level_up_01",
    eventType: "LEVEL_UP",
    weight: 2,
    tags: ["progression", "heroic", "med"],
    render: (vars) =>
      compactSentence(`Power spikes and the board notices. ${vars.actor} now has ${articleFor("edge")} edge to spend.`),
  },
  {
    id: "quest_update_01",
    eventType: "QUEST_UPDATE",
    weight: 3,
    tags: ["quest", "tactical", "med"],
    render: (vars) =>
      compactSentence(`Quest pressure updates in real time. ${vars.summaryObjective ? vars.summaryObjective : vars.actionSummary}`),
  },
  {
    id: "quest_update_02",
    eventType: "QUEST_UPDATE",
    weight: 2,
    tags: ["quest", "dark", "low"],
    render: (vars) =>
      compactSentence(`Threads tighten around ${vars.boardAnchor}. ${vars.summaryRumor ? vars.summaryRumor : vars.recoveryBeat}`),
  },
  {
    id: "board_transition_01",
    eventType: "BOARD_TRANSITION",
    weight: 2,
    tags: ["transition", "tactical", "low"],
    render: (vars) =>
      compactSentence(`State shifts cleanly. ${vars.actor} ${thirdPerson(vars.motionVerb)} into the next pressure window.`),
  },
];

export const ASIDE_LINES = [
  "The board keeps receipts.",
  "Bad odds are still odds.",
  "Someone upstairs is betting against you.",
  "The map never blinks first.",
  "Yes, this is the fun part.",
] as const;

export const ATTACK_VERBS = [
  "carve",
  "slam",
  "crack",
  "hammer",
  "gouge",
  "rupture",
  "detonate",
  "cleave",
] as const;

export const MOTION_VERBS = [
  "press",
  "angle",
  "drive",
  "cut",
  "slip",
  "pivot",
  "push",
] as const;

export const FLAVOR_NOUNS = [
  "shockwave",
  "gash",
  "hammerfall",
  "impact lane",
  "open seam",
  "kill angle",
] as const;

export const BIOME_HINTS: Record<string, string[]> = {
  forest: ["wet roots", "pine-dark cover", "mossed stone"],
  desert: ["blown grit", "sun-cut ridges", "dry thunder"],
  swamp: ["black water", "rot haze", "reed shadows"],
  arctic: ["frost crack", "ice glare", "white hush"],
  city: ["iron alleys", "chimney smoke", "market noise"],
  dungeon: ["cold masonry", "rust damp", "torch soot"],
  default: ["dust", "stone", "pressure"],
};

export function describeContextClue(biome: string, amount: number): string {
  const pool = BIOME_HINTS[biome] ?? BIOME_HINTS.default;
  if (!pool || pool.length === 0) return "pressure";
  const index = Math.max(0, amount % pool.length);
  return pool[index]!;
}

export function conciseCountLabel(label: string, count: number): string {
  return `${count} ${pluralize(label, count)}`;
}

