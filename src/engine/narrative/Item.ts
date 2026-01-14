/**
 * Item module - item creation, inventory management, equipment.
 * Pure functions only - no mutations.
 */

import type { 
  Item, 
  ItemType, 
  Rarity, 
  StatModifiers, 
  Inventory, 
  InventorySlot,
  Equipment,
  EquipmentSlot,
  ItemEffect
} from "./types";

// ============= Item Factory =============

let itemIdCounter = 0;

export function createItem(params: {
  id?: string;
  name: string;
  description: string;
  type: ItemType;
  rarity?: Rarity;
  value?: number;
  weight?: number;
  stackable?: boolean;
  maxStack?: number;
  statModifiers?: StatModifiers;
  damage?: string;
  defense?: number;
  storyTags?: string[];
  effects?: ItemEffect[];
  requiresLevel?: number;
}): Item {
  return {
    id: params.id ?? `item_${++itemIdCounter}`,
    name: params.name,
    description: params.description,
    type: params.type,
    rarity: params.rarity ?? "common",
    value: params.value ?? 0,
    weight: params.weight ?? 1,
    stackable: params.stackable ?? false,
    maxStack: params.maxStack ?? 1,
    statModifiers: params.statModifiers ?? {},
    damage: params.damage,
    defense: params.defense,
    storyTags: params.storyTags ?? [],
    effects: params.effects ?? [],
    requiresLevel: params.requiresLevel,
  };
}

// ============= Inventory Management =============

export function createInventory(maxSlots: number = 20, gold: number = 0): Inventory {
  return {
    slots: [],
    maxSlots,
    gold,
  };
}

export function addItemToInventory(
  inventory: Inventory,
  itemId: string,
  quantity: number = 1,
  items: ReadonlyMap<string, Item>
): { inventory: Inventory; added: number; overflow: number } {
  const item = items.get(itemId);
  if (!item) return { inventory, added: 0, overflow: quantity };

  let remaining = quantity;
  const newSlots = [...inventory.slots];

  // Try to stack with existing items
  if (item.stackable) {
    for (let i = 0; i < newSlots.length && remaining > 0; i++) {
      if (newSlots[i].itemId === itemId) {
        const canAdd = Math.min(remaining, item.maxStack - newSlots[i].quantity);
        if (canAdd > 0) {
          newSlots[i] = { ...newSlots[i], quantity: newSlots[i].quantity + canAdd };
          remaining -= canAdd;
        }
      }
    }
  }

  // Add to new slots
  while (remaining > 0 && newSlots.length < inventory.maxSlots) {
    const toAdd = item.stackable ? Math.min(remaining, item.maxStack) : 1;
    newSlots.push({ itemId, quantity: toAdd });
    remaining -= toAdd;
  }

  return {
    inventory: { ...inventory, slots: newSlots },
    added: quantity - remaining,
    overflow: remaining,
  };
}

export function removeItemFromInventory(
  inventory: Inventory,
  itemId: string,
  quantity: number = 1
): { inventory: Inventory; removed: number } {
  let remaining = quantity;
  const newSlots: InventorySlot[] = [];

  for (const slot of inventory.slots) {
    if (slot.itemId === itemId && remaining > 0) {
      const toRemove = Math.min(remaining, slot.quantity);
      remaining -= toRemove;
      if (slot.quantity > toRemove) {
        newSlots.push({ ...slot, quantity: slot.quantity - toRemove });
      }
    } else {
      newSlots.push(slot);
    }
  }

  return {
    inventory: { ...inventory, slots: newSlots },
    removed: quantity - remaining,
  };
}

export function hasItem(inventory: Inventory, itemId: string, quantity: number = 1): boolean {
  let count = 0;
  for (const slot of inventory.slots) {
    if (slot.itemId === itemId) {
      count += slot.quantity;
      if (count >= quantity) return true;
    }
  }
  return false;
}

export function countItem(inventory: Inventory, itemId: string): number {
  let count = 0;
  for (const slot of inventory.slots) {
    if (slot.itemId === itemId) {
      count += slot.quantity;
    }
  }
  return count;
}

export function getInventoryWeight(inventory: Inventory, items: ReadonlyMap<string, Item>): number {
  let weight = 0;
  for (const slot of inventory.slots) {
    const item = items.get(slot.itemId);
    if (item) {
      weight += item.weight * slot.quantity;
    }
  }
  return weight;
}

export function modifyGold(inventory: Inventory, amount: number): Inventory {
  return { ...inventory, gold: Math.max(0, inventory.gold + amount) };
}

// ============= Equipment Management =============

export function createEquipment(): Equipment {
  return {};
}

export function canEquipInSlot(item: Item, slot: EquipmentSlot): boolean {
  const slotToType: Record<EquipmentSlot, ItemType[]> = {
    main_hand: ["weapon"],
    off_hand: ["weapon", "shield"],
    head: ["helmet"],
    chest: ["armor"],
    hands: ["gloves"],
    feet: ["boots"],
    ring_1: ["ring"],
    ring_2: ["ring"],
    amulet: ["amulet"],
  };

  return slotToType[slot]?.includes(item.type) ?? false;
}

