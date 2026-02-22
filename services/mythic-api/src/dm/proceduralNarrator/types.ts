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
export type ProceduralVoiceMode =
  | "tactical"
  | "brutal"
  | "mischievous"
  | "dark"
  | "whimsical"
  | "blessing"
  | "punishment"
  | "mythic"
  | "minimalist";

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
  activeHooks?: string[];
  factionTension?: string | null;
  playerHpPct?: number | null;
  enemyThreatLevel?: number | null;
  playerReputationTags?: string[];
  worldToneVector?: Record<string, number> | null;
  lineHistory?: string[];
  fragmentHistory?: string[];
  lineHistorySize?: number;
  similarityThreshold?: number;
  lastVoiceMode?: string | null;
}

export interface DmVoiceProfile {
  sarcasmLevel: number;
  crueltyLevel: number;
  humorLevel: number;
  verbosityLevel: number;
  mythicIntensity: number;
  absurdityLevel: number;
  favoritismBias: number;
  memoryRecallBias: number;
}

export interface DmNarrationContext {
  boardType: string;
  biome: string;
  activeHooks: string[];
  factionTension: string;
  playerHpPct: number;
  enemyThreatLevel: number;
  recentEvents: ProceduralNarrationEvent[];
  playerReputationTags: string[];
  worldToneVector: Record<string, number>;
  dmVoiceProfile: DmVoiceProfile;
}

export interface DmLineHistoryBuffer {
  maxLines: number;
  similarityThreshold: number;
  lines: string[];
  fragments: string[];
}

export interface ProceduralNarratorDebug {
  seed: string;
  rng_picks: number[];
  template_id: string;
  template_tags: string[];
  tone: ProceduralTone;
  voice_mode: ProceduralVoiceMode;
  voice_profile: DmVoiceProfile;
  biome: string;
  intensity: ProceduralIntensity;
  aside_used: boolean;
  event_count: number;
  event_ids: string[];
  event_types: ProceduralEventType[];
  mapped_events: ProceduralNarrationEvent[];
  line_history_before: string[];
  line_history_after: string[];
  fragment_history_after: string[];
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
