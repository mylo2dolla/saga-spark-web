import { z } from "zod";

export const BASE_STAT_KEYS = ["str", "dex", "int", "vit", "wis"] as const;
export type BaseStatKey = (typeof BASE_STAT_KEYS)[number];

export const DERIVED_STAT_KEYS = [
  "hp",
  "mp",
  "atk",
  "def",
  "matk",
  "mdef",
  "acc",
  "eva",
  "crit",
  "critRes",
  "res",
  "speed",
  "healBonus",
  "barrier",
] as const;
export type DerivedStatKey = (typeof DERIVED_STAT_KEYS)[number];

export const ELEMENT_KEYS = [
  "physical",
  "fire",
  "ice",
  "lightning",
  "poison",
  "bleed",
  "stun",
  "holy",
  "shadow",
  "arcane",
  "wind",
  "earth",
  "water",
] as const;
export type ElementKey = (typeof ELEMENT_KEYS)[number];

export const EQUIPMENT_SLOTS = [
  "weapon",
  "offhand",
  "head",
  "chest",
  "legs",
  "accessory1",
  "accessory2",
] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export const RARITY_KEYS = ["common", "uncommon", "rare", "epic", "legendary", "mythic"] as const;
export type RarityKey = (typeof RARITY_KEYS)[number];

export const STATUS_CATEGORIES = ["buff", "debuff", "dot", "hot", "control"] as const;
export type StatusCategory = (typeof STATUS_CATEGORIES)[number];

export const STACKING_MODES = ["none", "refresh", "stack", "intensity"] as const;
export type StackingMode = (typeof STACKING_MODES)[number];

export const SKILL_TAGS = ["projectile", "melee", "aoe", "dot", "heal", "shield", "summon"] as const;
export type SkillTag = (typeof SKILL_TAGS)[number];

export const TARGETING_MODES = ["self", "single", "tile", "area", "cone", "line"] as const;
export type TargetingMode = (typeof TARGETING_MODES)[number];

export const baseStatsSchema = z.object({
  str: z.number(),
  dex: z.number(),
  int: z.number(),
  vit: z.number(),
  wis: z.number(),
});

export const derivedStatsSchema = z.object({
  hp: z.number(),
  mp: z.number(),
  atk: z.number(),
  def: z.number(),
  matk: z.number(),
  mdef: z.number(),
  acc: z.number(),
  eva: z.number(),
  crit: z.number(),
  critRes: z.number(),
  res: z.number(),
  speed: z.number(),
  healBonus: z.number(),
  barrier: z.number(),
});

export const resistanceSchema = z.record(z.enum(ELEMENT_KEYS), z.number()).default({
  physical: 0,
  fire: 0,
  ice: 0,
  lightning: 0,
  poison: 0,
  bleed: 0,
  stun: 0,
  holy: 0,
  shadow: 0,
  arcane: 0,
  wind: 0,
  earth: 0,
  water: 0,
});

export const statFlatSchema = z.record(z.string(), z.number()).default({});
export const statPctSchema = z.record(z.string(), z.number()).default({});

export const statModifierSchema = z.object({
  flat: statFlatSchema.default({}),
  pct: statPctSchema.default({}),
});

export type StatFlatMods = Record<string, number>;
export type StatPctMods = Record<string, number>;

export interface TickFormulaInput {
  sourceDerived: DerivedStats;
  sourceBase: BaseStats;
  targetDerived: DerivedStats;
  targetResistances: Resistances;
  rank: number;
  healBonus: number;
}

export interface TickFormulaOutput {
  amount: number;
  element: ElementKey;
}

export type TickFormulaOverride = (input: TickFormulaInput) => TickFormulaOutput;

export const statusTickFormulaSchema = z.object({
  element: z.enum(ELEMENT_KEYS).default("poison"),
  baseTick: z.number().default(0),
  dotScale: z.number().default(0),
  hotScale: z.number().default(0),
  rankTick: z.number().default(0),
  usesHealBonus: z.boolean().default(true),
});

export const statusEffectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(STATUS_CATEGORIES),
  durationTurns: z.number().int().min(0),
  tickRate: z.number().int().min(1).default(1),
  stacking: z.enum(STACKING_MODES).default("refresh"),
  maxStacks: z.number().int().min(1).default(1),
  intensityCap: z.number().int().min(1).default(1),
  tickFormula: statusTickFormulaSchema.optional(),
  statMods: statModifierSchema.default({ flat: {}, pct: {} }),
  immunitiesGranted: z.array(z.string()).default([]),
  dispellable: z.boolean().default(true),
  cleanseTags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const activeStatusSchema = z.object({
  id: z.string().min(1),
  sourceActorId: z.string().nullable().default(null),
  sourceSkillId: z.string().nullable().default(null),
  category: z.enum(STATUS_CATEGORIES),
  remainingTurns: z.number().int().min(0),
  nextTickTurn: z.number().int().min(0).default(0),
  stacks: z.number().int().min(1).default(1),
  intensity: z.number().default(1),
  rank: z.number().int().min(1).default(1),
  statMods: statModifierSchema.default({ flat: {}, pct: {} }),
  tickFormula: statusTickFormulaSchema.optional(),
  dispellable: z.boolean().default(true),
  cleanseTags: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const itemAffixSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["prefix", "suffix"]),
  statsFlat: statFlatSchema.default({}),
  statsPct: statPctSchema.default({}),
  tags: z.array(z.string()).default([]),
});

