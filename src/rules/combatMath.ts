import {
  DEFAULT_RULE_TUNABLES,
  clamp,
  type RuleTunables,
} from "@/rules/constants";
import type { Actor, ElementKey, Skill } from "@/rules/schema";

export type DamageKind = "physical" | "magical";

export interface CombatMathActor {
  id: string;
  level: number;
  statsBase: Pick<Actor["statsBase"], "str" | "dex" | "int" | "vit" | "wis">;
  statsDerived: Actor["statsDerived"];
  resistances: Actor["resistances"];
  barrier?: number;
}

export interface DamageComputationInput {
  seed: number;
  label: string;
  attacker: CombatMathActor;
  target: CombatMathActor;
  skill: Pick<Skill, "id" | "name" | "element" | "hitBonus" | "critBonus">;
  skillPower: number;
  damageKind: DamageKind;
  tunables?: RuleTunables;
}

export interface DamageComputationResult {
  didHit: boolean;
  didCrit: boolean;
  hitChance: number;
  critChance: number;
  hitRoll: number;
  critRoll: number;
  raw: number;
  mitigated: number;
  varianceMultiplier: number;
  resistanceMultiplier: number;
  finalBeforeBarrier: number;
  damageToBarrier: number;
  damageToHp: number;
  finalDamage: number;
  barrierBroken: boolean;
  targetBarrierAfter: number;
  eventTags: string[];
}

function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seeded01(seed: number, label: string): number {
  const h = hash32(`${seed}:${label}`) >>> 0;
  let x = (h ^ 0x9e3779b9) >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 1_000_000) / 1_000_000;
}

function mitigation(raw: number, defense: number): number {
  const safeDefense = Math.max(0, defense);
  return raw * (100 / (100 + safeDefense));
}

export function computeHitChance(args: {
  attackerAcc: number;
  targetEva: number;
  skillHitBonus?: number;
  tunables?: RuleTunables;
}): number {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const raw = (args.attackerAcc - args.targetEva + (args.skillHitBonus ?? 0)) / 100;
  return clamp(raw, tunables.caps.hitChanceMin, tunables.caps.hitChanceMax);
}

export function computeCritChance(args: {
  attackerCrit: number;
  skillCritBonus?: number;
  targetCritRes: number;
  tunables?: RuleTunables;
}): number {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const raw = args.attackerCrit + (args.skillCritBonus ?? 0) - args.targetCritRes;
  return clamp(raw, tunables.caps.critChanceMin, tunables.caps.critChanceMax);
}

