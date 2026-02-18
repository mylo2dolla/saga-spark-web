export type StatTotals = Record<string, number>;

export interface MythicItemRow {
  id: string;
  name: string;
  slot: string;
  stat_mods: Record<string, unknown>;
  effects_json: Record<string, unknown>;
  rarity: string;
}

export interface MythicInventoryRow {
  id: string;
  container: "backpack" | "equipment";
  equip_slot: string | null;
  quantity: number;
  item: MythicItemRow | null;
}

export function sumStatMods(items: Array<MythicItemRow | null | undefined>): StatTotals {
  const totals: StatTotals = {};
  for (const item of items) {
    if (!item) continue;
    const mods = item.stat_mods ?? {};
    for (const [key, value] of Object.entries(mods)) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      totals[key] = (totals[key] ?? 0) + n;
    }
  }
  return totals;
}

export function splitInventory(rows: MythicInventoryRow[]) {
  const equipment = rows.filter((r) => r.container === "equipment");
  const backpack = rows.filter((r) => r.container === "backpack");
  return { equipment, backpack };
}

export function getGrantedAbilities(item: MythicItemRow | null): string[] {
  if (!item) return [];
  const effects = item.effects_json ?? {};
  const list = effects.abilities_granted;
  if (Array.isArray(list)) {
    return list.map((x) => String(x)).filter((x) => x.length > 0);
  }
  return [];
}
