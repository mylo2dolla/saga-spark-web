import { DEFAULT_RULE_TUNABLES, type RuleTunables } from "@/rules/constants";
import type {
  Actor,
  CompareDiffEntry,
  EquipmentSlot,
  Item,
  ItemComparison,
  StatFlatMods,
} from "@/rules/schema";
import { aggregateEquipmentStats, deriveStats, growBaseStats } from "@/rules/stats";

export interface SetBonusDefinition {
  setTag: string;
  twoPiece?: StatFlatMods;
  threePiece?: StatFlatMods;
}

export const DEFAULT_SET_BONUSES: SetBonusDefinition[] = [
  {
    setTag: "stormcaller",
    twoPiece: { speed: 4, acc: 6 },
    threePiece: { speed: 8, acc: 10, lightning: 0.08 },
  },
  {
    setTag: "oakguard",
    twoPiece: { def: 8, hp: 24 },
    threePiece: { def: 16, hp: 60, stun: 0.1 },
  },
];

export interface EquipValidation {
  ok: boolean;
  reason: string | null;
}

export function canEquipItem(args: {
  actor: Pick<Actor, "level" | "classTags">;
  item: Item;
}): EquipValidation {
  if (args.actor.level < args.item.levelReq) {
    return { ok: false, reason: `Requires level ${args.item.levelReq}.` };
  }

  if (args.item.classTags.length > 0) {
    const hasTag = args.item.classTags.some((tag) => args.actor.classTags.includes(tag));
    if (!hasTag) {
      return { ok: false, reason: `Requires class tag: ${args.item.classTags.join(", ")}` };
    }
  }

  return { ok: true, reason: null };
}

export function applySetBonuses(args: {
  equipment: Record<EquipmentSlot, Item | null>;
  setBonuses?: SetBonusDefinition[];
}): StatFlatMods {
  const counts = new Map<string, number>();
  for (const item of Object.values(args.equipment)) {
    if (!item?.setTag) continue;
    counts.set(item.setTag, (counts.get(item.setTag) ?? 0) + 1);
  }

  const total: StatFlatMods = {};
  const definitions = args.setBonuses ?? DEFAULT_SET_BONUSES;
  for (const definition of definitions) {
    const count = counts.get(definition.setTag) ?? 0;
    if (count >= 2 && definition.twoPiece) {
      for (const [key, value] of Object.entries(definition.twoPiece)) {
        total[key] = (total[key] ?? 0) + Number(value);
      }
    }
    if (count >= 3 && definition.threePiece) {
      for (const [key, value] of Object.entries(definition.threePiece)) {
        total[key] = (total[key] ?? 0) + Number(value);
      }
    }
  }

  return total;
}

function normalizeEquipment(
  equipment: Partial<Record<EquipmentSlot, Item | null>> | undefined,
): Record<EquipmentSlot, Item | null> {
  return {
    weapon: equipment?.weapon ?? null,
    offhand: equipment?.offhand ?? null,
    head: equipment?.head ?? null,
    chest: equipment?.chest ?? null,
    legs: equipment?.legs ?? null,
    accessory1: equipment?.accessory1 ?? null,
    accessory2: equipment?.accessory2 ?? null,
  };
}

export function aggregateEquippedStats(args: {
  equipment: Partial<Record<EquipmentSlot, Item | null>>;
  setBonuses?: SetBonusDefinition[];
}): { flat: StatFlatMods; pct: Record<string, number> } {
  const normalized = normalizeEquipment(args.equipment);
  const itemStats = aggregateEquipmentStats(Object.values(normalized));
  const setBonusStats = applySetBonuses({ equipment: normalized, setBonuses: args.setBonuses });

  const flat = { ...itemStats.flat };
  for (const [key, value] of Object.entries(setBonusStats)) {
    flat[key] = (flat[key] ?? 0) + Number(value);
  }

  return {
    flat,
    pct: itemStats.pct,
  };
}

export function recomputeWithEquipment(args: {
  actor: Actor;
  tunables?: RuleTunables;
  setBonuses?: SetBonusDefinition[];
}): Actor {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const equipment = normalizeEquipment(args.actor.equipment);
  const aggregated = aggregateEquippedStats({ equipment, setBonuses: args.setBonuses });
  const leveledBase = growBaseStats(args.actor.statsBase, args.actor.statsGrowth, args.actor.level);
  const computed = deriveStats({
    level: args.actor.level,
    base: leveledBase,
    equipmentFlat: aggregated.flat,
    equipmentPct: aggregated.pct,
    resistances: args.actor.resistances,
    tunables,
  });

  return {
    ...args.actor,
    statsBase: leveledBase,
    statsDerived: computed.derived,
    resistances: computed.resistances,
    equipment,
  };
}

export function compareItem(current: Item | null, candidate: Item): ItemComparison {
  const keys = new Set<string>([
    ...Object.keys(current?.statsFlat ?? {}),
    ...Object.keys(candidate.statsFlat ?? {}),
  ]);
  const diffs: CompareDiffEntry[] = [];
  let scoreDelta = 0;

  for (const key of keys) {
    const now = Number(current?.statsFlat[key] ?? 0);
    const next = Number(candidate.statsFlat[key] ?? 0);
    const delta = next - now;
    if (Math.abs(delta) < 0.0001) continue;
    diffs.push({
      key,
      current: now,
      candidate: next,
      delta,
    });

    const weight = key.includes("res") ? 1.1
      : key === "hp" || key === "def" || key === "mdef" ? 1.25
      : key === "atk" || key === "matk" ? 1.35
      : key === "acc" || key === "eva" ? 1.15
      : key === "speed" ? 1.2
      : 1;
    scoreDelta += delta * weight;
  }

  diffs.sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

  return {
    slot: candidate.slot,
    scoreDelta,
    better: scoreDelta >= 0,
    diffs,
    summary: scoreDelta >= 0
      ? `Upgrade score +${scoreDelta.toFixed(1)}`
      : `Downgrade score ${scoreDelta.toFixed(1)}`,
  };
}

export function equipItem(args: {
  actor: Actor;
  item: Item;
  slot?: EquipmentSlot;
  tunables?: RuleTunables;
  setBonuses?: SetBonusDefinition[];
}): { actor: Actor; replaced: Item | null; validation: EquipValidation } {
  const validation = canEquipItem({ actor: args.actor, item: args.item });
  if (!validation.ok) {
    return { actor: args.actor, replaced: null, validation };
  }

  const slot = args.slot ?? args.item.slot;
  const equipment = normalizeEquipment(args.actor.equipment);
  const replaced = equipment[slot] ?? null;
  equipment[slot] = args.item;

  const actor = recomputeWithEquipment({
    actor: {
      ...args.actor,
      equipment,
    },
    tunables: args.tunables,
    setBonuses: args.setBonuses,
  });

  return {
    actor,
    replaced,
    validation,
  };
}
