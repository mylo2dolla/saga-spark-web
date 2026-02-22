import type { EquipmentSlot, RarityKey } from "@/rules/schema";

export const RULE_VERSION = "rpg-rules.v1.0.0";

export const XP_PRESETS = ["FAST", "STANDARD", "GRINDY"] as const;
export type XpPreset = (typeof XP_PRESETS)[number];

export interface XpCurveTuning {
  maxLevel: number;
  base: number;
  exponent: number;
  linear: number;
  multiplier: number;
}

export interface RuleTunables {
  ruleVersion: string;
  levels: {
    defaultMaxLevel: number;
    statPointsPerLevel: number;
    skillPointsPerLevel: number;
    milestoneBonuses: Partial<Record<number, { stat: number; skill: number }>>;
    xpPresets: Record<XpPreset, XpCurveTuning>;
  };
  caps: {
    critChanceMin: number;
    critChanceMax: number;
    hitChanceMin: number;
    hitChanceMax: number;
    speedMin: number;
    speedMax: number;
    resistMin: number;
    resistMax: number;
  };
  diminishingReturns: {
    defenseSoftCap: number;
    defenseHardCap: number;
    mdefSoftCap: number;
    mdefHardCap: number;
    resistSoftCap: number;
    resistHardCap: number;
    overflowSlope: number;
  };
  stats: {
    hpPerVit: number;
    hpPerLevel: number;
    mpPerInt: number;
    mpPerLevel: number;
    atkPerStr: number;
    matkPerInt: number;
    defPerVit: number;
    mdefPerWis: number;
    accBase: number;
    accPerDex: number;
    evaBase: number;
    evaPerDex: number;
    critPerDex: number;
    speedBase: number;
    speedPerDex: number;
    critResPerWis: number;
    healBonusPerWis: number;
    barrierBase: number;
  };
  combat: {
    critMultiplier: number;
    variancePct: number;
    minDamageOnHit: number;
    physicalStrScale: number;
    magicalIntScale: number;
    barrierBreakSpillover: boolean;
  };
  skills: {
    mpCostMax: number;
    defaultMpLevelScale: number;
    defaultLevelScale: number;
    rankPowerWeight: number;
  };
  statuses: {
    defaultDotScale: number;
    defaultHotScale: number;
    defaultRankTick: number;
    defaultIntensityCap: number;
    cleanseRemovesControl: boolean;
  };
  loot: {
    rarityWeights: Record<RarityKey, number>;
    rarityStatBudget: Record<RarityKey, number>;
    rarityPriceMult: Record<RarityKey, number>;
    affixCountByRarity: Record<RarityKey, number>;
    smartDropUsableBonus: number;
    smartDropUndergearedBonus: number;
    duplicateAvoidancePenalty: number;
    goldDropBase: number;
    goldDropPerLevel: number;
    slotBaseWeights: Record<EquipmentSlot, number>;
  };
  economy: {
    buyBaseMultiplier: number;
    sellRate: number;
    levelPriceScale: number;
    inflationPerAct: number;
    inflationPerChapter: number;
  };
  qol: {
    autoEquipEnabledByDefault: boolean;
    quickCompareOnHover: boolean;
    autoSortAscending: boolean;
    fastAnimations: boolean;
    showNumbers: boolean;
    showTelegraphs: boolean;
  };
}

