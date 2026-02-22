import { rngInt, rngPick, weightedPick } from "./mythic_rng.js";

export const LOOT_RARITIES = ["common", "magical", "unique", "legendary", "mythic", "unhinged"] as const;
export type LootRarity = typeof LOOT_RARITIES[number];

const BUDGETS: Record<LootRarity, number> = {
  common: 8,
  magical: 16,
  unique: 24,
  legendary: 40,
  mythic: 60,
  unhinged: 70,
};

const PREFIXES = ["Spark", "Moon", "Storm", "Lantern", "Star", "Frost", "Ember", "Clover", "Sun", "Rainbow"];
const SUFFIXES = ["Burst", "Ward", "Lance", "Nova", "Bloom", "Breaker", "Halo", "Howl", "Glint", "Arc"];
const SLOT_POOL = ["weapon", "armor", "helm", "gloves", "boots", "belt", "amulet", "ring", "trinket"] as const;
const ITEM_TYPES = ["gear", "artifact", "relic"] as const;
const WEAPON_FAMILIES = ["blades", "axes", "blunt", "polearms", "ranged", "focus", "body", "absurd"] as const;

export function rarityBudget(rarity: LootRarity): number {
  return BUDGETS[rarity];
}

export function pickLootRarity(seed: number, label: string, level: number): LootRarity {
  const late = Math.max(0, level - 25);
  return weightedPick(seed, label, [
    { item: "common" as const, weight: Math.max(5, 65 - late) },
    { item: "magical" as const, weight: Math.max(10, 26 + Math.floor(late * 0.3)) },
    { item: "unique" as const, weight: Math.max(6, 8 + Math.floor(late * 0.25)) },
    { item: "legendary" as const, weight: Math.max(2, Math.floor(level / 12)) },
    { item: "mythic" as const, weight: Math.max(1, Math.floor(level / 20)) },
    { item: "unhinged" as const, weight: level >= 70 ? 1 : 0 },
  ]);
}

export function rarityTier(rarity: LootRarity): "common" | "elite" | "boss" | "mythic" | "event" {
  if (rarity === "common" || rarity === "magical") return "common";
  if (rarity === "unique") return "elite";
  if (rarity === "legendary") return "boss";
  if (rarity === "mythic") return "mythic";
  return "event";
}

export interface RollLootItemArgs {
  seed: number;
  label: string;
  level: number;
  rarity: LootRarity;
  classRole: string;
  weaponFamilyHint: string | null;
  campaignId: string;
  characterId: string;
  source: string;
  narrativeHook?: string;
}

export function rollLootItem(args: RollLootItemArgs): Record<string, unknown> {
  const { seed, label, level, rarity, classRole, weaponFamilyHint, campaignId, characterId, source, narrativeHook } = args;
  const budget = BUDGETS[rarity];

  const slot = weightedPick(seed, `${label}:slot`, SLOT_POOL.map((s) => {
    if ((classRole === "tank" || classRole === "support") && (s === "armor" || s === "helm" || s === "belt")) return { item: s, weight: 8 };
    if ((classRole === "dps" || classRole === "skirmisher") && (s === "weapon" || s === "ring" || s === "trinket")) return { item: s, weight: 8 };
    if (classRole === "controller" && (s === "weapon" || s === "amulet" || s === "trinket")) return { item: s, weight: 7 };
    return { item: s, weight: 4 };
  }));

  const statKeys = ["offense", "defense", "control", "support", "mobility", "utility"];
  const statCount = Math.max(1, Math.min(4, Math.floor(budget / 16) + 1));
  const statMods: Record<string, number> = {};
  for (let i = 0; i < statCount; i += 1) {
    const key = rngPick(seed, `${label}:stat:${i}`, statKeys);
    const roll = rngInt(seed, `${label}:roll:${key}:${i}`, 1, Math.max(2, Math.floor(budget / 3)));
    statMods[key] = (statMods[key] ?? 0) + roll;
  }

  if (slot === "weapon") {
    statMods.weapon_power = rngInt(seed, `${label}:weapon_power`, 2, Math.max(5, Math.floor(level / 2) + Math.floor(budget / 5)));
  } else if (slot === "armor" || slot === "helm" || slot === "gloves" || slot === "boots" || slot === "belt") {
    statMods.armor_power = rngInt(seed, `${label}:armor_power`, 1, Math.max(4, Math.floor(level / 3) + Math.floor(budget / 6)));
    statMods.resist = rngInt(seed, `${label}:resist`, 0, Math.max(3, Math.floor(budget / 8)));
    statMods.hp_max = rngInt(seed, `${label}:hp_max`, 0, Math.max(20, budget + level));
  } else if (slot === "ring" || slot === "trinket" || slot === "amulet") {
    statMods.power_max = rngInt(seed, `${label}:power_max`, 5, Math.max(15, Math.floor(level / 2) + budget));
  }

  const name = `${rngPick(seed, `${label}:prefix`, PREFIXES)} ${rngPick(seed, `${label}:suffix`, SUFFIXES)}`;
  const drawback =
    rarity === "legendary" || rarity === "mythic" || rarity === "unhinged"
      ? {
          id: `drawback_${rngPick(seed, `${label}:drawback`, ["overheat", "fragile_focus", "reckless_bloom", "doom_mark"])}`,
          description: "Power spike invites retaliation: faction heat rises and your next defense roll is weaker.",
          world_reaction: true,
        }
      : {};

  const weaponFamily = slot === "weapon"
    ? (weaponFamilyHint && (WEAPON_FAMILIES as readonly string[]).includes(weaponFamilyHint)
      ? weaponFamilyHint
      : rngPick(seed, `${label}:weapon_family`, WEAPON_FAMILIES))
    : null;

  return {
    campaign_id: campaignId,
    owner_character_id: characterId,
    name,
    rarity,
    item_type: rngPick(seed, `${label}:item_type`, ITEM_TYPES),
    slot,
    weapon_family: weaponFamily,
    weapon_profile: slot === "weapon" ? { style: classRole, speed: rngInt(seed, `${label}:speed`, 1, 5) } : {},
    affixes: Object.entries(statMods).map(([k, v]) => ({ key: k, value: v })),
    stat_mods: statMods,
    effects_json: {
      source,
      budget,
      granted_abilities: rarity === "mythic" || rarity === "unhinged" ? [`mythic_proc_${slot}`] : [],
    },
    drawback_json: drawback,
    narrative_hook: narrativeHook ?? `${name} surfaced after a violent clash and still hums with static malice.`,
    durability_json: {
      current: 100,
      max: 100,
      decay_per_use: rarity === "unhinged" ? 4 : 1,
    },
    required_level: Math.max(1, level - 2),
    item_power: Math.max(1, Math.floor(level * (1 + budget / 40))),
    set_tag: rarity === "mythic" || rarity === "unhinged" ? `${classRole}_ascendant` : null,
    drop_tier: rarityTier(rarity),
    bind_policy: rarity === "common" || rarity === "magical" ? "unbound" : "bind_on_equip",
  };
}
