export type ProceduralEventType =
  | "COMBAT_ATTACK_RESOLVED"
  | "LOOT_DROPPED"
  | "TRAVEL_STEP"
  | "DUNGEON_ROOM_ENTERED"
  | "NPC_DIALOGUE"
  | "LEVEL_UP"
  | "STATUS_TICK"
  | "QUEST_UPDATE"
  | "BOARD_TRANSITION";

export type ProceduralTone = "dark" | "comic" | "heroic" | "grim" | "mischievous" | "tactical";
export type ProceduralIntensity = "low" | "med" | "high";

export interface ProceduralNarrationEvent {
  type: ProceduralEventType;
  ts: number;
  seed: string;
  id: string;
  context: Record<string, unknown>;
}

export interface ProceduralNarratorInput {
  campaignSeed: string;
  sessionId: string;
  eventId: string;
  boardType: string;
  biome: string | null;
  tone: string;
  intensity: string;
  actionSummary: string;
  recoveryBeat: string;
  boardAnchor: string;
  summaryObjective: string | null;
  summaryRumor: string | null;
  boardNarration: string;
  introOpening: boolean;
  suppressNarrationOnError: boolean;
  executionError: string | null;
  stateChanges: string[];
  events: Array<Record<string, unknown>>;
}

export interface ProceduralNarratorDebug {
  seed: string;
  rng_picks: number[];
  template_id: string;
  template_tags: string[];
  tone: ProceduralTone;
  biome: string;
  intensity: ProceduralIntensity;
  aside_used: boolean;
  event_count: number;
  event_ids: string[];
  event_types: ProceduralEventType[];
  mapped_events: ProceduralNarrationEvent[];
}

export interface ProceduralNarratorResult {
  text: string;
  templateId: string;
  templateIds: string[];
  debug: ProceduralNarratorDebug;
}

export interface ProceduralTemplateRenderContext {
  event: ProceduralNarrationEvent;
  actor: string;
  target: string;
  amount: number | null;
  status: string | null;
  actionSummary: string;
  boardAnchor: string;
  objective: string | null;
  rumor: string | null;
  recoveryBeat: string;
  boardNarration: string;
  attackVerb: string;
  motionVerb: string;
  flavorNoun: string;
}

export interface ProceduralTemplate {
  id: string;
  eventType: ProceduralEventType;
  weight: number;
  tags: string[];
  render: (vars: ProceduralTemplateRenderContext) => string;
}