export function computeDamageRoll(input: DamageComputationInput): DamageComputationResult {
  const tunables = input.tunables ?? DEFAULT_RULE_TUNABLES;

  const hitChance = computeHitChance({
    attackerAcc: input.attacker.statsDerived.acc,
    targetEva: input.target.statsDerived.eva,
    skillHitBonus: input.skill.hitBonus,
    tunables,
  });
  const hitRoll = seeded01(input.seed, `${input.label}:hit:${input.skill.id}`);
  const didHit = hitRoll <= hitChance;

  if (!didHit) {
    return {
      didHit: false,
      didCrit: false,
      hitChance,
      critChance: 0,
      hitRoll,
      critRoll: 0,
      raw: 0,
      mitigated: 0,
      varianceMultiplier: 1,
      resistanceMultiplier: 1,
      finalBeforeBarrier: 0,
      damageToBarrier: 0,
      damageToHp: 0,
      finalDamage: 0,
      barrierBroken: false,
      targetBarrierAfter: Math.max(0, Math.floor(input.target.barrier ?? input.target.statsDerived.barrier ?? 0)),
      eventTags: ["miss"],
    };
  }

  const critChance = computeCritChance({
    attackerCrit: input.attacker.statsDerived.crit,
    skillCritBonus: input.skill.critBonus,
    targetCritRes: input.target.statsDerived.critRes,
    tunables,
  });

  const critRoll = seeded01(input.seed, `${input.label}:crit:${input.skill.id}`);
  const didCrit = critRoll <= critChance;

  const strengthScale = 1 + (input.attacker.statsBase.str * tunables.combat.physicalStrScale);
  const intellectScale = 1 + (input.attacker.statsBase.int * tunables.combat.magicalIntScale);
  const corePower = Math.max(0, input.skillPower);

  const raw = input.damageKind === "physical"
    ? (input.attacker.statsDerived.atk + corePower) * strengthScale
    : (input.attacker.statsDerived.matk + corePower) * intellectScale;

  const defended = input.damageKind === "physical"
    ? mitigation(raw, input.target.statsDerived.def)
    : mitigation(raw, input.target.statsDerived.mdef);

  const critAdjusted = didCrit ? defended * tunables.combat.critMultiplier : defended;

  const varianceRoll = seeded01(input.seed, `${input.label}:variance:${input.skill.id}`);
  const variance = ((varianceRoll * 2) - 1) * tunables.combat.variancePct;
  const varianceMultiplier = 1 + variance;

  const element = (input.skill.element ?? "physical") as ElementKey;
  const elementResist = clamp(input.target.resistances[element] ?? input.target.statsDerived.res, -0.9, 0.95);
  const resistanceMultiplier = 1 - elementResist;

  const finalBeforeBarrier = Math.max(
    tunables.combat.minDamageOnHit,
    Math.floor(critAdjusted * varianceMultiplier * resistanceMultiplier),
  );

  const targetBarrier = Math.max(0, Math.floor(input.target.barrier ?? input.target.statsDerived.barrier ?? 0));
  let damageToBarrier = 0;
  let damageToHp = finalBeforeBarrier;
  let targetBarrierAfter = targetBarrier;
  let barrierBroken = false;

  if (targetBarrier > 0) {
    damageToBarrier = Math.min(targetBarrier, finalBeforeBarrier);
    targetBarrierAfter = Math.max(0, targetBarrier - damageToBarrier);
    const spill = finalBeforeBarrier - damageToBarrier;
    damageToHp = tunables.combat.barrierBreakSpillover ? Math.max(0, spill) : 0;
    barrierBroken = targetBarrierAfter <= 0 && damageToBarrier > 0;
  }

  return {
    didHit,
    didCrit,
    hitChance,
    critChance,
    hitRoll,
    critRoll,
    raw,
    mitigated: defended,
    varianceMultiplier,
    resistanceMultiplier,
    finalBeforeBarrier,
    damageToBarrier,
    damageToHp,
    finalDamage: damageToBarrier + damageToHp,
    barrierBroken,
    targetBarrierAfter,
    eventTags: [didCrit ? "crit" : "hit", barrierBroken ? "barrier_break" : ""].filter(Boolean),
  };
}

export function expectedDamage(input: Omit<DamageComputationInput, "seed" | "label"> & { tunables?: RuleTunables }): number {
  const tunables = input.tunables ?? DEFAULT_RULE_TUNABLES;
  const hitChance = computeHitChance({
    attackerAcc: input.attacker.statsDerived.acc,
    targetEva: input.target.statsDerived.eva,
    skillHitBonus: input.skill.hitBonus,
    tunables,
  });
  const critChance = computeCritChance({
    attackerCrit: input.attacker.statsDerived.crit,
    skillCritBonus: input.skill.critBonus,
    targetCritRes: input.target.statsDerived.critRes,
    tunables,
  });

  const strengthScale = 1 + (input.attacker.statsBase.str * tunables.combat.physicalStrScale);
  const intellectScale = 1 + (input.attacker.statsBase.int * tunables.combat.magicalIntScale);
  const corePower = Math.max(0, input.skillPower);
  const raw = input.damageKind === "physical"
    ? (input.attacker.statsDerived.atk + corePower) * strengthScale
    : (input.attacker.statsDerived.matk + corePower) * intellectScale;

  const defended = input.damageKind === "physical"
    ? mitigation(raw, input.target.statsDerived.def)
    : mitigation(raw, input.target.statsDerived.mdef);

  const critAdjusted = defended * (1 + (critChance * (tunables.combat.critMultiplier - 1)));
  const element = input.skill.element ?? "physical";
  const resist = clamp(input.target.resistances[element] ?? input.target.statsDerived.res, -0.9, 0.95);
  const averageVarianceMultiplier = 1;
  const expected = critAdjusted * (1 - resist) * averageVarianceMultiplier;
  return Math.max(0, expected * hitChance);
}
