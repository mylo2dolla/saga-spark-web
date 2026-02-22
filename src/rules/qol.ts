import { DEFAULT_RULE_TUNABLES, type RuleTunables } from "@/rules/constants";
import { compareItem, canEquipItem } from "@/rules/equipment";
import { computeSkillMpCost, computeSkillPower } from "@/rules/skills";
import { recomputeActorStats } from "@/rules/stats";
import type {
  Actor,
  CharacterSheetView,
  CombatLogEntry,
  EquipmentSlot,
  InventoryFilter,
  Item,
  ItemComparison,
} from "@/rules/schema";

export interface QolSettings {
  autoEquipSuggestions: boolean;
  fastAnimations: boolean;
  showNumbers: boolean;
  showTelegraphs: boolean;
  quickCompareOnHover: boolean;
}

export const DEFAULT_QOL_SETTINGS: QolSettings = {
  autoEquipSuggestions: DEFAULT_RULE_TUNABLES.qol.autoEquipEnabledByDefault,
  fastAnimations: DEFAULT_RULE_TUNABLES.qol.fastAnimations,
  showNumbers: DEFAULT_RULE_TUNABLES.qol.showNumbers,
  showTelegraphs: DEFAULT_RULE_TUNABLES.qol.showTelegraphs,
  quickCompareOnHover: DEFAULT_RULE_TUNABLES.qol.quickCompareOnHover,
};

