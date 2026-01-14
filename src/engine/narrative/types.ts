/**
 * Core type definitions for the narrative, quest, NPC, and world systems.
 * All types are immutable - state updates return new objects.
 */

import type { Vec2, Faction } from "../types";

// ============= Campaign Seed =============

export interface CampaignSeed {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly themes: readonly string[];           // e.g., ["dark fantasy", "political intrigue"]
  readonly factions: readonly FactionInfo[];
  readonly createdAt: number;
}

export interface FactionInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly alignment: Alignment;
  readonly goals: readonly string[];
  readonly enemies: readonly string[];          // Faction IDs
  readonly allies: readonly string[];           // Faction IDs
}

export type Alignment = 
  | "lawful_good" | "neutral_good" | "chaotic_good"
  | "lawful_neutral" | "true_neutral" | "chaotic_neutral"
  | "lawful_evil" | "neutral_evil" | "chaotic_evil";

// ============= Items =============

export type ItemType = 
  | "weapon" 
  | "armor" 
  | "shield" 
  | "helmet" 
  | "boots" 
  | "gloves" 
  | "ring" 
  | "amulet" 
  | "consumable" 
  | "quest" 
  | "relic" 
  | "material"
  | "key";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "artifact";

export type DamageType = "physical" | "fire" | "ice" | "lightning" | "poison" | "necrotic" | "radiant" | "psychic";

export interface StatModifiers {
  readonly strength?: number;
  readonly dexterity?: number;
  readonly constitution?: number;
  readonly intelligence?: number;
  readonly wisdom?: number;
  readonly charisma?: number;
  readonly maxHp?: number;
  readonly ac?: number;
  readonly attackBonus?: number;
  readonly damageBonus?: number;
  readonly speed?: number;
  readonly initiative?: number;
}

export interface Item {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly type: ItemType;
  readonly rarity: Rarity;
  readonly value: number;                       // Gold value
  readonly weight: number;
  readonly stackable: boolean;
  readonly maxStack: number;
  readonly statModifiers: StatModifiers;
  readonly damageType?: DamageType;
  readonly damage?: string;                     // e.g., "2d6+3"
  readonly defense?: number;
  readonly resistances?: Partial<Record<DamageType, number>>;  // % reduction
  readonly storyTags: readonly string[];        // For quest/narrative matching
  readonly effects?: readonly ItemEffect[];
  readonly requiresLevel?: number;
  readonly ownerId?: string;                    // Entity who owns it
}

export interface ItemEffect {
  readonly trigger: EffectTrigger;
  readonly statusId?: string;                   // Status to apply
  readonly healing?: string;                    // Dice roll
  readonly damage?: string;                     // Dice roll
  readonly damageType?: DamageType;
}

export type EffectTrigger = "on_equip" | "on_use" | "on_hit" | "on_hit_received" | "on_kill" | "on_turn_start" | "on_turn_end";

// ============= Equipment & Inventory =============

export type EquipmentSlot = 
  | "main_hand" 
  | "off_hand" 
  | "head" 
  | "chest" 
  | "hands" 
  | "feet" 
  | "ring_1" 
  | "ring_2" 
  | "amulet";

export type Equipment = {
  readonly [K in EquipmentSlot]?: string;       // Item ID or undefined
};

export interface InventorySlot {
  readonly itemId: string;
  readonly quantity: number;
}

export interface Inventory {
  readonly slots: readonly InventorySlot[];
  readonly maxSlots: number;
  readonly gold: number;
}

// ============= Enhanced Status Effects =============

export type StatusCategory = "buff" | "debuff" | "neutral";

export type StatusTrigger = 
  | "on_turn_start"
  | "on_turn_end"
  | "on_move"
  | "on_attack"
  | "on_hit"
  | "on_hit_received"
  | "on_kill"
  | "on_death"
  | "on_heal_received";

export interface EnhancedStatus {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon?: string;
  readonly category: StatusCategory;
  readonly source: string;                      // Entity or item that applied it
  readonly duration: number;                    // Turns remaining (-1 = permanent)
  readonly stacks: number;
  readonly maxStacks: number;
  readonly stackBehavior: "refresh" | "add" | "max";  // What happens when reapplied
  readonly statModifiers: StatModifiers;
  readonly triggers: readonly StatusTriggerEffect[];
  readonly immuneTo?: readonly string[];        // Status IDs this makes you immune to
}

