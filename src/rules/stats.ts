import { DEFAULT_RULE_TUNABLES, clamp, type RuleTunables } from "@/rules/constants";
import type {
  Actor,
  BaseStats,
  DerivedStats,
  Item,
  Resistances,
  StatFlatMods,
  StatPctMods,
} from "@/rules/schema";

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safePct(value: number): number {
  if (Math.abs(value) > 2) return value / 100;
  return value;
}

function readAny(stats: Record<string, number>, keys: string[]): number {
  return keys.reduce((sum, key) => sum + num(stats[key], 0), 0);
}

export function applyDiminishing(value: number, softCap: number, hardCap: number, overflowSlope: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= softCap) return value;
  const overflow = value - softCap;
  const reduced = softCap + (overflow * clamp(overflowSlope, 0, 1));
  return clamp(reduced, 0, hardCap);
}

export function growBaseStats(base: BaseStats, growth: Partial<BaseStats>, level: number): BaseStats {
  const lv = Math.max(1, Math.floor(level));
  return {
    str: Math.max(1, Math.floor(base.str + num(growth.str, 0) * (lv - 1))),
    dex: Math.max(1, Math.floor(base.dex + num(growth.dex, 0) * (lv - 1))),
    int: Math.max(1, Math.floor(base.int + num(growth.int, 0) * (lv - 1))),
    vit: Math.max(1, Math.floor(base.vit + num(growth.vit, 0) * (lv - 1))),
    wis: Math.max(1, Math.floor(base.wis + num(growth.wis, 0) * (lv - 1))),
  };
}

export function aggregateEquipmentStats(items: Array<Item | null | undefined>): {
  flat: StatFlatMods;
  pct: StatPctMods;
} {
  const flat: StatFlatMods = {};
  const pct: StatPctMods = {};

  for (const item of items) {
    if (!item) continue;
    for (const [key, value] of Object.entries(item.statsFlat ?? {})) {
      flat[key] = (flat[key] ?? 0) + num(value, 0);
    }
    for (const [key, value] of Object.entries(item.statsPct ?? {})) {
      pct[key] = (pct[key] ?? 0) + num(value, 0);
    }
    for (const affix of item.affixes ?? []) {
      for (const [key, value] of Object.entries(affix.statsFlat ?? {})) {
        flat[key] = (flat[key] ?? 0) + num(value, 0);
      }
      for (const [key, value] of Object.entries(affix.statsPct ?? {})) {
        pct[key] = (pct[key] ?? 0) + num(value, 0);
      }
    }
  }

  return { flat, pct };
}

function mergedResistances(base: Resistances, gearFlat: Record<string, number>, tunables: RuleTunables, baseStats: BaseStats): Resistances {
  const next: Resistances = { ...base };
  for (const key of Object.keys(next)) {
    const gear = num(gearFlat[key], 0);
    const core = (baseStats.wis * 0.0025) + (num(gearFlat.res, 0) / 100);
    const mixed = num(base[key], 0) + core + safePct(gear);
    next[key] = clamp(mixed, tunables.caps.resistMin, tunables.caps.resistMax);
  }
  return next;
}

function applyPct(value: number, pctValue: number): number {
  return value * (1 + safePct(pctValue));
}

