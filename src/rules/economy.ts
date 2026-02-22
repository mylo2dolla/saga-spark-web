import { DEFAULT_RULE_TUNABLES, type RuleTunables } from "@/rules/constants";
import { generateLootItem, rollRarity } from "@/rules/loot";
import type { EconomyContext, EquipmentSlot, Item, RarityKey } from "@/rules/schema";

export interface ShopStockEntry {
  item: Item;
  buyPrice: number;
  sellPrice: number;
}

const BIOME_SLOT_BIAS: Record<string, Partial<Record<EquipmentSlot, number>>> = {
  forest: { weapon: 1.2, accessory1: 1.15, accessory2: 1.1 },
  desert: { head: 1.2, chest: 1.15, legs: 1.1 },
  mountain: { chest: 1.2, offhand: 1.15, weapon: 1.05 },
  coast: { accessory1: 1.2, accessory2: 1.2, offhand: 1.1 },
  ruins: { weapon: 1.2, offhand: 1.1, head: 1.05 },
  town: { weapon: 1, offhand: 1, head: 1, chest: 1, legs: 1, accessory1: 1, accessory2: 1 },
};

const FACTION_RARITY_BIAS: Record<string, Partial<Record<RarityKey, number>>> = {
  artisans: { uncommon: 1.15, rare: 1.1 },
  wardens: { rare: 1.2, epic: 1.1 },
  mystics: { epic: 1.2, legendary: 1.1 },
  freebooters: { common: 1.2, uncommon: 1.1 },
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

function slotWeightsForBiome(biome: string, tunables: RuleTunables): Record<EquipmentSlot, number> {
  const base = { ...tunables.loot.slotBaseWeights };
  const bias = BIOME_SLOT_BIAS[biome.toLowerCase()] ?? BIOME_SLOT_BIAS.town;
  for (const [slot, factor] of Object.entries(bias)) {
    base[slot as EquipmentSlot] = (base[slot as EquipmentSlot] ?? 1) * Number(factor);
  }
  return base;
}

function pickSlot(seed: number, label: string, weights: Record<EquipmentSlot, number>): EquipmentSlot {
  const entries = Object.entries(weights) as Array<[EquipmentSlot, number]>;
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (total <= 0) return "weapon";
  const roll = seeded01(seed, label) * total;
  let cursor = 0;
  for (const [slot, weight] of entries) {
    cursor += Math.max(0, weight);
    if (roll <= cursor) return slot;
  }
  return entries[entries.length - 1]![0];
}

function rarityWithFactionBias(args: {
  seed: number;
  label: string;
  faction: string;
  tunables: RuleTunables;
}): RarityKey {
  const bias = FACTION_RARITY_BIAS[args.faction.toLowerCase()] ?? {};
  const weights = { ...args.tunables.loot.rarityWeights };
  for (const [rarity, factor] of Object.entries(bias)) {
    weights[rarity as RarityKey] = (weights[rarity as RarityKey] ?? 0) * Number(factor);
  }

  const total = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0);
  let cursor = 0;
  const roll = seeded01(args.seed, args.label) * total;
  for (const rarity of Object.keys(weights) as RarityKey[]) {
    cursor += Math.max(0, weights[rarity]);
    if (roll <= cursor) return rarity;
  }
  return rollRarity(args.seed, args.label, args.tunables);
}

export function inflationMultiplier(context: Pick<EconomyContext, "act" | "chapter">, tunables: RuleTunables = DEFAULT_RULE_TUNABLES): number {
  const act = Math.max(0, Math.floor(context.act));
  const chapter = Math.max(0, Math.floor(context.chapter));
  return 1 + (act * tunables.economy.inflationPerAct) + (chapter * tunables.economy.inflationPerChapter);
}

export function computeBuyPrice(args: {
  item: Pick<Item, "rarity" | "levelReq" | "valueBuy">;
  context: EconomyContext;
  tunables?: RuleTunables;
}): number {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const rarityMult = tunables.loot.rarityPriceMult[args.item.rarity] ?? 1;
  const levelMult = 1 + (Math.max(1, args.item.levelReq) * tunables.economy.levelPriceScale);
  const inflation = inflationMultiplier(args.context, tunables);
  const base = Math.max(1, Math.floor(args.item.valueBuy * tunables.economy.buyBaseMultiplier));
  return Math.max(1, Math.floor(base * rarityMult * levelMult * inflation));
}

export function computeSellPrice(args: {
  buyPrice: number;
  tunables?: RuleTunables;
}): number {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  return Math.max(1, Math.floor(args.buyPrice * tunables.economy.sellRate));
}

export function generateShopInventory(args: {
  seed: number;
  level: number;
  count: number;
  context: EconomyContext;
  tunables?: RuleTunables;
}): ShopStockEntry[] {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const level = Math.max(1, Math.floor(args.level));
  const count = Math.max(1, Math.floor(args.count));
  const weights = slotWeightsForBiome(args.context.biome, tunables);

  const stock: ShopStockEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    const rarity = rarityWithFactionBias({
      seed: args.seed,
      label: `shop:${i}:rarity`,
      faction: args.context.faction,
      tunables,
    });
    const slot = pickSlot(args.seed, `shop:${i}:slot`, weights);
    const item = generateLootItem({
      seed: args.seed,
      label: `shop:${i}:${slot}:${rarity}`,
      level,
      rarity,
      slot,
      tunables,
    });
    const buyPrice = computeBuyPrice({ item, context: args.context, tunables });
    const sellPrice = computeSellPrice({ buyPrice, tunables });

    stock.push({
      item: {
        ...item,
        valueBuy: buyPrice,
        valueSell: sellPrice,
      },
      buyPrice,
      sellPrice,
    });
  }

  return stock;
}