export const DEFAULT_RULE_TUNABLES: RuleTunables = {
  ruleVersion: RULE_VERSION,
  levels: {
    defaultMaxLevel: 60,
    statPointsPerLevel: 3,
    skillPointsPerLevel: 1,
    milestoneBonuses: {
      5: { stat: 2, skill: 1 },
      10: { stat: 2, skill: 1 },
      20: { stat: 3, skill: 1 },
      30: { stat: 3, skill: 2 },
      40: { stat: 4, skill: 2 },
      50: { stat: 4, skill: 2 },
    },
    xpPresets: {
      FAST: { maxLevel: 60, base: 60, exponent: 1.18, linear: 18, multiplier: 0.8 },
      STANDARD: { maxLevel: 60, base: 70, exponent: 1.22, linear: 22, multiplier: 1 },
      GRINDY: { maxLevel: 60, base: 78, exponent: 1.28, linear: 30, multiplier: 1.35 },
    },
  },
  caps: {
    critChanceMin: 0,
    critChanceMax: 0.6,
    hitChanceMin: 0.05,
    hitChanceMax: 0.95,
    speedMin: 1,
    speedMax: 250,
    resistMin: -0.5,
    resistMax: 0.8,
  },
  diminishingReturns: {
    defenseSoftCap: 180,
    defenseHardCap: 420,
    mdefSoftCap: 180,
    mdefHardCap: 420,
    resistSoftCap: 0.5,
    resistHardCap: 0.8,
    overflowSlope: 0.35,
  },
  stats: {
    hpPerVit: 12,
    hpPerLevel: 8,
    mpPerInt: 8,
    mpPerLevel: 4,
    atkPerStr: 2,
    matkPerInt: 2,
    defPerVit: 1.5,
    mdefPerWis: 1.5,
    accBase: 75,
    accPerDex: 1.2,
    evaBase: 5,
    evaPerDex: 0.8,
    critPerDex: 0.15,
    speedBase: 10,
    speedPerDex: 0.2,
    critResPerWis: 0.08,
    healBonusPerWis: 0.01,
    barrierBase: 0,
  },
  combat: {
    critMultiplier: 1.5,
    variancePct: 0.1,
    minDamageOnHit: 1,
    physicalStrScale: 0.01,
    magicalIntScale: 0.01,
    barrierBreakSpillover: true,
  },
  skills: {
    mpCostMax: 99,
    defaultMpLevelScale: 0.08,
    defaultLevelScale: 0.45,
    rankPowerWeight: 1,
  },
  statuses: {
    defaultDotScale: 0.35,
    defaultHotScale: 0.3,
    defaultRankTick: 2,
    defaultIntensityCap: 5,
    cleanseRemovesControl: true,
  },
  loot: {
    rarityWeights: {
      common: 54,
      uncommon: 24,
      rare: 12,
      epic: 6,
      legendary: 3,
      mythic: 1,
    },
    rarityStatBudget: {
      common: 12,
      uncommon: 18,
      rare: 27,
      epic: 40,
      legendary: 58,
      mythic: 76,
    },
    rarityPriceMult: {
      common: 1,
      uncommon: 1.35,
      rare: 1.9,
      epic: 2.8,
      legendary: 4.1,
      mythic: 6,
    },
    affixCountByRarity: {
      common: 0,
      uncommon: 1,
      rare: 2,
      epic: 3,
      legendary: 4,
      mythic: 5,
    },
    smartDropUsableBonus: 1.45,
    smartDropUndergearedBonus: 1.3,
    duplicateAvoidancePenalty: 0.18,
    goldDropBase: 16,
    goldDropPerLevel: 3.6,
    slotBaseWeights: {
      weapon: 1.2,
      offhand: 0.65,
      head: 0.85,
      chest: 1,
      legs: 0.9,
      accessory1: 0.85,
      accessory2: 0.85,
    },
  },
  economy: {
    buyBaseMultiplier: 1,
    sellRate: 0.25,
    levelPriceScale: 0.085,
    inflationPerAct: 0.08,
    inflationPerChapter: 0.03,
  },
  qol: {
    autoEquipEnabledByDefault: false,
    quickCompareOnHover: true,
    autoSortAscending: false,
    fastAnimations: false,
    showNumbers: true,
    showTelegraphs: true,
  },
};

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch?: Partial<T>): T {
  if (!patch) return { ...base };
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      out[key] = [...value];
      continue;
    }
    const baseValue = out[key];
    if (isRecord(baseValue) && isRecord(value)) {
      out[key] = deepMerge(baseValue, value as Partial<typeof baseValue>);
      continue;
    }
    out[key] = value;
  }
  return out as T;
}

export function buildTunables(overrides?: Partial<RuleTunables>): RuleTunables {
  return deepMerge(DEFAULT_RULE_TUNABLES, overrides);
}

export function tunablesForPreset(preset: XpPreset, overrides?: Partial<RuleTunables>): RuleTunables {
  const merged = buildTunables(overrides);
  const curve = merged.levels.xpPresets[preset];
  return buildTunables({
    ...merged,
    levels: {
      ...merged.levels,
      defaultMaxLevel: curve.maxLevel,
    },
  });
}
