import { DEFAULT_RULE_TUNABLES, clamp, type RuleTunables } from "@/rules/constants";
import type { Actor, Skill } from "@/rules/schema";

export interface SkillFormulaContext {
  skill: Skill;
  actorLevel: number;
  rank: number;
  actor: Pick<Actor, "statsBase" | "statsDerived">;
  tunables: RuleTunables;
}

export type SkillFormulaOverride = (context: SkillFormulaContext) => number;

const FORMULA_OVERRIDES = new Map<string, SkillFormulaOverride>();

export function registerSkillFormulaOverride(id: string, formula: SkillFormulaOverride): void {
  FORMULA_OVERRIDES.set(id, formula);
}

export function clearSkillFormulaOverrides(): void {
  FORMULA_OVERRIDES.clear();
}

function normalizedRank(rank: number, maxRank: number): number {
  const safeMax = Math.max(1, Math.floor(maxRank));
  return clamp(Math.floor(rank), 1, safeMax);
}

export function computeSkillMpCost(args: {
  skill: Skill;
  actorLevel: number;
  rank?: number;
  tunables?: RuleTunables;
}): number {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const rank = normalizedRank(args.rank ?? args.skill.rank, args.skill.maxRank);
  const level = Math.max(1, Math.floor(args.actorLevel));
  const raw = args.skill.mpCostBase + (rank * args.skill.mpCostScale) + (level * (args.skill.mpLevelScale ?? tunables.skills.defaultMpLevelScale));
  return Math.floor(clamp(Math.ceil(raw), 0, tunables.skills.mpCostMax));
}

export function computeSkillPower(args: {
  skill: Skill;
  actor: Pick<Actor, "statsBase" | "statsDerived">;
  actorLevel: number;
  rank?: number;
  tunables?: RuleTunables;
}): number {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const skill = args.skill;
  const level = Math.max(1, Math.floor(args.actorLevel));
  const rank = normalizedRank(args.rank ?? skill.rank, skill.maxRank);

  const formulaId = skill.formulaOverrideId ?? null;
  const override = formulaId ? FORMULA_OVERRIDES.get(formulaId) : null;
  if (override) {
    return Math.max(0, Math.floor(override({ skill, actorLevel: level, rank, actor: args.actor, tunables })));
  }

  const base = skill.basePower + (rank * skill.powerScale * tunables.skills.rankPowerWeight);
  const levelScale = skill.levelScale ?? tunables.skills.defaultLevelScale;
  const scaled = base + Math.floor(level * levelScale);
  return Math.max(0, Math.floor(scaled));
}

export function powerSummary(args: {
  skill: Skill;
  actor: Pick<Actor, "statsBase" | "statsDerived">;
  actorLevel: number;
  rank?: number;
  tunables?: RuleTunables;
}): string {
  const rank = normalizedRank(args.rank ?? args.skill.rank, args.skill.maxRank);
  const power = computeSkillPower(args);
  const mp = computeSkillMpCost({
    skill: args.skill,
    actorLevel: args.actorLevel,
    rank,
    tunables: args.tunables,
  });
  const tags = args.skill.tags.length > 0 ? args.skill.tags.join(", ") : "untagged";
  return `${args.skill.name} R${rank}/${args.skill.maxRank} · Power ${power} · MP ${mp} · ${tags}`;
}

export function isSkillTag(skill: Skill, tag: string): boolean {
  return skill.tags.includes(tag as Skill["tags"][number]);
}