function rarityRank(rarity: Item["rarity"]): number {
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

export function filterInventory(items: Item[], filter: InventoryFilter): Item[] {
  return items.filter((item) => {
    if (filter.slot && item.slot !== filter.slot) return false;
    if (filter.rarity && item.rarity !== filter.rarity) return false;
    if (filter.favoriteOnly && !item.favorite) return false;
    if (filter.unlockedOnly && item.locked) return false;
    if (filter.stat) {
      const key = filter.stat.toLowerCase();
      const hasStat = Object.keys(item.statsFlat).some((entry) => entry.toLowerCase() === key)
        || Object.keys(item.statsPct).some((entry) => entry.toLowerCase() === key)
        || item.affixes.some((affix) => Object.keys(affix.statsFlat).some((entry) => entry.toLowerCase() === key));
      if (!hasStat) return false;
    }
    return true;
  });
}

export function autoSortInventory(items: Item[], ascending = false): Item[] {
  const sorted = [...items];
  sorted.sort((left, right) => {
    if (left.locked !== right.locked) return left.locked ? 1 : -1;
    if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
    const rarityDelta = rarityRank(right.rarity) - rarityRank(left.rarity);
    if (rarityDelta !== 0) return ascending ? -rarityDelta : rarityDelta;
    const levelDelta = right.levelReq - left.levelReq;
    if (levelDelta !== 0) return ascending ? -levelDelta : levelDelta;
    return left.name.localeCompare(right.name);
  });
  return sorted;
}

export function setItemFavorite(item: Item, favorite: boolean): Item {
  return { ...item, favorite };
}

export function setItemLocked(item: Item, locked: boolean): Item {
  return { ...item, locked };
}

export interface AutoEquipSuggestion {
  slot: EquipmentSlot;
  current: Item | null;
  candidate: Item;
  comparison: ItemComparison;
}

export function suggestAutoEquip(args: {
  actor: Actor;
  candidates: Item[];
  enabled?: boolean;
}): AutoEquipSuggestion[] {
  if (!args.enabled) return [];

  const suggestions: AutoEquipSuggestion[] = [];
  const bestBySlot = new Map<EquipmentSlot, AutoEquipSuggestion>();

  for (const candidate of args.candidates) {
    const validation = canEquipItem({ actor: args.actor, item: candidate });
    if (!validation.ok) continue;
    const current = args.actor.equipment[candidate.slot] ?? null;
    const comparison = compareItem(current, candidate);
    if (!comparison.better || comparison.scoreDelta <= 0) continue;

    const existing = bestBySlot.get(candidate.slot);
    if (!existing || comparison.scoreDelta > existing.comparison.scoreDelta) {
      bestBySlot.set(candidate.slot, {
        slot: candidate.slot,
        current,
        candidate,
        comparison,
      });
    }
  }

  for (const suggestion of bestBySlot.values()) {
    suggestions.push(suggestion);
  }

  suggestions.sort((left, right) => right.comparison.scoreDelta - left.comparison.scoreDelta);
  return suggestions;
}

export function quickCompareOnHover(current: Item | null, candidate: Item): ItemComparison {
  return compareItem(current, candidate);
}

export function summarizeLootPickup(args: {
  items: Item[];
  gold: number;
}): {
  title: string;
  lines: string[];
  rarityBreakdown: Record<Item["rarity"], number>;
} {
  const rarityBreakdown: Record<Item["rarity"], number> = {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    mythic: 0,
  };

  for (const item of args.items) {
    rarityBreakdown[item.rarity] += 1;
  }

  const lines = args.items.map((item) => `${item.name} [${item.rarity}]`).slice(0, 8);
  if (args.items.length > 8) {
    lines.push(`...and ${args.items.length - 8} more item(s)`);
  }
  lines.push(`Gold +${Math.max(0, Math.floor(args.gold))}`);

  return {
    title: args.items.length > 0 ? "Loot secured" : "No loot",
    lines,
    rarityBreakdown,
  };
}

export function condenseCombatLog(entries: CombatLogEntry[]): CombatLogEntry[] {
  const condensed: CombatLogEntry[] = [];
  for (const entry of entries) {
    const previous = condensed[condensed.length - 1] ?? null;
    const canGroup =
      previous
      && previous.type === entry.type
      && previous.actorId === entry.actorId
      && previous.targetId === entry.targetId
      && previous.statusId === entry.statusId
      && previous.turn === entry.turn
      && (entry.type === "status_tick" || entry.type === "damage" || entry.type === "heal");

    if (canGroup) {
      previous.amount += entry.amount;
      previous.label = `${previous.label} x2`;
      continue;
    }

    condensed.push({ ...entry });
  }
  return condensed;
}

export function buildCharacterSheetView(args: {
  actor: Actor;
  currentHp?: number;
  currentMp?: number;
  tunables?: RuleTunables;
}): CharacterSheetView {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const actor = recomputeActorStats(args.actor, tunables);
  const maxHp = Math.max(1, Math.floor(actor.statsDerived.hp));
  const maxMp = Math.max(0, Math.floor(actor.statsDerived.mp));
  const currentHp = Math.max(0, Math.min(maxHp, Math.floor(args.currentHp ?? maxHp)));
  const currentMp = Math.max(0, Math.min(maxMp, Math.floor(args.currentMp ?? maxMp)));

  const skills = actor.skillbook.map((skill) => {
    const mpCost = computeSkillMpCost({ skill, actorLevel: actor.level, tunables });
    const power = computeSkillPower({ skill, actor, actorLevel: actor.level, tunables });
    return {
      id: skill.id,
      name: skill.name,
      rank: skill.rank,
      maxRank: skill.maxRank,
      mpCost,
      power,
      summary: `${skill.name} R${skill.rank}/${skill.maxRank} · MP ${mpCost} · Power ${power}`,
    };
  });

  const tooltips: Record<string, string> = {
    hp: "Vitality pool. Reaching 0 means defeat.",
    mp: "Mana/Power used by skills.",
    atk: "Physical attack power before mitigation.",
    matk: "Magical attack power before mitigation.",
    def: "Physical mitigation stat.",
    mdef: "Magical mitigation stat.",
    acc: "Accuracy score for hit chance.",
    eva: "Evasion score opposing hit chance.",
    crit: "Critical hit chance.",
    critRes: "Reduces incoming crit chance.",
    speed: "Turn order and pacing pressure.",
  };

  for (const status of actor.statuses) {
    tooltips[`status:${status.id}`] = `${status.id} · ${status.category} · ${status.remainingTurns} turn(s) · stacks ${status.stacks}`;
  }

  const levelProgress = actor.xpToNext > 0 ? Math.min(1, Math.max(0, actor.xp / actor.xpToNext)) : 1;

  return {
    ruleVersion: tunables.ruleVersion,
    identity: {
      id: actor.id,
      name: actor.name,
      classTags: actor.classTags,
    },
    level: {
      level: actor.level,
      xp: actor.xp,
      xpToNext: actor.xpToNext,
      progressPct: Number((levelProgress * 100).toFixed(2)),
      skillPointsAvailable: actor.skillPointsAvailable,
      statPointsAvailable: actor.statPointsAvailable,
    },
    stats: {
      base: actor.statsBase,
      derived: actor.statsDerived,
      resistances: actor.resistances,
    },
    resources: {
      hp: { current: currentHp, max: maxHp },
      mp: { current: currentMp, max: maxMp },
      barrier: Math.max(0, Math.floor(actor.barrier ?? actor.statsDerived.barrier)),
      coins: actor.coins,
    },
    equipment: [
      { slot: "weapon", item: actor.equipment.weapon ?? null, icon: actor.equipment.weapon?.icon ?? null },
      { slot: "offhand", item: actor.equipment.offhand ?? null, icon: actor.equipment.offhand?.icon ?? null },
      { slot: "head", item: actor.equipment.head ?? null, icon: actor.equipment.head?.icon ?? null },
      { slot: "chest", item: actor.equipment.chest ?? null, icon: actor.equipment.chest?.icon ?? null },
      { slot: "legs", item: actor.equipment.legs ?? null, icon: actor.equipment.legs?.icon ?? null },
      { slot: "accessory1", item: actor.equipment.accessory1 ?? null, icon: actor.equipment.accessory1?.icon ?? null },
      { slot: "accessory2", item: actor.equipment.accessory2 ?? null, icon: actor.equipment.accessory2?.icon ?? null },
    ],
    skills,
    statuses: actor.statuses.map((status) => ({
      id: status.id,
      category: status.category,
      remainingTurns: status.remainingTurns,
      stacks: status.stacks,
      intensity: status.intensity,
      tooltip: tooltips[`status:${status.id}`] ?? status.id,
    })),
    tooltips,
  };
}
