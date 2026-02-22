export type ToneMode = "tactical" | "mythic" | "whimsical" | "brutal" | "minimalist";

export type SpellRarity = "common" | "magical" | "unique" | "legendary" | "mythic" | "unhinged";

export interface SpellStyleTags {
  element: string;
  mood: string;
  visual_signature: string;
  impact_verb: string;
}

export interface SpellPresentationMeta {
  spell_base: string;
  rank: number;
  rarity: SpellRarity;
  escalation_level: number;
}

export interface EnemyPersonalityTraits {
  aggression: number;
  discipline: number;
  intelligence: number;
  instinct_type: "pack" | "duelist" | "predator" | "ambush" | "guardian" | "chaotic";
}

export interface PresentationState {
  last_tone?: ToneMode | null;
  last_board_opener_id?: string | null;
  recent_line_hashes?: string[];
  last_verb_keys?: string[];
}

export interface CombatPresentationEvent {
  id?: string;
  turn_index?: number;
  event_type: string;
  actor_combatant_id?: string | null;
  payload?: Record<string, unknown>;
  created_at?: string;
}

export interface NarrativeMiddlewareResult {
  lines: string[];
  lineHashes: string[];
  verbKeys: string[];
}

export interface ToneSelectionInput {
  seedKey: string;
  lastTone: ToneMode | null;
  tension: number;
  bossPresent: boolean;
  playerHpPct: number;
  regionTheme: string;
}

export interface ToneSelectionResult {
  tone: ToneMode;
  reason: string;
}

export interface BoardNarrationInput {
  seedKey: string;
  boardType: "town" | "travel" | "dungeon" | "combat";
  hooks: string[];
  timePressure: string | null;
  factionTension: string | null;
  resourceWindow: string | null;
  regionName: string | null;
  lastOpenerId: string | null;
}

export interface BoardNarrationResult {
  openerId: string;
  text: string;
}

export interface ReputationInput {
  baseName: string;
  reputationScore: number;
  behaviorFlags: string[];
  notableKills: string[];
  factionStanding: Record<string, number>;
  seedKey: string;
}

export interface ReputationResult {
  tier: 1 | 2 | 3 | 4 | 5;
  displayName: string;
  title: string | null;
}