export const itemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  slot: z.enum(EQUIPMENT_SLOTS),
  rarity: z.enum(RARITY_KEYS),
  levelReq: z.number().int().min(1),
  statsFlat: statFlatSchema.default({}),
  statsPct: statPctSchema.default({}),
  affixes: z.array(itemAffixSchema).default([]),
  classTags: z.array(z.string()).default([]),
  setTag: z.string().nullable().default(null),
  icon: z.string().nullable().default(null),
  valueBuy: z.number().int().min(0),
  valueSell: z.number().int().min(0),
  locked: z.boolean().default(false),
  favorite: z.boolean().default(false),
});

export const skillSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  element: z.enum(ELEMENT_KEYS).default("physical"),
  tags: z.array(z.enum(SKILL_TAGS)).default([]),
  targeting: z.enum(TARGETING_MODES),
  rank: z.number().int().min(1),
  maxRank: z.number().int().min(1),
  mpCostBase: z.number().min(0),
  mpCostScale: z.number().default(0),
  mpLevelScale: z.number().default(0),
  basePower: z.number().default(0),
  powerScale: z.number().default(0),
  levelScale: z.number().default(0),
  hitBonus: z.number().default(0),
  critBonus: z.number().default(0),
  statusApply: statusEffectSchema.optional(),
  formulaOverrideId: z.string().nullable().default(null),
  description: z.string().default(""),
});

export const actorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  level: z.number().int().min(1),
  xp: z.number().int().min(0),
  xpToNext: z.number().int().min(0),
  classTags: z.array(z.string()).default([]),
  statsBase: baseStatsSchema,
  statsGrowth: baseStatsSchema.default({ str: 0, dex: 0, int: 0, vit: 0, wis: 0 }),
  statsDerived: derivedStatsSchema,
  skillPointsAvailable: z.number().int().min(0).default(0),
  statPointsAvailable: z.number().int().min(0).default(0),
  equipment: z.record(z.enum(EQUIPMENT_SLOTS), itemSchema.nullable()).default({
    weapon: null,
    offhand: null,
    head: null,
    chest: null,
    legs: null,
    accessory1: null,
    accessory2: null,
  }),
  resistances: resistanceSchema,
  statuses: z.array(activeStatusSchema).default([]),
  skillbook: z.array(skillSchema).default([]),
  coins: z.number().int().min(0).default(0),
  barrier: z.number().min(0).default(0),
});

export const inventoryFilterSchema = z.object({
  slot: z.enum(EQUIPMENT_SLOTS).optional(),
  rarity: z.enum(RARITY_KEYS).optional(),
  stat: z.string().optional(),
  favoriteOnly: z.boolean().optional(),
  unlockedOnly: z.boolean().optional(),
});

export const characterSheetViewSchema = z.object({
  ruleVersion: z.string().min(1),
  identity: z.object({
    id: z.string(),
    name: z.string(),
    classTags: z.array(z.string()),
  }),
  level: z.object({
    level: z.number().int(),
    xp: z.number().int(),
    xpToNext: z.number().int(),
    progressPct: z.number(),
    skillPointsAvailable: z.number().int(),
    statPointsAvailable: z.number().int(),
  }),
  stats: z.object({
    base: baseStatsSchema,
    derived: derivedStatsSchema,
    resistances: resistanceSchema,
  }),
  resources: z.object({
    hp: z.object({ current: z.number(), max: z.number() }),
    mp: z.object({ current: z.number(), max: z.number() }),
    barrier: z.number(),
    coins: z.number().int(),
  }),
  equipment: z.array(
    z.object({
      slot: z.enum(EQUIPMENT_SLOTS),
      item: itemSchema.nullable(),
      icon: z.string().nullable(),
    }),
  ),
  skills: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      rank: z.number().int(),
      maxRank: z.number().int(),
      mpCost: z.number(),
      power: z.number(),
      summary: z.string(),
    }),
  ),
  statuses: z.array(
    z.object({
      id: z.string(),
      category: z.enum(STATUS_CATEGORIES),
      remainingTurns: z.number().int(),
      stacks: z.number().int(),
      intensity: z.number(),
      tooltip: z.string(),
    }),
  ),
  tooltips: z.record(z.string(), z.string()),
});

export type BaseStats = z.infer<typeof baseStatsSchema>;
export type DerivedStats = z.infer<typeof derivedStatsSchema>;
export type Resistances = z.infer<typeof resistanceSchema>;
export type StatModifier = z.infer<typeof statModifierSchema>;
export type StatusEffectDefinition = z.infer<typeof statusEffectSchema>;
export type ActiveStatus = z.infer<typeof activeStatusSchema>;
export type ItemAffix = z.infer<typeof itemAffixSchema>;
export type Item = z.infer<typeof itemSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type Actor = z.infer<typeof actorSchema>;
export type InventoryFilter = z.infer<typeof inventoryFilterSchema>;
export type CharacterSheetView = z.infer<typeof characterSheetViewSchema>;

export interface LootRollContext {
  seed: number;
  actorLevel: number;
  count: number;
  preferredSlots?: EquipmentSlot[];
  equippedScores?: Partial<Record<EquipmentSlot, number>>;
  avoidItemIds?: string[];
}

export interface EconomyContext {
  actorLevel: number;
  act: number;
  chapter: number;
  biome: string;
  faction: string;
}

export interface CompareDiffEntry {
  key: string;
  current: number;
  candidate: number;
  delta: number;
}

export interface ItemComparison {
  slot: EquipmentSlot;
  scoreDelta: number;
  better: boolean;
  diffs: CompareDiffEntry[];
  summary: string;
}

export interface CombatLogEntry {
  turn: number;
  actorId: string;
  targetId: string | null;
  type: "hit" | "miss" | "crit" | "damage" | "heal" | "status_tick" | "status_apply" | "status_expire";
  amount: number;
  label: string;
  statusId?: string;
}