export interface StatusTriggerEffect {
  readonly trigger: StatusTrigger;
  readonly damage?: number;
  readonly damageType?: DamageType;
  readonly healing?: number;
  readonly damagePerStack?: number;
  readonly healingPerStack?: number;
  readonly applyStatus?: string;                // Status ID to apply
  readonly removeStatus?: string;               // Status ID to remove
  readonly preventAction?: boolean;             // Stun, freeze, etc.
}

// ============= NPC System =============

export type PersonalityTrait = 
  | "honest" | "deceptive" | "brave" | "cowardly"
  | "kind" | "cruel" | "greedy" | "generous"
  | "wise" | "foolish" | "proud" | "humble"
  | "loyal" | "treacherous" | "patient" | "impulsive";

export type Disposition = "hostile" | "unfriendly" | "neutral" | "friendly" | "allied";

export interface NPCRelationship {
  readonly entityId: string;
  readonly disposition: Disposition;
  readonly trust: number;                       // -100 to 100
  readonly respect: number;                     // -100 to 100
  readonly fear: number;                        // 0 to 100
  readonly history: readonly string[];          // Key events
}

export interface NPCMemory {
  readonly timestamp: number;
  readonly event: string;
  readonly tags: readonly string[];
  readonly emotionalImpact: number;             // -10 to 10
  readonly decay: number;                       // How quickly this fades (0-1)
}

export interface NPCGoal {
  readonly id: string;
  readonly description: string;
  readonly priority: number;                    // 1-10
  readonly progress: number;                    // 0-100
  readonly completed: boolean;
  readonly blockedBy?: readonly string[];       // Other goal IDs
}

export interface NPC {
  readonly id: string;
  readonly entityId: string;                    // Links to Entity in combat
  readonly name: string;
  readonly title?: string;                      // e.g., "The Blacksmith", "Lord of Shadows"
  readonly factionId: string;
  readonly personality: readonly PersonalityTrait[];
  readonly goals: readonly NPCGoal[];
  readonly relationships: readonly NPCRelationship[];
  readonly memories: readonly NPCMemory[];
  readonly inventory: Inventory;
  readonly equipment: Equipment;
  readonly dialogue: readonly DialogueNode[];
  readonly questsOffered: readonly string[];    // Quest IDs
  readonly canTrade: boolean;
  readonly priceModifier: number;               // 1.0 = normal, affected by relationship
  readonly knownSecrets: readonly string[];
  readonly isEssential: boolean;                // Cannot be killed
}

export interface DialogueNode {
  readonly id: string;
  readonly text: string;
  readonly speakerMood?: string;
  readonly conditions?: readonly DialogueCondition[];
  readonly responses: readonly DialogueResponse[];
}

export interface DialogueCondition {
  readonly type: "quest_state" | "relationship" | "item" | "flag" | "stat";
  readonly questId?: string;
  readonly questState?: QuestState;
  readonly disposition?: Disposition;
  readonly itemId?: string;
  readonly flagId?: string;
  readonly stat?: keyof StatModifiers;
  readonly minValue?: number;
}

export interface DialogueResponse {
  readonly text: string;
  readonly nextNodeId?: string;
  readonly effects?: readonly DialogueEffect[];
}

export interface DialogueEffect {
  readonly type: "start_quest" | "complete_quest" | "give_item" | "take_item" | "modify_relationship" | "set_flag" | "give_xp" | "give_gold";
  readonly questId?: string;
  readonly itemId?: string;
  readonly quantity?: number;
  readonly relationshipChange?: number;
  readonly flagId?: string;
  readonly flagValue?: boolean;
  readonly xp?: number;
  readonly gold?: number;
}

// ============= Quest System =============

export type QuestState = "unknown" | "available" | "active" | "completed" | "failed" | "abandoned";

export type ObjectiveType = 
  | "kill" 
  | "kill_type"
  | "collect" 
  | "deliver" 
  | "escort" 
  | "explore" 
  | "talk" 
  | "protect"
  | "survive"
  | "craft"
  | "reach_level"
  | "use_item";

export interface QuestObjective {
  readonly id: string;
  readonly type: ObjectiveType;
  readonly description: string;
  readonly targetId?: string;                   // Entity, location, or item ID
  readonly targetType?: string;                 // For kill_type: "goblin", "undead", etc.
  readonly current: number;
  readonly required: number;
  readonly optional: boolean;
  readonly hidden: boolean;                     // Don't show until triggered
  readonly location?: Vec2;
}

