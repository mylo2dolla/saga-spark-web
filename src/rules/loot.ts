import { DEFAULT_RULE_TUNABLES, type RuleTunables } from "@/rules/constants";
import type {
  EquipmentSlot,
  Item,
  ItemAffix,
  LootRollContext,
  RarityKey,
} from "@/rules/schema";

interface WeightedEntry<T> {
  item: T;
  weight: number;
}

const PREFIX_POOL: Array<Omit<ItemAffix, "id">> = [
  { label: "of Power", kind: "suffix", statsFlat: { atk: 6 }, statsPct: {}, tags: ["offense"] },
  { label: "of Fortitude", kind: "suffix", statsFlat: { hp: 24 }, statsPct: {}, tags: ["survival"] },
  { label: "of Focus", kind: "suffix", statsFlat: { mp: 18 }, statsPct: {}, tags: ["casting"] },
  { label: "of Swiftness", kind: "suffix", statsFlat: { speed: 4 }, statsPct: {}, tags: ["tempo"] },
  { label: "of Precision", kind: "suffix", statsFlat: { acc: 8 }, statsPct: {}, tags: ["accuracy"] },
  { label: "of Evasion", kind: "suffix", statsFlat: { eva: 7 }, statsPct: {}, tags: ["avoidance"] },
  { label: "of Ember Guard", kind: "suffix", statsFlat: { fire: 0.06 }, statsPct: {}, tags: ["resist", "fire"] },
  { label: "of Frost Guard", kind: "suffix", statsFlat: { ice: 0.06 }, statsPct: {}, tags: ["resist", "ice"] },
  { label: "of Storm Guard", kind: "suffix", statsFlat: { lightning: 0.06 }, statsPct: {}, tags: ["resist", "lightning"] },
  { label: "of Verdant Antidote", kind: "suffix", statsFlat: { poison: 0.06 }, statsPct: {}, tags: ["resist", "poison"] },
];

const BASE_ITEM_NAMES: Record<EquipmentSlot, string[]> = {
  weapon: ["Oak Wand", "Steel Sword", "Sunlit Spear", "Clockwork Hammer", "Pebble Launcher"],
  offhand: ["Round Buckler", "Whistle Shield", "Lantern Tome", "Kettle Lid"],
  head: ["Feather Cap", "Scout Hood", "Brass Helm", "Lucky Bucket"],
  chest: ["Traveler Coat", "Chain Shirt", "Patchwork Vest", "Festival Armor"],
  legs: ["Trail Greaves", "Sturdy Slacks", "Moonstep Leggings", "Wobble Pants"],
  accessory1: ["Star Ring", "Compass Charm", "Jelly Brooch", "Pocket Planet"],
  accessory2: ["Breeze Ring", "Ribbon Charm", "Wisp Token", "Fizz Locket"],
};

const RARITY_FLOURISH: Record<RarityKey, string[]> = {
  common: ["", "", ""],
  uncommon: ["", "", "Bright"],
  rare: ["Glimmering", "Sparkly", "Curious"],
  epic: ["Radiant", "Whimsical", "Arc-bloom"],
  legendary: ["Grand", "Heroic", "Starbound"],
  mythic: ["Impossible", "Storybook", "World-tilting"],
};

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

function pickWeighted<T>(seed: number, label: string, entries: WeightedEntry<T>[]): T {
  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  if (total <= 0) return entries[0]!.item;
  const roll = seeded01(seed, label) * total;
  let cursor = 0;
  for (const entry of entries) {
    cursor += Math.max(0, entry.weight);
    if (roll <= cursor) return entry.item;
  }
  return entries[entries.length - 1]!.item;
}

function rarityScore(rarity: RarityKey): number {
  switch (rarity) {
    case "common": return 1;
    case "uncommon": return 2;
    case "rare": return 3;
    case "epic": return 4;
    case "legendary": return 5;
    case "mythic": return 6;
    default: return 1;
  }
}

export function rollRarity(seed: number, label: string, tunables: RuleTunables = DEFAULT_RULE_TUNABLES): RarityKey {
  const entries: WeightedEntry<RarityKey>[] = Object.entries(tunables.loot.rarityWeights)
    .map(([item, weight]) => ({ item: item as RarityKey, weight }));
  return pickWeighted(seed, label, entries);
}

