import type { MythicBoardType, MythicQuestThreadRow, MythicSkill } from "@/types/mythic";

export type CharacterSheetSection = "overview" | "combat" | "skills" | "equipment" | "party" | "quests";

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
  mpCost: number;
  rangeTiles: number;
  cooldownTurns: number;
  cooldownRemaining: number;
  description: string;
  usableNow: boolean;
  reason: string | null;
}

export interface CharacterCompanionSummary {
  id: string;
  companionId: string;
  name: string;
  archetype: string;
  voice: string;
  line: string;
  mood: string;
  urgency: string;
  hookType: string;
  turnIndex: number;
  stance: "aggressive" | "balanced" | "defensive";
  directive: "focus" | "protect" | "harry" | "hold";
  targetHint: string | null;
}

export interface CharacterEquipmentItemSummary {
  inventoryId: string;
  itemId: string;
  name: string;
  slot: string;
  rarity: string;
  quantity: number;
  equipped: boolean;
  statMods: Record<string, number>;
  deltaMods: Record<string, number>;
  grantedAbilities: string[];
}

export interface CharacterEquipmentSlotGroup {
  slot: string;
  equippedItems: CharacterEquipmentItemSummary[];
  backpackItems: CharacterEquipmentItemSummary[];
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
  combatSkills: CharacterSkillSummary[];
  passiveSkills: CharacterSkillSummary[];
  companionNotes: CharacterCompanionSummary[];
  equipmentSlots: CharacterEquipmentSlotGroup[];
  equipmentTotals: Record<string, number>;
  questThreads: MythicQuestThreadRow[];
}

export interface CharacterSheetSaveState {
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: number | null;
  error: string | null;
}
