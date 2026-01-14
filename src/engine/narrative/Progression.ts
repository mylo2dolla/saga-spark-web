/**
 * XP and leveling system with stat progression and ability unlocks.
 * Pure functions only - no mutations.
 */

import type {
  CharacterProgression,
  LevelProgression,
  XPSource,
  StatModifiers,
} from "./types";

// ============= Level Curve =============

const XP_PER_LEVEL: number[] = [
  0,      // Level 1 (starting)
  300,    // Level 2
  900,    // Level 3
  2700,   // Level 4
  6500,   // Level 5
  14000,  // Level 6
  23000,  // Level 7
  34000,  // Level 8
  48000,  // Level 9
  64000,  // Level 10
  85000,  // Level 11
  100000, // Level 12
  120000, // Level 13
  140000, // Level 14
  165000, // Level 15
  195000, // Level 16
  225000, // Level 17
  265000, // Level 18
  305000, // Level 19
  355000, // Level 20
];

export function getXpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > XP_PER_LEVEL.length) {
    // Extrapolate for higher levels
    const lastXp = XP_PER_LEVEL[XP_PER_LEVEL.length - 1];
    return lastXp + (level - XP_PER_LEVEL.length) * 50000;
  }
  return XP_PER_LEVEL[level - 1];
}

export function getLevelForXp(totalXp: number): number {
  for (let level = XP_PER_LEVEL.length; level >= 1; level--) {
    if (totalXp >= getXpForLevel(level)) {
      return level;
    }
  }
  return 1;
}

// ============= Progression Factory =============

export function createProgression(
  entityId: string,
  baseStats: StatModifiers = {}
): CharacterProgression {
  return {
    entityId,
    level: 1,
    currentXp: 0,
    xpToNextLevel: getXpForLevel(2),
    totalXpEarned: 0,
    xpHistory: [],
    baseStats,
    abilitySlots: 2,
    unlockedAbilities: [],
  };
}

// ============= XP Management =============

export interface GainXpResult {
  progression: CharacterProgression;
  leveledUp: boolean;
  newLevel: number;
  previousLevel: number;
}

export function gainXp(
  progression: CharacterProgression,
  amount: number,
  source: XPSource["type"],
  description: string
): GainXpResult {
  const previousLevel = progression.level;
  const newTotalXp = progression.totalXpEarned + amount;
  const newLevel = getLevelForXp(newTotalXp);
  const xpForNextLevel = getXpForLevel(newLevel + 1);
  
  const xpSource: XPSource = {
    type: source,
    amount,
    description,
    timestamp: Date.now(),
  };

  // Calculate ability slots (1 every 2 levels starting at 2)
  const baseAbilitySlots = 2;
  const bonusSlots = Math.floor((newLevel - 1) / 2);

  const newProgression: CharacterProgression = {
    ...progression,
    level: newLevel,
    currentXp: newTotalXp - getXpForLevel(newLevel),
    xpToNextLevel: xpForNextLevel - newTotalXp,
    totalXpEarned: newTotalXp,
    xpHistory: [...progression.xpHistory, xpSource].slice(-100), // Keep last 100
    abilitySlots: baseAbilitySlots + bonusSlots,
  };

  return {
    progression: newProgression,
    leveledUp: newLevel > previousLevel,
    newLevel,
    previousLevel,
  };
}

// ============= XP Calculations =============

export function calculateCombatXp(
  enemyLevel: number,
  playerLevel: number,
  isBoss: boolean = false
): number {
  const baseXp = 50 + enemyLevel * 25;
  const levelDiff = enemyLevel - playerLevel;
  
  // Scale XP based on level difference
  let multiplier = 1;
  if (levelDiff > 0) {
    multiplier = 1 + levelDiff * 0.1; // +10% per level above
  } else if (levelDiff < 0) {
    multiplier = Math.max(0.1, 1 + levelDiff * 0.15); // -15% per level below, min 10%
  }
  
  if (isBoss) {
    multiplier *= 3;
  }

  return Math.round(baseXp * multiplier);
}