function pickSlot(args: {
  seed: number;
  label: string;
  tunables: RuleTunables;
  preferredSlots: EquipmentSlot[];
  equippedScores: Partial<Record<EquipmentSlot, number>>;
  chosenSlots: EquipmentSlot[];
}): EquipmentSlot {
  const maxScore = Math.max(1, ...Object.values(args.equippedScores).map((value) => Number(value ?? 0)));
  const entries: WeightedEntry<EquipmentSlot>[] = Object.entries(args.tunables.loot.slotBaseWeights).map(([slot, baseWeight]) => {
    const typedSlot = slot as EquipmentSlot;
    let weight = baseWeight;
    if (args.preferredSlots.includes(typedSlot)) {
      weight *= args.tunables.loot.smartDropUsableBonus;
    }
    const score = Number(args.equippedScores[typedSlot] ?? maxScore);
    const undergearedRatio = Math.max(0, (maxScore - score) / maxScore);
    weight *= 1 + (undergearedRatio * (args.tunables.loot.smartDropUndergearedBonus - 1));
    if (args.chosenSlots.includes(typedSlot)) {
      weight *= args.tunables.loot.duplicateAvoidancePenalty;
    }
    return { item: typedSlot, weight };
  });

  return pickWeighted(args.seed, args.label, entries);
}

function scaledAffixValue(args: {
  seed: number;
  label: string;
  base: number;
  itemLevel: number;
  rarity: RarityKey;
  tunables: RuleTunables;
}): number {
  const rarityMult = rarityScore(args.rarity);
  const jitter = 0.9 + (seeded01(args.seed, `${args.label}:jitter`) * 0.2);
  const value = args.base * (1 + (args.itemLevel * 0.06)) * (1 + (rarityMult * 0.14)) * jitter;
  return Math.max(1, Math.floor(value));
}

function rollAffix(args: {
  seed: number;
  label: string;
  itemLevel: number;
  rarity: RarityKey;
  tunables: RuleTunables;
  usedLabels: Set<string>;
}): ItemAffix {
  let attempt = 0;
  while (attempt < 20) {
    const template = PREFIX_POOL[Math.floor(seeded01(args.seed, `${args.label}:affix:${attempt}`) * PREFIX_POOL.length)] ?? PREFIX_POOL[0]!;
    if (args.usedLabels.has(template.label)) {
      attempt += 1;
      continue;
    }
    args.usedLabels.add(template.label);
    const statsFlat: Record<string, number> = {};
    for (const [key, value] of Object.entries(template.statsFlat)) {
      const scaled = typeof value === "number" && value < 1
        ? Number((value + (args.itemLevel * 0.0008) + (rarityScore(args.rarity) * 0.004)).toFixed(4))
        : scaledAffixValue({
          seed: args.seed,
          label: `${args.label}:${key}`,
          base: Number(value),
          itemLevel: args.itemLevel,
          rarity: args.rarity,
          tunables: args.tunables,
        });
      statsFlat[key] = scaled;
    }

    return {
      id: `${template.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${args.itemLevel}-${args.rarity}-${attempt}`,
      label: template.label,
      kind: template.kind,
      statsFlat,
      statsPct: { ...template.statsPct },
      tags: [...template.tags],
    };
  }

  return {
    id: `fallback-affix-${args.itemLevel}-${args.rarity}`,
    label: "of Bonking",
    kind: "suffix",
    statsFlat: { atk: Math.max(1, Math.floor(args.itemLevel * 0.6)) },
    statsPct: {},
    tags: ["offense"],
  };
}

function nameForItem(args: {
  seed: number;
  label: string;
  slot: EquipmentSlot;
  rarity: RarityKey;
  affixes: ItemAffix[];
}): string {
  const basePool = BASE_ITEM_NAMES[args.slot];
  const base = basePool[Math.floor(seeded01(args.seed, `${args.label}:base`) * basePool.length)] ?? basePool[0]!;
  const primaryAffix = args.affixes[0]?.label ?? "of Sparkles";
  const flourishPool = RARITY_FLOURISH[args.rarity];
  const flourish = flourishPool[Math.floor(seeded01(args.seed, `${args.label}:flourish`) * flourishPool.length)] ?? "";
  if (!flourish) return `${base} ${primaryAffix}`.replace(/\s+/g, " ").trim();
  return `${flourish} ${base} ${primaryAffix}`.replace(/\s+/g, " ").trim();
}

function combineStats(base: Record<string, number>, affixes: ItemAffix[]): Record<string, number> {
  const stats = { ...base };
  for (const affix of affixes) {
    for (const [key, value] of Object.entries(affix.statsFlat ?? {})) {
      stats[key] = Number(((stats[key] ?? 0) + Number(value)).toFixed(4));
    }
  }
  return stats;
}