export interface QuestReward {
  readonly xp: number;
  readonly gold: number;
  readonly items: readonly string[];            // Item IDs
  readonly reputation?: readonly { factionId: string; change: number }[];
  readonly unlocksQuests?: readonly string[];
  readonly storyFlags?: readonly string[];
}

export interface Quest {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly briefDescription: string;            // Short version for log
  readonly giverId: string;                     // NPC ID
  readonly state: QuestState;
  readonly objectives: readonly QuestObjective[];
  readonly rewards: QuestReward;
  readonly failureConsequences?: QuestReward;   // Negative rewards on failure
  readonly timeLimit?: number;                  // Turns until failure
  readonly turnsElapsed: number;
  readonly prerequisites: readonly string[];    // Quest IDs that must be complete
  readonly conflictsWith: readonly string[];    // Quest IDs that fail if this completes
  readonly storyArc?: string;
  readonly importance: "side" | "main" | "legendary";
}

// ============= XP & Leveling =============

export interface LevelProgression {
  readonly level: number;
  readonly xpRequired: number;
  readonly statBoosts: StatModifiers;
  readonly abilitySlotsGained: number;
  readonly narrativeFlags: readonly string[];
}

export interface XPSource {
  readonly type: "combat" | "quest" | "discovery" | "social" | "crafting";
  readonly amount: number;
  readonly description: string;
  readonly timestamp: number;
}

export interface CharacterProgression {
  readonly entityId: string;
  readonly level: number;
  readonly currentXp: number;
  readonly xpToNextLevel: number;
  readonly totalXpEarned: number;
  readonly xpHistory: readonly XPSource[];
  readonly baseStats: StatModifiers;
  readonly abilitySlots: number;
  readonly unlockedAbilities: readonly string[];
}

// ============= World State =============

export interface StoryFlag {
  readonly id: string;
  readonly value: boolean | number | string;
  readonly setAt: number;                       // Tick when set
  readonly source: string;                      // Quest, NPC, or event that set it
}

export interface Location {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly position: Vec2;
  readonly radius: number;
  readonly discovered: boolean;
  readonly npcs: readonly string[];             // NPC IDs present here
  readonly items: readonly string[];            // Lootable items
  readonly connectedTo: readonly string[];      // Other location IDs
}

export interface WorldState {
  readonly campaignSeed: CampaignSeed;
  readonly npcs: ReadonlyMap<string, NPC>;
  readonly quests: ReadonlyMap<string, Quest>;
  readonly items: ReadonlyMap<string, Item>;
  readonly locations: ReadonlyMap<string, Location>;
  readonly storyFlags: ReadonlyMap<string, StoryFlag>;
  readonly globalTime: number;                  // In-game time tracker
  readonly playerProgression: ReadonlyMap<string, CharacterProgression>;
}

// ============= Actions =============

export type WorldActionType = 
  | "talk"
  | "trade"
  | "give_item"
  | "take_item"
  | "use_item"
  | "equip_item"
  | "unequip_item"
  | "accept_quest"
  | "complete_quest"
  | "abandon_quest"
  | "discover_location"
  | "set_flag"
  | "gain_xp"
  | "level_up"
  | "apply_status"
  | "remove_status";

export interface WorldAction {
  readonly type: WorldActionType;
  readonly entityId: string;
  readonly targetId?: string;
  readonly itemId?: string;
  readonly questId?: string;
  readonly slot?: EquipmentSlot;
  readonly statusId?: string;
  readonly xpAmount?: number;
  readonly xpSource?: XPSource["type"];
  readonly flagId?: string;
  readonly flagValue?: boolean | number | string;
  readonly message?: string;
}

// ============= Events =============

export type WorldEventType =
  | "npc_spoke"
  | "quest_started"
  | "quest_updated"
  | "quest_completed"
  | "quest_failed"
  | "item_acquired"
  | "item_lost"
  | "item_equipped"
  | "item_unequipped"
  | "item_used"
  | "location_discovered"
  | "relationship_changed"
  | "xp_gained"
  | "level_up"
  | "status_applied"
  | "status_removed"
  | "status_triggered"
  | "flag_set"
  | "npc_remembered";

export interface WorldEvent {
  readonly type: WorldEventType;
  readonly entityId?: string;
  readonly targetId?: string;
  readonly value?: number;
  readonly itemId?: string;
  readonly questId?: string;
  readonly statusId?: string;
  readonly description: string;
  readonly timestamp: number;
}