export function calculateQuestXp(
  questImportance: "side" | "main" | "legendary",
  playerLevel: number
): number {
  const baseXp = {
    side: 100,
    main: 500,
    legendary: 2000,
  };

  return Math.round(baseXp[questImportance] * (1 + playerLevel * 0.1));
}

export function calculateDiscoveryXp(playerLevel: number): number {
  return Math.round(25 * (1 + playerLevel * 0.05));
}

// ============= Level Up Bonuses =============

export function getLevelUpBonus(level: number): StatModifiers {
  // Every level grants some HP
  const baseBonus: StatModifiers = {
    maxHp: 5 + Math.floor(level / 3),
  };

  // Every 4 levels, get a stat point
  if (level % 4 === 0) {
    // Alternate between main stats
    const stats: (keyof StatModifiers)[] = [
      "strength", "dexterity", "constitution", 
      "intelligence", "wisdom", "charisma"
    ];
    const statIndex = Math.floor(level / 4) % stats.length;
    return { ...baseBonus, [stats[statIndex]]: 1 };
  }

  // Every 2 levels, get slight AC/initiative bonus
  if (level % 2 === 0) {
    if (level % 6 === 0) {
      return { ...baseBonus, ac: 1 };
    } else if (level % 4 === 0) {
      return { ...baseBonus, initiative: 1 };
    }
  }

  return baseBonus;
}

export function getLevelProgression(level: number): LevelProgression {
  const xpRequired = getXpForLevel(level);
  const statBoosts = getLevelUpBonus(level);
  const abilitySlotsGained = level % 2 === 0 ? 1 : 0;
  
  const narrativeFlags: string[] = [];
  if (level === 5) narrativeFlags.push("novice_adventurer");
  if (level === 10) narrativeFlags.push("seasoned_adventurer");
  if (level === 15) narrativeFlags.push("veteran_adventurer");
  if (level === 20) narrativeFlags.push("legendary_adventurer");

  return {
    level,
    xpRequired,
    statBoosts,
    abilitySlotsGained,
    narrativeFlags,
  };
}

// ============= Stat Aggregation =============

export function calculateFinalStats(
  baseStats: StatModifiers,
  levelBonuses: StatModifiers,
  equipmentBonuses: StatModifiers,
  statusBonuses: StatModifiers
): StatModifiers {
  const keys: (keyof StatModifiers)[] = [
    "strength", "dexterity", "constitution", "intelligence",
    "wisdom", "charisma", "maxHp", "ac", "attackBonus",
    "damageBonus", "speed", "initiative"
  ];

  const result: StatModifiers = {};
  
  for (const key of keys) {
    const base = baseStats[key] ?? 0;
    const level = levelBonuses[key] ?? 0;
    const equipment = equipmentBonuses[key] ?? 0;
    const status = statusBonuses[key] ?? 0;
    
    const total = base + level + equipment + status;
    if (total !== 0) {
      (result as Record<string, number>)[key] = total;
    }
  }

  return result;
}

export function getAccumulatedLevelBonuses(level: number): StatModifiers {
  const result: StatModifiers = {};
  const keys: (keyof StatModifiers)[] = [
    "strength", "dexterity", "constitution", "intelligence",
    "wisdom", "charisma", "maxHp", "ac", "attackBonus",
    "damageBonus", "speed", "initiative"
  ];

  for (let l = 2; l <= level; l++) {
    const bonus = getLevelUpBonus(l);
    for (const key of keys) {
      const value = bonus[key];
      if (value !== undefined) {
        (result as Record<string, number>)[key] = 
          ((result as Record<string, number>)[key] ?? 0) + value;
      }
    }
  }

  return result;
}

// ============= Ability Unlocks =============

export function unlockAbility(
  progression: CharacterProgression,
  abilityId: string
): CharacterProgression {
  if (progression.unlockedAbilities.includes(abilityId)) {
    return progression;
  }
  return {
    ...progression,
    unlockedAbilities: [...progression.unlockedAbilities, abilityId],
  };
}

export function canUnlockAbility(progression: CharacterProgression): boolean {
  return progression.unlockedAbilities.length < progression.abilitySlots;
}

export function getAvailableAbilitySlots(progression: CharacterProgression): number {
  return progression.abilitySlots - progression.unlockedAbilities.length;
}
