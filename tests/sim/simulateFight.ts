import {
  buildTunables,
  recomputeActorStats,
  simulateFight as runFight,
  type Actor,
  type SimBuild,
  type Skill,
} from "@/rules";

export interface SampleBuildOptions {
  id: string;
  name: string;
  level: number;
  offense: number;
  defense: number;
  control: number;
  support: number;
  mobility: number;
  utility: number;
  skillName: string;
  skillPower: number;
  skillPowerScale?: number;
  mpCost?: number;
}

function emptyEquipment(): Actor["equipment"] {
  return {
    weapon: null,
    offhand: null,
    head: null,
    chest: null,
    legs: null,
    accessory1: null,
    accessory2: null,
  };
}

function defaultResistances(): Actor["resistances"] {
  return {
    physical: 0.08,
    fire: 0.1,
    ice: 0.1,
    lightning: 0.1,
    poison: 0.1,
    bleed: 0.1,
    stun: 0.1,
    holy: 0.08,
    shadow: 0.08,
    arcane: 0.08,
    wind: 0.08,
    earth: 0.08,
    water: 0.08,
  };
}

export function buildSampleSimBuild(options: SampleBuildOptions): SimBuild {
  const tunables = buildTunables();
  const actor: Actor = {
    id: options.id,
    name: options.name,
    level: options.level,
    xp: 0,
    xpToNext: 100,
    classTags: ["hybrid"],
    statsBase: {
      str: options.offense,
      vit: options.defense,
      int: options.control,
      wis: Math.floor((options.support + options.utility) / 2),
      dex: options.mobility,
    },
    statsGrowth: {
      str: 1,
      dex: 1,
      int: 1,
      vit: 1,
      wis: 1,
    },
    statsDerived: {
      hp: 1,
      mp: 1,
      atk: 1,
      def: 1,
      matk: 1,
      mdef: 1,
      acc: 1,
      eva: 1,
      crit: 0,
      critRes: 0,
      res: 0,
      speed: 1,
      healBonus: 0,
      barrier: 0,
    },
    skillPointsAvailable: 0,
    statPointsAvailable: 0,
    equipment: emptyEquipment(),
    resistances: defaultResistances(),
    statuses: [],
    skillbook: [],
    coins: 0,
    barrier: 0,
  };

  const skill: Skill = {
    id: `${options.id}-skill`,
    name: options.skillName,
    element: "physical",
    tags: ["melee"],
    targeting: "single",
    rank: 1,
    maxRank: 5,
    mpCostBase: Math.max(0, Math.floor(options.mpCost ?? 4)),
    mpCostScale: 0.6,
    mpLevelScale: 0.08,
    basePower: options.skillPower,
    powerScale: options.skillPowerScale ?? 5,
    levelScale: 0.45,
    hitBonus: 6,
    critBonus: 0.04,
    formulaOverrideId: null,
    description: "Simulation skill",
  };

  actor.skillbook = [skill];
  const recomputed = recomputeActorStats(actor, tunables);

  return {
    actor: recomputed,
    skill,
    damageKind: "physical",
  };
}

export function simulateFight(seed: number, buildA: SimBuild, buildB: SimBuild) {
  return runFight(seed, buildA, buildB, {
    maxTurns: 50,
    tunables: buildTunables(),
  });
}