export function deriveStats(args: {
  level: number;
  base: BaseStats;
  equipmentFlat?: Record<string, number>;
  equipmentPct?: Record<string, number>;
  resistances?: Resistances;
  tunables?: RuleTunables;
}): { derived: DerivedStats; resistances: Resistances } {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const level = Math.max(1, Math.floor(args.level));
  const base = args.base;
  const flat = args.equipmentFlat ?? {};
  const pct = args.equipmentPct ?? {};

  const gearHp = readAny(flat, ["hp", "hp_max"]);
  const gearMp = readAny(flat, ["mp", "mp_max", "power_max"]);
  const weaponAtk = readAny(flat, ["atk", "weapon_atk", "weapon_power"]);
  const staffMatk = readAny(flat, ["matk", "staff_matk", "spell_power"]);
  const armorDef = readAny(flat, ["def", "armor", "armor_power"]);
  const armorMdef = readAny(flat, ["mdef", "res", "mres"]);
  const gearAcc = readAny(flat, ["acc", "accuracy"]);
  const gearEva = readAny(flat, ["eva", "evasion"]);
  const gearCrit = readAny(flat, ["crit", "crit_chance"]);
  const gearCritRes = readAny(flat, ["critRes", "crit_res"]);
  const gearSpeed = readAny(flat, ["speed", "spd", "mobility"]);
  const gearHealBonus = safePct(readAny(flat, ["healBonus", "healing_bonus"]));
  const gearBarrier = readAny(flat, ["barrier", "shield"]);

  const hpPre = (base.vit * tunables.stats.hpPerVit) + (level * tunables.stats.hpPerLevel) + gearHp;
  const mpPre = (base.int * tunables.stats.mpPerInt) + (level * tunables.stats.mpPerLevel) + gearMp;

  const atkPre = (base.str * tunables.stats.atkPerStr) + weaponAtk + level;
  const matkPre = (base.int * tunables.stats.matkPerInt) + staffMatk + level;

  const defPre = (base.vit * tunables.stats.defPerVit) + armorDef;
  const mdefPre = (base.wis * tunables.stats.mdefPerWis) + armorMdef;

  const accPre = tunables.stats.accBase + (base.dex * tunables.stats.accPerDex) + gearAcc;
  const evaPre = tunables.stats.evaBase + (base.dex * tunables.stats.evaPerDex) + gearEva;

  const critPct = clamp((base.dex * tunables.stats.critPerDex) + gearCrit, 0, 60);
  const critResPct = clamp((base.wis * tunables.stats.critResPerWis) + gearCritRes, 0, 40);

  const speedPre = tunables.stats.speedBase + (base.dex * tunables.stats.speedPerDex) + gearSpeed;

  const hp = Math.max(1, Math.floor(applyPct(hpPre, pct.hp ?? pct.hp_max ?? 0)));
  const mp = Math.max(0, Math.floor(applyPct(mpPre, pct.mp ?? pct.mp_max ?? pct.power_max ?? 0)));

  const atk = Math.max(0, Math.floor(applyPct(atkPre, pct.atk ?? 0)));
  const matk = Math.max(0, Math.floor(applyPct(matkPre, pct.matk ?? pct.spell_power ?? 0)));

  const def = Math.max(
    0,
    Math.floor(
      applyDiminishing(
        applyPct(defPre, pct.def ?? pct.armor ?? 0),
        tunables.diminishingReturns.defenseSoftCap,
        tunables.diminishingReturns.defenseHardCap,
        tunables.diminishingReturns.overflowSlope,
      ),
    ),
  );

  const mdef = Math.max(
    0,
    Math.floor(
      applyDiminishing(
        applyPct(mdefPre, pct.mdef ?? pct.res ?? 0),
        tunables.diminishingReturns.mdefSoftCap,
        tunables.diminishingReturns.mdefHardCap,
        tunables.diminishingReturns.overflowSlope,
      ),
    ),
  );

  const acc = Math.max(1, Math.floor(applyPct(accPre, pct.acc ?? pct.accuracy ?? 0)));
  const eva = Math.max(0, Math.floor(applyPct(evaPre, pct.eva ?? pct.evasion ?? 0)));
  const speed = Math.floor(clamp(applyPct(speedPre, pct.speed ?? pct.spd ?? 0), tunables.caps.speedMin, tunables.caps.speedMax));

  const crit = clamp(safePct(critPct) + safePct(pct.crit ?? 0), tunables.caps.critChanceMin, tunables.caps.critChanceMax);
  const critRes = clamp(safePct(critResPct) + safePct(pct.critRes ?? pct.crit_res ?? 0), 0, 0.7);

  const resRaw = clamp((base.wis * 0.003) + safePct(flat.res ?? 0) + safePct(pct.res ?? 0), tunables.caps.resistMin, tunables.caps.resistMax);
  const res = clamp(
    applyDiminishing(
      resRaw,
      tunables.diminishingReturns.resistSoftCap,
      tunables.diminishingReturns.resistHardCap,
      tunables.diminishingReturns.overflowSlope,
    ),
    tunables.caps.resistMin,
    tunables.caps.resistMax,
  );

  const healBonus = clamp((base.wis * tunables.stats.healBonusPerWis) + gearHealBonus + safePct(pct.healBonus ?? 0), 0, 2);
  const barrier = Math.max(0, Math.floor(tunables.stats.barrierBase + gearBarrier));

  const derived: DerivedStats = {
    hp,
    mp,
    atk,
    def,
    matk,
    mdef,
    acc,
    eva,
    crit,
    critRes,
    res,
    speed,
    healBonus,
    barrier,
  };

  const resistances = mergedResistances(
    args.resistances ?? {
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
    },
    flat,
    tunables,
    base,
  );

  return { derived, resistances };
}

export function recomputeActorStats(actor: Actor, tunables: RuleTunables = DEFAULT_RULE_TUNABLES): Actor {
  const equippedItems = Object.values(actor.equipment ?? {});
  const { flat, pct } = aggregateEquipmentStats(equippedItems);
  const leveledBase = growBaseStats(actor.statsBase, actor.statsGrowth, actor.level);
  const computed = deriveStats({
    level: actor.level,
    base: leveledBase,
    equipmentFlat: flat,
    equipmentPct: pct,
    resistances: actor.resistances,
    tunables,
  });
  return {
    ...actor,
    statsBase: leveledBase,
    statsDerived: computed.derived,
    resistances: computed.resistances,
    barrier: computed.derived.barrier,
  };
}

export function baseStatsFromMythicLens(stats: {
  offense: number;
  defense: number;
  control: number;
  support: number;
  mobility: number;
  utility?: number;
}): BaseStats {
  const utility = num(stats.utility, stats.support);
  return {
    str: Math.max(1, Math.floor(stats.offense)),
    vit: Math.max(1, Math.floor(stats.defense)),
    int: Math.max(1, Math.floor(stats.control)),
    wis: Math.max(1, Math.floor((stats.support + utility) / 2)),
    dex: Math.max(1, Math.floor(stats.mobility)),
  };
}