export function generateLootItem(args: {
  seed: number;
  label: string;
  level: number;
  rarity: RarityKey;
  slot: EquipmentSlot;
  tunables?: RuleTunables;
}): Item {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const level = Math.max(1, Math.floor(args.level));
  const rarityBudget = tunables.loot.rarityStatBudget[args.rarity];
  const affixCount = Math.max(0, tunables.loot.affixCountByRarity[args.rarity]);

  const baseStats: Record<string, number> = {
    hp: Math.max(0, Math.floor(level * 0.9)),
  };
  if (args.slot === "weapon") {
    baseStats.atk = Math.max(1, Math.floor(rarityBudget * 0.5 + (level * 1.2)));
  } else if (args.slot === "offhand") {
    baseStats.def = Math.max(1, Math.floor(rarityBudget * 0.35 + (level * 0.8)));
  } else if (args.slot === "head" || args.slot === "chest" || args.slot === "legs") {
    baseStats.def = Math.max(1, Math.floor(rarityBudget * 0.3 + (level * 0.9)));
    baseStats.mdef = Math.max(1, Math.floor(rarityBudget * 0.22 + (level * 0.7)));
  } else {
    baseStats.mp = Math.max(0, Math.floor(rarityBudget * 0.45 + (level * 0.7)));
  }

  const usedLabels = new Set<string>();
  const affixes: ItemAffix[] = [];
  for (let i = 0; i < affixCount; i += 1) {
    affixes.push(
      rollAffix({
        seed: args.seed,
        label: `${args.label}:affix:${i}`,
        itemLevel: level,
        rarity: args.rarity,
        tunables,
        usedLabels,
      }),
    );
  }

  const statsFlat = combineStats(baseStats, affixes);
  const valueBuy = Math.max(
    1,
    Math.floor((rarityBudget + (level * 2.4)) * tunables.loot.rarityPriceMult[args.rarity]),
  );
  const valueSell = Math.max(1, Math.floor(valueBuy * tunables.economy.sellRate));

  return {
    id: `${args.slot}-${args.rarity}-${level}-${hash32(`${args.seed}:${args.label}`)}`,
    name: nameForItem({
      seed: args.seed,
      label: args.label,
      slot: args.slot,
      rarity: args.rarity,
      affixes,
    }),
    slot: args.slot,
    rarity: args.rarity,
    levelReq: Math.max(1, level - 1),
    statsFlat,
    statsPct: {},
    affixes,
    classTags: [],
    setTag: null,
    icon: null,
    valueBuy,
    valueSell,
    locked: false,
    favorite: false,
  };
}

export function generateLootBatch(context: LootRollContext & {
  tunables?: RuleTunables;
}): {
  items: Item[];
  rarityCounts: Record<RarityKey, number>;
  gold: number;
} {
  const tunables = context.tunables ?? DEFAULT_RULE_TUNABLES;
  const preferredSlots = context.preferredSlots ?? [];
  const equippedScores = context.equippedScores ?? {};
  const avoid = new Set((context.avoidItemIds ?? []).map((entry) => entry.trim()).filter(Boolean));

  const items: Item[] = [];
  const chosenSlots: EquipmentSlot[] = [];
  const rarityCounts: Record<RarityKey, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    mythic: 0,
  };

  for (let idx = 0; idx < Math.max(1, Math.floor(context.count)); idx += 1) {
    const rarity = rollRarity(context.seed, `loot:${idx}:rarity`, tunables);
    rarityCounts[rarity] += 1;
    const slot = pickSlot({
      seed: context.seed,
      label: `loot:${idx}:slot`,
      tunables,
      preferredSlots,
      equippedScores,
      chosenSlots,
    });
    chosenSlots.push(slot);

    let item = generateLootItem({
      seed: context.seed,
      label: `loot:${idx}:${slot}:${rarity}`,
      level: context.actorLevel,
      rarity,
      slot,
      tunables,
    });

    let dedupeAttempt = 0;
    while (avoid.has(item.id) && dedupeAttempt < 6) {
      item = generateLootItem({
        seed: context.seed + dedupeAttempt + 1,
        label: `loot:${idx}:${slot}:${rarity}:reroll:${dedupeAttempt}`,
        level: context.actorLevel,
        rarity,
        slot,
        tunables,
      });
      dedupeAttempt += 1;
    }

    avoid.add(item.id);
    items.push(item);
  }

  const gold = generateGoldDrop({
    seed: context.seed,
    level: context.actorLevel,
    rarityCounts,
    tunables,
  });

  return { items, rarityCounts, gold };
}

export function generateGoldDrop(args: {
  seed: number;
  level: number;
  rarityCounts: Record<RarityKey, number>;
  tunables?: RuleTunables;
}): number {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const level = Math.max(1, Math.floor(args.level));
  const rarityBonus =
    (args.rarityCounts.uncommon * 2)
    + (args.rarityCounts.rare * 4)
    + (args.rarityCounts.epic * 7)
    + (args.rarityCounts.legendary * 11)
    + (args.rarityCounts.mythic * 18);
  const variance = 0.8 + (seeded01(args.seed, "gold") * 0.4);
  return Math.max(1, Math.floor((tunables.loot.goldDropBase + (level * tunables.loot.goldDropPerLevel) + rarityBonus) * variance));
}

export function rarityDistributionFromSamples(samples: Item[]): Record<RarityKey, number> {
  const counts: Record<RarityKey, number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    mythic: 0,
  };
  for (const item of samples) {
    counts[item.rarity] += 1;
  }
  return counts;
}
