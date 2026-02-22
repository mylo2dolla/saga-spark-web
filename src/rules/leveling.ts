import {
  DEFAULT_RULE_TUNABLES,
  type RuleTunables,
  type XpPreset,
  clamp,
} from "@/rules/constants";

export interface PointGrant {
  stat: number;
  skill: number;
}

export interface LevelGainResult {
  level: number;
  xp: number;
  xpToNext: number;
  levelsGained: number;
  statPointsGranted: number;
  skillPointsGranted: number;
}

export function xpToNext(level: number, preset: XpPreset = "STANDARD", tunables: RuleTunables = DEFAULT_RULE_TUNABLES): number {
  const curve = tunables.levels.xpPresets[preset];
  const safeLevel = Math.max(1, Math.floor(level));
  if (safeLevel >= curve.maxLevel) return 0;
  const raw = (curve.base * Math.pow(safeLevel, curve.exponent)) + (curve.linear * safeLevel);
  return Math.max(1, Math.floor(raw * curve.multiplier));
}

export function xpToReachLevel(level: number, preset: XpPreset = "STANDARD", tunables: RuleTunables = DEFAULT_RULE_TUNABLES): number {
  const curve = tunables.levels.xpPresets[preset];
  const target = clamp(Math.floor(level), 1, curve.maxLevel);
  let total = 0;
  for (let lv = 1; lv < target; lv += 1) {
    total += xpToNext(lv, preset, tunables);
  }
  return total;
}

export function pointsGrantedForLevel(levelReached: number, tunables: RuleTunables = DEFAULT_RULE_TUNABLES): PointGrant {
  const lvl = Math.max(1, Math.floor(levelReached));
  const milestone = tunables.levels.milestoneBonuses[lvl] ?? { stat: 0, skill: 0 };
  return {
    stat: tunables.levels.statPointsPerLevel + Math.max(0, milestone.stat ?? 0),
    skill: tunables.levels.skillPointsPerLevel + Math.max(0, milestone.skill ?? 0),
  };
}

export function totalPointsThroughLevel(level: number, tunables: RuleTunables = DEFAULT_RULE_TUNABLES): PointGrant {
  const safe = Math.max(1, Math.floor(level));
  let stat = 0;
  let skill = 0;
  for (let lv = 2; lv <= safe; lv += 1) {
    const grant = pointsGrantedForLevel(lv, tunables);
    stat += grant.stat;
    skill += grant.skill;
  }
  return { stat, skill };
}

export function resolveLevelFromXp(totalXp: number, preset: XpPreset = "STANDARD", tunables: RuleTunables = DEFAULT_RULE_TUNABLES): {
  level: number;
  xpIntoLevel: number;
  xpToNextLevel: number;
} {
  const curve = tunables.levels.xpPresets[preset];
  const safeXp = Math.max(0, Math.floor(totalXp));
  let level = 1;
  let spent = 0;

  while (level < curve.maxLevel) {
    const need = xpToNext(level, preset, tunables);
    if (safeXp < spent + need) {
      return {
        level,
        xpIntoLevel: safeXp - spent,
        xpToNextLevel: need,
      };
    }
    spent += need;
    level += 1;
  }

  return {
    level: curve.maxLevel,
    xpIntoLevel: 0,
    xpToNextLevel: 0,
  };
}

export function applyXpGain(args: {
  level: number;
  xp: number;
  amount: number;
  preset?: XpPreset;
  tunables?: RuleTunables;
}): LevelGainResult {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const preset = args.preset ?? "STANDARD";
  const curve = tunables.levels.xpPresets[preset];

  const currentLevel = clamp(Math.floor(args.level), 1, curve.maxLevel);
  const currentXp = Math.max(0, Math.floor(args.xp));
  const gain = Math.max(0, Math.floor(args.amount));

  const totalXp = xpToReachLevel(currentLevel, preset, tunables) + currentXp + gain;
  const resolved = resolveLevelFromXp(totalXp, preset, tunables);
  const levelsGained = Math.max(0, resolved.level - currentLevel);

  let statPointsGranted = 0;
  let skillPointsGranted = 0;
  for (let lv = currentLevel + 1; lv <= resolved.level; lv += 1) {
    const grant = pointsGrantedForLevel(lv, tunables);
    statPointsGranted += grant.stat;
    skillPointsGranted += grant.skill;
  }

  return {
    level: resolved.level,
    xp: resolved.xpIntoLevel,
    xpToNext: resolved.xpToNextLevel,
    levelsGained,
    statPointsGranted,
    skillPointsGranted,
  };
}

export const XP_PRESET_ORDER: readonly XpPreset[] = ["FAST", "STANDARD", "GRINDY"] as const;
