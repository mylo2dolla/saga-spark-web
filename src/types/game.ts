// Core game types for state-driven tabletop

export interface CharacterStats {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export interface CharacterResources {
  mana: number;
  maxMana: number;
  rage: number;
  maxRage: number;
  stamina: number;
  maxStamina: number;
}

export interface PassiveAbility {
  name: string;
  description: string;
  effect: string;
}

export interface GameAbility {
  id: string;
  name: string;
  description: string;
  abilityType: "active" | "passive" | "reaction";
  damage?: string;
  healing?: string;
  range: number;
  cost: number;
  costType: string;
  cooldown: number;
  currentCooldown?: number;
  targetingType: "self" | "single" | "tile" | "area" | "cone" | "line";
  areaSize?: number;
  effects?: string[];
  isEquipped?: boolean;
}

export interface ItemStatModifiers {
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;
  damage?: string;
  ac?: number;
  hp?: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  itemType: "weapon" | "armor" | "consumable" | "treasure" | "ring" | "trinket" | "shield" | "helmet" | "boots" | "gloves";
  slot?: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  statModifiers?: ItemStatModifiers;
  abilitiesGranted?: string[];
  effects?: string[];
  value?: number;
  quantity?: number;
}

export interface EquipmentSlots {
  weapon: InventoryItem | null;
  armor: InventoryItem | null;
  shield: InventoryItem | null;
  helmet: InventoryItem | null;
  boots: InventoryItem | null;
  gloves: InventoryItem | null;
  ring1: InventoryItem | null;
  ring2: InventoryItem | null;
  trinket1: InventoryItem | null;
  trinket2: InventoryItem | null;
  trinket3: InventoryItem | null;
}

export interface GridPosition {
  x: number;
  y: number;
}

export interface GridTile {
  x: number;
  y: number;
  terrain: "floor" | "wall" | "tree" | "rock" | "water" | "lava" | "pit";
  blocked: boolean;
  occupantId?: string;
  occupantType?: "character" | "enemy" | "npc";
  effects?: string[];
}

export interface GridState {
  id: string;
  campaignId: string;
  gridSize: { rows: number; cols: number };
  tiles: GridTile[];
}

export interface GeneratedClass {
  className: string;
  description: string;
  stats: CharacterStats;
  resources: CharacterResources;
  passives: PassiveAbility[];
  abilities: Omit<GameAbility, "id">[];
  hitDice: string;
  baseAC: number;
}

export interface CombatEntity {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  position: GridPosition;
  initiative: number;
  isEnemy: boolean;
}

export interface AbilityUseResult {
  success: boolean;
  damage?: number;
  healing?: number;
  isCritical?: boolean;
  isFumble?: boolean;
  effectsApplied?: string[];
  description: string;
}
