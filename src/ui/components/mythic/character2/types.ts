import type { MythicBoardType, MythicQuestThreadRow, MythicSkill } from "@/types/mythic";

export type CharacterSheetSection = "overview" | "combat" | "skills" | "companions" | "quests";

export interface CharacterProfileDraft {
  name: string;
  callsign: string;
  pronouns: string;
  originNote: string;
}

export interface CharacterStatLens {
  id: "offense" | "defense" | "mobility" | "control" | "support" | "utility";
  mythicLabel: string;
  dndLabel: string;
  value: number;
  modifier: number;
}

export interface CharacterResourceGauge {
  label: string;
  current: number;
  max: number;
  tone: "hp" | "mp";
}

export interface CharacterSkillSummary {
  id: string;
  name: string;
  kind: MythicSkill["kind"];
  targeting: MythicSkill["targeting"];
  rangeTiles: number;
  cooldownTurns: number;
  description: string;
  usableNow: boolean;
  reason: string | null;
}

export interface CharacterCompanionSummary {
  id: string;
  companionId: string;
  line: string;
  mood: string;
  urgency: string;
  hookType: string;
  turnIndex: number;
}

export interface CharacterCombatSummary {
  status: string;
  playerTurnState: "your_turn" | "waiting" | "inactive";
  playerTurnLabel: string;
  allyCount: number;
  enemyCount: number;
  focusedTargetName: string | null;
  armor: number;
}

export interface CharacterSheetViewModel {
  characterId: string;
  boardMode: MythicBoardType;
  name: string;
  className: string;
  role: string;
  level: number;
  xp: number;
  xpToNext: number;
  unspentPoints: number;
  coins: number;
  profile: CharacterProfileDraft;
  hpGauge: CharacterResourceGauge;
  mpGauge: CharacterResourceGauge;
  combat: CharacterCombatSummary;
  statLenses: CharacterStatLens[];
  equippedSkills: CharacterSkillSummary[];
  passiveSkills: CharacterSkillSummary[];
  companionNotes: CharacterCompanionSummary[];
  questThreads: MythicQuestThreadRow[];
}

export interface CharacterSheetSaveState {
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: number | null;
  error: string | null;
}