export function equipItem(
  equipment: Equipment,
  inventory: Inventory,
  itemId: string,
  slot: EquipmentSlot,
  items: ReadonlyMap<string, Item>
): { equipment: Equipment; inventory: Inventory; success: boolean; unequippedItemId?: string } {
  const item = items.get(itemId);
  if (!item || !canEquipInSlot(item, slot) || !hasItem(inventory, itemId)) {
    return { equipment, inventory, success: false };
  }

  let newInventory = inventory;
  let unequippedItemId: string | undefined;

  // Remove item from inventory
  const removeResult = removeItemFromInventory(newInventory, itemId, 1);
  newInventory = removeResult.inventory;

  // Unequip current item if any
  const currentItemId = equipment[slot];
  if (currentItemId) {
    const addResult = addItemToInventory(newInventory, currentItemId, 1, items);
    newInventory = addResult.inventory;
    unequippedItemId = currentItemId;
  }

  // Equip new item
  const newEquipment = { ...equipment, [slot]: itemId };

  return {
    equipment: newEquipment,
    inventory: newInventory,
    success: true,
    unequippedItemId,
  };
}

export function unequipItem(
  equipment: Equipment,
  inventory: Inventory,
  slot: EquipmentSlot,
  items: ReadonlyMap<string, Item>
): { equipment: Equipment; inventory: Inventory; success: boolean } {
  const itemId = equipment[slot];
  if (!itemId) {
    return { equipment, inventory, success: false };
  }

  // Check if inventory has space
  if (inventory.slots.length >= inventory.maxSlots) {
    return { equipment, inventory, success: false };
  }

  // Add to inventory
  const addResult = addItemToInventory(inventory, itemId, 1, items);
  
  // Remove from equipment
  const newEquipment = { ...equipment };
  delete newEquipment[slot];

  return {
    equipment: newEquipment,
    inventory: addResult.inventory,
    success: true,
  };
}

// ============= Stat Calculation from Equipment =============

export function calculateEquipmentStats(
  equipment: Equipment,
  items: ReadonlyMap<string, Item>
): StatModifiers {
  const result: StatModifiers = {};
  const keys: (keyof StatModifiers)[] = [
    "strength", "dexterity", "constitution", "intelligence", 
    "wisdom", "charisma", "maxHp", "ac", "attackBonus", 
    "damageBonus", "speed", "initiative"
  ];

  for (const slot of Object.keys(equipment) as EquipmentSlot[]) {
    const itemId = equipment[slot];
    if (itemId) {
      const item = items.get(itemId);
      if (item) {
        for (const key of keys) {
          const mod = item.statModifiers[key];
          if (mod !== undefined) {
            (result as Record<string, number>)[key] = ((result as Record<string, number>)[key] ?? 0) + mod;
          }
        }
        // Add defense from armor/shields
        if (item.defense) {
          (result as Record<string, number>).ac = ((result as Record<string, number>).ac ?? 0) + item.defense;
        }
      }
    }
  }

  return result;
}

export function getEquippedWeaponDamage(
  equipment: Equipment,
  items: ReadonlyMap<string, Item>
): string {
  const mainHand = equipment["main_hand"];
  if (mainHand) {
    const weapon = items.get(mainHand);
    if (weapon?.damage) return weapon.damage;
  }
  return "1d4"; // Unarmed
}

// ============= Item Rarity Helpers =============

export function getRarityColor(rarity: Rarity): string {
  const colors: Record<Rarity, string> = {
    common: "#9ca3af",
    uncommon: "#22c55e",
    rare: "#3b82f6",
    epic: "#a855f7",
    legendary: "#f97316",
    artifact: "#ec4899",
  };
  return colors[rarity];
}

export function getRarityMultiplier(rarity: Rarity): number {
  const multipliers: Record<Rarity, number> = {
    common: 1,
    uncommon: 2,
    rare: 5,
    epic: 15,
    legendary: 50,
    artifact: 200,
  };
  return multipliers[rarity];
}

// ============= Template Items =============

export function createWeapon(
  name: string,
  damage: string,
  rarity: Rarity = "common",
  statMods: StatModifiers = {}
): Item {
  return createItem({
    name,
    description: `A ${rarity} ${name.toLowerCase()}.`,
    type: "weapon",
    rarity,
    value: 10 * getRarityMultiplier(rarity),
    damage,
    statModifiers: statMods,
  });
}

export function createArmor(
  name: string,
  defense: number,
  rarity: Rarity = "common",
  statMods: StatModifiers = {}
): Item {
  return createItem({
    name,
    description: `A ${rarity} ${name.toLowerCase()}.`,
    type: "armor",
    rarity,
    value: 15 * getRarityMultiplier(rarity),
    defense,
    statModifiers: statMods,
    weight: 5,
  });
}

export function createConsumable(
  name: string,
  description: string,
  effects: ItemEffect[],
  rarity: Rarity = "common"
): Item {
  return createItem({
    name,
    description,
    type: "consumable",
    rarity,
    stackable: true,
    maxStack: 99,
    value: 5 * getRarityMultiplier(rarity),
    effects,
  });
}
