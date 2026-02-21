import type { MythicCombatantRow } from "@/hooks/useMythicCombatState";
import type { SkillAvailabilityEntry } from "@/lib/mythic/skillAvailability";
import { getGrantedAbilities, splitInventory, sumStatMods, type MythicInventoryRow } from "@/lib/mythicEquipment";
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
  inventoryRows: MythicInventoryRow[];
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
  const costRecord = asRecord(skill.cost_json);
  const mpCost = Math.max(
    0,
    Math.floor(
      asNumber(costRecord.mp, Number.NaN)
      || asNumber(costRecord.power, Number.NaN)
      || asNumber(costRecord.amount, 0),
    ),
  );
  return {
    id: String(skill.id ?? skill.name),
    name: skill.name,
    kind: skill.kind,
    targeting: skill.targeting,
    mpCost,
    rangeTiles: Math.max(0, Number(skill.range_tiles ?? 0)),
    cooldownTurns: Math.max(0, Number(skill.cooldown_turns ?? 0)),
    cooldownRemaining: Math.max(0, Math.floor(availability?.cooldownRemaining ?? 0)),
    description: asString(skill.description),
    usableNow: availability ? availability.usableNow : true,
    reason: availability ? availability.reason : null,
  };
}

function readStatMods(value: unknown): Record<string, number> {
  const raw = asRecord(value);
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(raw)) {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed)) continue;
    out[key] = Math.floor(parsed);
  }
  return out;
}

function deltaMods(
  itemMods: Record<string, number>,
  baselineMods: Record<string, number>,
): Record<string, number> {
  const keys = new Set([...Object.keys(itemMods), ...Object.keys(baselineMods)]);
  const out: Record<string, number> = {};
  keys.forEach((key) => {
    const delta = Math.floor((itemMods[key] ?? 0) - (baselineMods[key] ?? 0));
    if (delta === 0) return;
    out[key] = delta;
  });
  return out;
}

export function buildCharacterSheetViewModel(args: BuildCharacterSheetViewModelArgs): CharacterSheetViewModel {
  const classJson = asRecord(args.character.class_json);
  const resources = asRecord(args.character.resources);
  const derived = asRecord(args.character.derived_json);
  const profile = readProfileDraft(args.character);

  const availabilityBySkillId = new Map<string, SkillAvailabilityEntry>(
    args.skillAvailability.map((entry) => [entry.skillId, entry]),
  );

  const combatSkills = args.skills
    .filter((skill) => skill.kind === "active" || skill.kind === "ultimate")
    .map((skill) => toSkillSummary(skill, skill.id ? availabilityBySkillId.get(skill.id) ?? null : null))
    .slice(0, 24);

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

  const { equipment, backpack } = splitInventory(args.inventoryRows);
  const equipmentTotals = sumStatMods(equipment.map((entry) => entry.item));
  const equippedTotalsBySlot = new Map<string, Record<string, number>>();
  for (const row of equipment) {
    if (!row.item) continue;
    const slot = asString(row.item.slot || row.equip_slot, "other").toLowerCase();
    const current = equippedTotalsBySlot.get(slot) ?? {};
    const next: Record<string, number> = { ...current };
    const mods = readStatMods(row.item.stat_mods);
    Object.entries(mods).forEach(([key, value]) => {
      next[key] = Math.floor((next[key] ?? 0) + value);
    });
    equippedTotalsBySlot.set(slot, next);
  }

  const bySlot = new Map<string, { equippedItems: CharacterSheetViewModel["equipmentSlots"][number]["equippedItems"]; backpackItems: CharacterSheetViewModel["equipmentSlots"][number]["backpackItems"] }>();
  const upsertSlot = (slot: string) => {
    const normalized = slot.trim().toLowerCase() || "other";
    const current = bySlot.get(normalized);
    if (current) return current;
    const created = { equippedItems: [], backpackItems: [] };
    bySlot.set(normalized, created);
    return created;
  };
  const pushInventoryRow = (row: MythicInventoryRow, equipped: boolean) => {
    if (!row.item) return;
    const slot = asString(row.item.slot || row.equip_slot, "other");
    const target = upsertSlot(slot);
    const itemMods = readStatMods(row.item.stat_mods);
    const baseline = equipped ? {} : (equippedTotalsBySlot.get(slot.toLowerCase()) ?? {});
    const item = {
      inventoryId: row.id,
      itemId: row.item.id,
      name: asString(row.item.name, "Unnamed Item"),
      slot,
      rarity: asString(row.item.rarity, "common"),
      quantity: Math.max(1, Math.floor(row.quantity ?? 1)),
      equipped,
      statMods: itemMods,
      deltaMods: deltaMods(itemMods, baseline),
      grantedAbilities: getGrantedAbilities(row.item),
    };
    if (equipped) {
      target.equippedItems.push(item);
    } else {
      target.backpackItems.push(item);
    }
  };
  equipment.forEach((row) => pushInventoryRow(row, true));
  backpack.forEach((row) => pushInventoryRow(row, false));
  const equipmentSlots = Array.from(bySlot.entries())
    .map(([slot, value]) => ({ slot, ...value }))
    .sort((a, b) => a.slot.localeCompare(b.slot));

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
    combatSkills,
    passiveSkills,
    companionNotes: args.companionNotes.slice(0, 20),
    equipmentSlots,
    equipmentTotals: Object.fromEntries(
      Object.entries(equipmentTotals)
        .map(([key, value]) => [key, Math.floor(Number(value ?? 0))] as const)
        .filter(([, value]) => Number.isFinite(value) && value !== 0),
    ),
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
