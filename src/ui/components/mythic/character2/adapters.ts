import type { MythicCombatantRow } from "@/hooks/useMythicCombatState";
import type { SkillAvailabilityEntry } from "@/lib/mythic/skillAvailability";
import { getGrantedAbilities, splitInventory, sumStatMods, type MythicInventoryRow } from "@/lib/mythicEquipment";
import {
  autoSortInventory,
  buildCharacterSheetView,
  type Actor,
  type ActiveStatus,
  type EquipmentSlot,
  type Item,
  type Resistances,
  type Skill as RuleSkill,
} from "@/rules";
import { baseStatsFromMythicLens } from "@/rules/stats";
import type {
  MythicBoardType,
  MythicCharacterRow,
  MythicQuestThreadRow,
  MythicSkill,
} from "@/types/mythic";
import type {
  CharacterCompanionSummary,
  CharacterProfileDraft,
  CharacterCombatRewardSummary,
  CharacterSheetViewModel,
  CharacterSkillSummary,
  CharacterStatLens,
} from "@/ui/components/mythic/character2/types";

interface BuildCharacterSheetViewModelArgs {
  character: MythicCharacterRow;
  boardMode: MythicBoardType;
  coins: number;
  currentTurnIndex?: number;
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
  rewardSummary?: CharacterCombatRewardSummary | null;
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

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean.length > 0 ? clean : null;
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

function parseSkillRank(skill: MythicSkill): { rank: number; maxRank: number } {
  const scaling = asRecord(skill.scaling_json);
  const presentation = asRecord(asRecord(skill.effects_json).presentation);
  const rank = Math.max(1, Math.floor(
    asNumber(scaling.rank, Number.NaN)
    || asNumber(presentation.rank, Number.NaN)
    || 1,
  ));
  const maxRank = Math.max(rank, Math.floor(
    asNumber(scaling.max_rank, Number.NaN)
    || asNumber(presentation.max_rank, Number.NaN)
    || 5,
  ));
  return { rank, maxRank };
}

function normalizeElement(value: unknown): RuleSkill["element"] {
  const lower = asString(value, "physical").toLowerCase();
  if (
    lower === "physical"
    || lower === "fire"
    || lower === "ice"
    || lower === "lightning"
    || lower === "poison"
    || lower === "bleed"
    || lower === "stun"
    || lower === "holy"
    || lower === "shadow"
    || lower === "arcane"
    || lower === "wind"
    || lower === "earth"
    || lower === "water"
  ) {
    return lower;
  }
  return "physical";
}

function normalizeTargeting(value: MythicSkill["targeting"], targetingJson: Record<string, unknown>): RuleSkill["targeting"] {
  const shape = asString(targetingJson.shape).toLowerCase();
  if (shape === "self" || shape === "single" || shape === "tile" || shape === "area" || shape === "cone" || shape === "line") {
    return shape;
  }
  if (value === "self" || value === "single" || value === "tile" || value === "area") {
    return value;
  }
  return "single";
}

function parseSkillTags(skill: MythicSkill): RuleSkill["tags"] {
  const effects = asRecord(skill.effects_json);
  const rawTags = Array.isArray(effects.tags) ? effects.tags : [];
  const tags = rawTags
    .map((entry) => asString(entry).toLowerCase())
    .filter((entry): entry is RuleSkill["tags"][number] => (
      entry === "projectile"
      || entry === "melee"
      || entry === "aoe"
      || entry === "dot"
      || entry === "heal"
      || entry === "shield"
      || entry === "summon"
    ));
  return tags;
}

function parseStatusApply(skill: MythicSkill): RuleSkill["statusApply"] {
  const status = asRecord(asRecord(skill.effects_json).status);
  const id = asString(status.id);
  if (!id) return undefined;
  const durationTurns = Math.max(1, Math.floor(asNumber(status.duration_turns, 1)));
  const category = id.includes("burn") || id.includes("poison") || id.includes("bleed")
    ? "dot"
    : id.includes("regen") || id.includes("mend")
      ? "hot"
      : id.includes("stun") || id.includes("root")
        ? "control"
        : "debuff";
  return {
    id,
    name: id.replace(/_/g, " "),
    category,
    durationTurns,
    tickRate: 1,
    stacking: "refresh",
    maxStacks: 3,
    intensityCap: 5,
    tickFormula: {
      element: normalizeElement(status.element ?? "poison"),
      baseTick: Math.max(0, asNumber(status.base_tick, 0)),
      dotScale: Math.max(0, asNumber(status.dot_scale, 0.3)),
      hotScale: Math.max(0, asNumber(status.hot_scale, 0.3)),
      rankTick: Math.max(0, asNumber(status.rank_tick, 2)),
      usesHealBonus: true,
    },
    statMods: { flat: {}, pct: {} },
    immunitiesGranted: [],
    dispellable: true,
    cleanseTags: [],
    metadata: {},
  };
}

function mythicSkillToRuleSkill(skill: MythicSkill): RuleSkill {
  const cost = asRecord(skill.cost_json);
  const effects = asRecord(skill.effects_json);
  const damage = asRecord(effects.damage);
  const scaling = asRecord(skill.scaling_json);
  const targetingJson = asRecord(skill.targeting_json);
  const bonus = asRecord(effects.bonus);
  const { rank, maxRank } = parseSkillRank(skill);

  const mpCostBase = Math.max(0, asNumber(cost.amount, Number.NaN) || asNumber(cost.mp, Number.NaN) || asNumber(cost.power, 0));
  const mpCostScale = asNumber(cost.rank_scale, Number.NaN) || asNumber(scaling.mp_cost_scale, 0);
  const mpLevelScale = asNumber(cost.level_scale, Number.NaN) || asNumber(scaling.mp_level_scale, 0.08);

  const basePower = Math.max(0, asNumber(damage.amount, Number.NaN) || asNumber(damage.base, Number.NaN) || asNumber(asRecord(effects.heal).amount, 0));
  const powerScale = asNumber(scaling.power_scale, Number.NaN) || asNumber(damage.rank_scale, 0);
  const levelScale = asNumber(scaling.level_scale, 0.45);

  return {
    id: asString(skill.id, skill.name),
    name: skill.name,
    element: normalizeElement(effects.element),
    tags: parseSkillTags(skill),
    targeting: normalizeTargeting(skill.targeting, targetingJson),
    rank,
    maxRank,
    mpCostBase,
    mpCostScale,
    mpLevelScale,
    basePower,
    powerScale,
    levelScale,
    hitBonus: asNumber(effects.hit_bonus, 0),
    critBonus: asNumber(bonus.crit_chance_add, 0),
    statusApply: parseStatusApply(skill),
    formulaOverrideId: null,
    description: asString(skill.description),
  };
}

function toRuleRarity(value: string): Item["rarity"] {
  const lower = value.toLowerCase();
  if (lower === "common") return "common";
  if (lower === "uncommon" || lower === "magical") return "uncommon";
  if (lower === "rare" || lower === "unique") return "rare";
  if (lower === "epic" || lower === "legendary") return "epic";
  if (lower === "mythic" || lower === "unhinged") return "mythic";
  return "common";
}

function toRuleSlot(rawSlot: string, accessoryIndexRef: { value: number }): EquipmentSlot {
  const slot = rawSlot.toLowerCase();
  if (slot.includes("weapon")) return "weapon";
  if (slot.includes("offhand") || slot.includes("shield") || slot.includes("focus")) return "offhand";
  if (slot.includes("head") || slot.includes("helm")) return "head";
  if (slot.includes("chest") || slot.includes("armor") || slot.includes("body")) return "chest";
  if (slot.includes("legs") || slot.includes("boots") || slot.includes("gloves") || slot.includes("belt")) return "legs";
  if (accessoryIndexRef.value <= 0) {
    accessoryIndexRef.value = 1;
    return "accessory1";
  }
  return "accessory2";
}

function mythicItemToRuleItem(row: MythicInventoryRow, accessoryIndexRef: { value: number }): Item | null {
  if (!row.item) return null;
  const item = row.item;
  const slot = toRuleSlot(asString(item.slot || row.equip_slot, "accessory1"), accessoryIndexRef);
  const flat: Record<string, number> = {};
  for (const [key, value] of Object.entries(asRecord(item.stat_mods))) {
    const n = asNumber(value, Number.NaN);
    if (!Number.isFinite(n)) continue;
    flat[key] = Math.floor(n);
  }
  const buy = Math.max(1, Math.floor(
    asNumber(asRecord(item.effects_json).purchase && asRecord(asRecord(item.effects_json).purchase).price, Number.NaN)
    || asNumber((item as unknown as Record<string, unknown>).item_power, Number.NaN)
    || 40,
  ));
  return {
    id: item.id,
    name: asString(item.name, "Unnamed Item"),
    slot,
    rarity: toRuleRarity(asString(item.rarity, "common")),
    levelReq: Math.max(1, Math.floor(asNumber((item as unknown as Record<string, unknown>).required_level, 1))),
    statsFlat: flat,
    statsPct: {},
    affixes: [],
    classTags: [],
    setTag: null,
    icon: null,
    valueBuy: buy,
    valueSell: Math.max(1, Math.floor(buy * 0.25)),
    favorite: Boolean((item as unknown as Record<string, unknown>).favorite),
    locked: Boolean((item as unknown as Record<string, unknown>).locked),
  };
}

function parseCombatStatuses(rawStatuses: unknown, currentTurnIndex: number): ActiveStatus[] {
  const list = Array.isArray(rawStatuses) ? rawStatuses : [];
  return list
    .map((entry) => (entry && typeof entry === "object" ? entry as Record<string, unknown> : null))
    .filter(Boolean)
    .map((entry) => {
      const id = asString(entry!.id, "status");
      const expires = Math.floor(asNumber(entry!.expires_turn, currentTurnIndex + 1));
      const remainingTurns = Math.max(0, expires - currentTurnIndex);
      const stacks = Math.max(1, Math.floor(asNumber(entry!.stacks, 1)));
      const data = asRecord(entry!.data);
      const category = id.includes("burn") || id.includes("poison") || id.includes("bleed")
        ? "dot"
        : id.includes("regen") || id.includes("heal")
          ? "hot"
          : id.includes("stun") || id.includes("root")
            ? "control"
            : id.includes("guard") || id.includes("barrier") || id.includes("haste")
              ? "buff"
              : "debuff";
      return {
        id,
        sourceActorId: asNullableString(data.source_actor_id),
        sourceSkillId: asNullableString(data.source_skill_id),
        category,
        remainingTurns,
        nextTickTurn: currentTurnIndex + 1,
        stacks,
        intensity: Math.max(1, asNumber(data.intensity, stacks)),
        rank: Math.max(1, Math.floor(asNumber(data.rank, 1))),
        statMods: { flat: {}, pct: {} },
        tickFormula: undefined,
        dispellable: true,
        cleanseTags: [],
        metadata: {
          ...data,
          immunitiesGranted: Array.isArray(data.immunitiesGranted) ? data.immunitiesGranted : [],
          tickRate: asNumber(data.tickRate, 1),
        },
      } as ActiveStatus;
    });
}

function readResistances(derived: Record<string, unknown>): Resistances {
  const resistValue = asNumber(derived.resist, 0) / (Math.abs(asNumber(derived.resist, 0)) > 2 ? 100 : 1);
  const resistancesRaw = asRecord(derived.resistances);
  const read = (key: keyof Resistances, fallback = resistValue) => {
    const value = asNumber(resistancesRaw[key], Number.NaN);
    return Number.isFinite(value)
      ? (Math.abs(value) > 2 ? value / 100 : value)
      : fallback;
  };
  return {
    physical: read("physical"),
    fire: read("fire"),
    ice: read("ice"),
    lightning: read("lightning"),
    poison: read("poison"),
    bleed: read("bleed"),
    stun: read("stun"),
    holy: read("holy"),
    shadow: read("shadow"),
    arcane: read("arcane"),
    wind: read("wind"),
    earth: read("earth"),
    water: read("water"),
  };
}

function toSkillSummary(
  skill: MythicSkill,
  availability: SkillAvailabilityEntry | null,
  canonicalSkill: { rank: number; maxRank: number; mpCost: number; power: number; summary: string } | null,
): CharacterSkillSummary {
  const fallbackRank = parseSkillRank(skill);
  const costRecord = asRecord(skill.cost_json);
  const mpCost = canonicalSkill?.mpCost ?? Math.max(
    0,
    Math.floor(
      asNumber(costRecord.mp, Number.NaN)
      || asNumber(costRecord.power, Number.NaN)
      || asNumber(costRecord.amount, 0),
    ),
  );
  const power = canonicalSkill?.power ?? Math.max(0, Math.floor(
    asNumber(asRecord(asRecord(skill.effects_json).damage).amount, Number.NaN)
    || asNumber(asRecord(asRecord(skill.effects_json).heal).amount, 0),
  ));

  return {
    id: String(skill.id ?? skill.name),
    name: skill.name,
    kind: skill.kind,
    targeting: skill.targeting,
    rank: canonicalSkill?.rank ?? fallbackRank.rank,
    maxRank: canonicalSkill?.maxRank ?? fallbackRank.maxRank,
    mpCost,
    power,
    powerSummary: canonicalSkill?.summary ?? `${skill.name} · Power ${power} · MP ${mpCost}`,
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

function sortBackpackWithRules(backpack: MythicInventoryRow[]): MythicInventoryRow[] {
  const accessoryIndex = { value: 0 };
  const ruleItems = backpack
    .map((row) => mythicItemToRuleItem(row, accessoryIndex))
    .filter((entry): entry is Item => Boolean(entry));
  const sorted = autoSortInventory(ruleItems);
  const order = new Map(sorted.map((item, index) => [item.id, index]));
  return [...backpack].sort((left, right) => {
    const leftRank = order.get(left.item?.id ?? "") ?? Number.MAX_SAFE_INTEGER;
    const rightRank = order.get(right.item?.id ?? "") ?? Number.MAX_SAFE_INTEGER;
    return leftRank - rightRank;
  });
}

export function buildCharacterSheetViewModel(args: BuildCharacterSheetViewModelArgs): CharacterSheetViewModel {
  const classJson = asRecord(args.character.class_json);
  const resources = asRecord(args.character.resources);
  const derived = asRecord(args.character.derived_json);
  const profile = readProfileDraft(args.character);

  const availabilityBySkillId = new Map<string, SkillAvailabilityEntry>(
    args.skillAvailability.map((entry) => [entry.skillId, entry]),
  );

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
  const sortedBackpack = sortBackpackWithRules(backpack);
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

  const pushInventoryRow = (row: MythicInventoryRow, equippedState: boolean) => {
    if (!row.item) return;
    const slot = asString(row.item.slot || row.equip_slot, "other");
    const target = upsertSlot(slot);
    const itemMods = readStatMods(row.item.stat_mods);
    const baseline = equippedState ? {} : (equippedTotalsBySlot.get(slot.toLowerCase()) ?? {});
    const item = {
      inventoryId: row.id,
      itemId: row.item.id,
      name: asString(row.item.name, "Unnamed Item"),
      slot,
      rarity: asString(row.item.rarity, "common"),
      quantity: Math.max(1, Math.floor(row.quantity ?? 1)),
      equipped: equippedState,
      statMods: itemMods,
      deltaMods: deltaMods(itemMods, baseline),
      grantedAbilities: getGrantedAbilities(row.item),
    };
    if (equippedState) {
      target.equippedItems.push(item);
    } else {
      target.backpackItems.push(item);
    }
  };

  equipment.forEach((row) => pushInventoryRow(row, true));
  sortedBackpack.forEach((row) => pushInventoryRow(row, false));

  const equipmentSlots = Array.from(bySlot.entries())
    .map(([slot, value]) => ({ slot, ...value }))
    .sort((a, b) => a.slot.localeCompare(b.slot));

  const accessoryIndex = { value: 0 };
  const normalizedEquipment: Record<EquipmentSlot, Item | null> = {
    weapon: null,
    offhand: null,
    head: null,
    chest: null,
    legs: null,
    accessory1: null,
    accessory2: null,
  };
  for (const row of equipment) {
    const mapped = mythicItemToRuleItem(row, accessoryIndex);
    if (!mapped) continue;
    if (mapped.slot === "accessory1" || mapped.slot === "accessory2") {
      if (!normalizedEquipment.accessory1) normalizedEquipment.accessory1 = mapped;
      else normalizedEquipment.accessory2 = mapped;
    } else {
      normalizedEquipment[mapped.slot] = mapped;
    }
  }

  const level = Math.max(1, Math.floor(asNumber(args.character.level, 1)));
  const baseStats = baseStatsFromMythicLens({
    offense: asNumber(args.character.offense, 10),
    defense: asNumber(args.character.defense, 10),
    control: asNumber(args.character.control, 10),
    support: asNumber(args.character.support, 10),
    mobility: asNumber(args.character.mobility, 10),
    utility: asNumber(args.character.utility, 10),
  });

  const ruleSkills = args.skills.map(mythicSkillToRuleSkill);
  const currentTurnIndex = Math.max(0, Math.floor(asNumber(args.currentTurnIndex, 0)));
  const statuses = parseCombatStatuses(playerCombatant?.statuses, currentTurnIndex);

  const ruleActor: Actor = {
    id: args.character.id,
    name: profile.name,
    level,
    xp: Math.max(0, Math.floor(asNumber(args.character.xp, 0))),
    xpToNext: Math.max(0, Math.floor(asNumber(args.character.xp_to_next, 0))),
    classTags: [asString(classJson.role, "hybrid")],
    statsBase: baseStats,
    statsGrowth: { str: 0, dex: 0, int: 0, vit: 0, wis: 0 },
    statsDerived: {
      hp: Math.max(1, Math.floor(hpMax)),
      mp: Math.max(0, Math.floor(mpMax)),
      atk: 0,
      def: 0,
      matk: 0,
      mdef: 0,
      acc: 0,
      eva: 0,
      crit: 0,
      critRes: 0,
      res: 0,
      speed: 0,
      healBonus: 0,
      barrier: Math.max(0, Math.floor(asNumber(playerCombatant?.armor, 0))),
    },
    skillPointsAvailable: Math.max(0, Math.floor(asNumber(args.character.unspent_points, 0))),
    statPointsAvailable: Math.max(0, Math.floor(asNumber(args.character.unspent_points, 0))),
    equipment: normalizedEquipment,
    resistances: readResistances(derived),
    statuses,
    skillbook: ruleSkills,
    coins: Math.max(0, Math.floor(asNumber(args.coins, 0))),
    barrier: Math.max(0, Math.floor(asNumber(playerCombatant?.armor, 0))),
  };

  const canonicalSheet = buildCharacterSheetView({
    actor: ruleActor,
    currentHp: hpCurrent,
    currentMp: mpCurrent,
  });

  const canonicalSkillById = new Map<string, { rank: number; maxRank: number; mpCost: number; power: number; summary: string }>();
  for (const skill of canonicalSheet.skills) {
    canonicalSkillById.set(String(skill.id), {
      rank: Math.max(1, Math.floor(asNumber(skill.rank, 1))),
      maxRank: Math.max(1, Math.floor(asNumber(skill.maxRank, 1))),
      mpCost: Math.max(0, Math.floor(asNumber(skill.mpCost, 0))),
      power: Math.max(0, Math.floor(asNumber(skill.power, 0))),
      summary: asString(skill.summary, `${skill.name} · Power ${Math.floor(asNumber(skill.power, 0))}`),
    });
  }

  const combatSkills = args.skills
    .filter((skill) => skill.kind === "active" || skill.kind === "ultimate")
    .map((skill) => {
      const canonical = canonicalSkillById.get(String(skill.id ?? skill.name)) ?? null;
      return toSkillSummary(skill, skill.id ? availabilityBySkillId.get(skill.id) ?? null : null, canonical);
    })
    .slice(0, 24);

  const passiveSkills = args.skills
    .filter((skill) => skill.kind === "passive")
    .map((skill) => {
      const canonical = canonicalSkillById.get(String(skill.id ?? skill.name)) ?? null;
      return toSkillSummary(skill, null, canonical);
    })
    .slice(0, 12);

  const statusSummaries = canonicalSheet.statuses.map((status) => ({
    id: asString(status.id, "status"),
    category: asString(status.category, "debuff"),
    remainingTurns: Math.max(0, Math.floor(asNumber(status.remainingTurns, 0))),
    stacks: Math.max(1, Math.floor(asNumber(status.stacks, 1))),
    intensity: Math.max(1, asNumber(status.intensity, 1)),
    tooltip: asString(status.tooltip, asString(status.id, "status")),
  }));

  return {
    ruleVersion: canonicalSheet.ruleVersion,
    characterId: args.character.id,
    boardMode: args.boardMode,
    name: profile.name,
    className: asString(classJson.class_name, "Classless"),
    role: asString(classJson.role, "hybrid"),
    level,
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
    baseStats: {
      ...canonicalSheet.stats.base,
    },
    derivedStats: {
      ...canonicalSheet.stats.derived,
    },
    resistances: {
      ...canonicalSheet.stats.resistances,
    },
    statuses: statusSummaries,
    tooltips: canonicalSheet.tooltips,
    canonicalSheet,
    lastCombatReward: args.rewardSummary ?? null,
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
