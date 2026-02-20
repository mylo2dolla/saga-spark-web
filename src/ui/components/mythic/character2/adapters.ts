import type { MythicCombatantRow } from "@/hooks/useMythicCombatState";
import type { SkillAvailabilityEntry } from "@/lib/mythic/skillAvailability";
import type {
  MythicBoardType,
  MythicCharacterRow,
  MythicQuestThreadRow,
  MythicSkill,
} from "@/types/mythic";
import type {
  CharacterCompanionSummary,
  CharacterProfileDraft,
  CharacterSheetViewModel,
  CharacterSkillSummary,
  CharacterStatLens,
} from "@/ui/components/mythic/character2/types";

interface BuildCharacterSheetViewModelArgs {
  character: MythicCharacterRow;
  boardMode: MythicBoardType;
  coins: number;
  skills: MythicSkill[];
  questThreads: MythicQuestThreadRow[];
  companionNotes: CharacterCompanionSummary[];
  skillAvailability: SkillAvailabilityEntry[];
  combatants: MythicCombatantRow[];
  playerCombatantId: string | null;
  activeTurnCombatantId: string | null;
  focusedCombatantId: string | null;
  combatStatus: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const clean = value.trim();
  return clean.length > 0 ? clean : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statModifier(value: number): number {
  return Math.floor((value - 10) / 2);
}

function readProfileDraft(character: MythicCharacterRow): CharacterProfileDraft {
  const classJson = asRecord(character.class_json);
  const profile = asRecord(classJson.profile);
  return {
    name: asString(character.name, "Adventurer"),
    callsign: asString(profile.callsign),
    pronouns: asString(profile.pronouns),
    originNote: asString(profile.origin_note),
  };
}

function readResourceValue(
  resources: Record<string, unknown>,
  derived: Record<string, unknown>,
  keys: string[],
  fallback = 0,
): number {
  for (const key of keys) {
    if (key in resources) {
      const value = asNumber(resources[key], Number.NaN);
      if (Number.isFinite(value)) return value;
    }
    if (key in derived) {
      const value = asNumber(derived[key], Number.NaN);
      if (Number.isFinite(value)) return value;
    }
  }
  return fallback;
}

function toSkillSummary(skill: MythicSkill, availability: SkillAvailabilityEntry | null): CharacterSkillSummary {
  return {
    id: String(skill.id ?? skill.name),
    name: skill.name,
    kind: skill.kind,
    targeting: skill.targeting,
    rangeTiles: Math.max(0, Number(skill.range_tiles ?? 0)),
    cooldownTurns: Math.max(0, Number(skill.cooldown_turns ?? 0)),
    description: asString(skill.description),
    usableNow: availability ? availability.usableNow : true,
    reason: availability ? availability.reason : null,
  };
}

export function buildCharacterSheetViewModel(args: BuildCharacterSheetViewModelArgs): CharacterSheetViewModel {
  const classJson = asRecord(args.character.class_json);
  const resources = asRecord(args.character.resources);
  const derived = asRecord(args.character.derived_json);
  const profile = readProfileDraft(args.character);

  const availabilityBySkillId = new Map<string, SkillAvailabilityEntry>(
    args.skillAvailability.map((entry) => [entry.skillId, entry]),
  );

  const equippedFromAvailability = args.skillAvailability
    .map((entry) => args.skills.find((skill) => skill.id === entry.skillId))
    .filter((entry): entry is MythicSkill => Boolean(entry));

  const fallbackEquipped = args.skills.filter((skill) => skill.kind === "active" || skill.kind === "ultimate");
  const equippedSkills = (equippedFromAvailability.length > 0 ? equippedFromAvailability : fallbackEquipped)
    .map((skill) => toSkillSummary(skill, skill.id ? availabilityBySkillId.get(skill.id) ?? null : null))
    .slice(0, 12);

  const passiveSkills = args.skills
    .filter((skill) => skill.kind === "passive")
    .map((skill) => toSkillSummary(skill, null))
    .slice(0, 12);

  const playerCombatant = args.playerCombatantId
    ? args.combatants.find((entry) => entry.id === args.playerCombatantId) ?? null
    : null;
  const focusedCombatant = args.focusedCombatantId
    ? args.combatants.find((entry) => entry.id === args.focusedCombatantId) ?? null
    : null;
  const activeCombatant = args.activeTurnCombatantId
    ? args.combatants.find((entry) => entry.id === args.activeTurnCombatantId) ?? null
    : null;

  const hpCurrent = playerCombatant
    ? asNumber(playerCombatant.hp, 0)
    : readResourceValue(resources, derived, ["hp", "vitality", "health", "current_hp", "vitality_current"], 0);
  const hpMax = playerCombatant
    ? asNumber(playerCombatant.hp_max, 1)
    : readResourceValue(resources, derived, ["hp_max", "vitality_max", "health_max", "max_hp"], Math.max(1, hpCurrent));
  const mpCurrent = playerCombatant
    ? asNumber(playerCombatant.power, 0)
    : readResourceValue(resources, derived, ["mp", "power", "mana", "current_mp", "power_current"], 0);
  const mpMax = playerCombatant
    ? asNumber(playerCombatant.power_max, 1)
    : readResourceValue(resources, derived, ["mp_max", "power_max", "mana_max", "max_mp"], Math.max(1, mpCurrent));
  const armor = playerCombatant
    ? asNumber(playerCombatant.armor, 0)
    : readResourceValue(resources, derived, ["armor", "guard", "resist", "defense_rating"], 0);

  const allyCount = args.combatants.filter((entry) => typeof entry.player_id === "string" && entry.is_alive).length;
  const enemyCount = args.combatants.filter((entry) => entry.player_id === null && entry.is_alive).length;

  const playerTurnState: "your_turn" | "waiting" | "inactive" = !playerCombatant || args.combatStatus !== "active"
    ? "inactive"
    : args.activeTurnCombatantId === playerCombatant.id
      ? "your_turn"
      : "waiting";

  const playerTurnLabel = playerTurnState === "your_turn"
    ? "Your turn"
    : playerTurnState === "waiting"
      ? `Waiting on ${activeCombatant?.name ?? "enemy"}`
      : "Combat idle";

  const statLenses: CharacterStatLens[] = [
    {
      id: "offense",
      mythicLabel: "Offense",
      dndLabel: "STR Lens",
      value: Math.max(0, Math.floor(asNumber(args.character.offense, 0))),
      modifier: statModifier(Math.max(0, Math.floor(asNumber(args.character.offense, 0)))),
    },
    {
      id: "defense",
      mythicLabel: "Defense",
      dndLabel: "CON Lens",
      value: Math.max(0, Math.floor(asNumber(args.character.defense, 0))),
      modifier: statModifier(Math.max(0, Math.floor(asNumber(args.character.defense, 0)))),
    },
    {
      id: "mobility",
      mythicLabel: "Mobility",
      dndLabel: "DEX Lens",
      value: Math.max(0, Math.floor(asNumber(args.character.mobility, 0))),
      modifier: statModifier(Math.max(0, Math.floor(asNumber(args.character.mobility, 0)))),
    },
    {
      id: "control",
      mythicLabel: "Control",
      dndLabel: "INT Lens",
      value: Math.max(0, Math.floor(asNumber(args.character.control, 0))),
      modifier: statModifier(Math.max(0, Math.floor(asNumber(args.character.control, 0)))),
    },
    {
      id: "support",
      mythicLabel: "Support",
      dndLabel: "WIS Lens",
      value: Math.max(0, Math.floor(asNumber(args.character.support, 0))),
      modifier: statModifier(Math.max(0, Math.floor(asNumber(args.character.support, 0)))),
    },
    {
      id: "utility",
      mythicLabel: "Utility",
      dndLabel: "CHA Lens",
      value: Math.max(0, Math.floor(asNumber(args.character.utility, 0))),
      modifier: statModifier(Math.max(0, Math.floor(asNumber(args.character.utility, 0)))),
    },
  ];

  return {
    characterId: args.character.id,
    boardMode: args.boardMode,
    name: profile.name,
    className: asString(classJson.class_name, "Classless"),
    role: asString(classJson.role, "hybrid"),
    level: Math.max(1, Math.floor(asNumber(args.character.level, 1))),
    xp: Math.max(0, Math.floor(asNumber(args.character.xp, 0))),
    xpToNext: Math.max(0, Math.floor(asNumber(args.character.xp_to_next, 0))),
    unspentPoints: Math.max(0, Math.floor(asNumber(args.character.unspent_points, 0))),
    coins: Math.max(0, Math.floor(asNumber(args.coins, 0))),
    profile,
    hpGauge: {
      label: "HP",
      current: Math.max(0, Math.floor(hpCurrent)),
      max: Math.max(1, Math.floor(hpMax)),
      tone: "hp",
    },
    mpGauge: {
      label: "MP",
      current: Math.max(0, Math.floor(mpCurrent)),
      max: Math.max(1, Math.floor(mpMax)),
      tone: "mp",
    },
    combat: {
      status: asString(args.combatStatus, "idle"),
      playerTurnState,
      playerTurnLabel,
      allyCount,
      enemyCount,
      focusedTargetName: focusedCombatant?.name ?? null,
      armor: Math.max(0, Math.floor(armor)),
    },
    statLenses,
    equippedSkills,
    passiveSkills,
    companionNotes: args.companionNotes.slice(0, 20),
    questThreads: args.questThreads.slice(0, 40),
  };
}

export function buildCharacterProfilePatch(draft: CharacterProfileDraft): {
  name: string;
  callsign: string;
  pronouns: string;
  origin_note: string;
} {
  const cleanName = asString(draft.name, "Adventurer").slice(0, 80);
  return {
    name: cleanName,
    callsign: asString(draft.callsign).slice(0, 48),
    pronouns: asString(draft.pronouns).slice(0, 48),
    origin_note: asString(draft.originNote).slice(0, 220),
  };
}
