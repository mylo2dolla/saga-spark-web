/**
 * Public API for the narrative, quest, NPC, and world systems.
 */

// ============= Types =============
export type {
  // Campaign
  CampaignSeed,
  FactionInfo,
  Alignment,
  
  // Items
  Item,
  ItemType,
  Rarity,
  DamageType,
  StatModifiers,
  ItemEffect,
  EffectTrigger,
  Inventory,
  InventorySlot,
  Equipment,
  EquipmentSlot,
  
  // Status
  EnhancedStatus,
  StatusCategory,
  StatusTrigger,
  StatusTriggerEffect,
  
  // NPC
  NPC,
  NPCMemory,
  NPCGoal,
  NPCRelationship,
  PersonalityTrait,
  Disposition,
  DialogueNode,
  DialogueCondition,
  DialogueResponse,
  DialogueEffect,
  
  // Quest
  Quest,
  QuestState,
  QuestObjective,
  ObjectiveType,
  QuestReward,
  
  // Progression
  CharacterProgression,
  LevelProgression,
  XPSource,
  
  // World
  WorldState,
  StoryFlag,
  Location,
  WorldAction,
  WorldActionType,
  WorldEvent,
  WorldEventType,
} from "./types";

// ============= Item Module =============
export {
  createItem,
  createInventory,
  addItemToInventory,
  removeItemFromInventory,
  hasItem,
  countItem,
  getInventoryWeight,
  modifyGold,
  createEquipment,
  canEquipInSlot,
  equipItem,
  unequipItem,
  calculateEquipmentStats,
  getEquippedWeaponDamage,
  getRarityColor,
  getRarityMultiplier,
  createWeapon,
  createArmor,
  createConsumable,
} from "./Item";

// ============= Status Module =============
export {
  createStatus,
  applyStatus,
  removeStatus,
  removeStatusBySource,
  tickStatuses,
  calculateStatusStats,
  hasStatusCategory,
  getStatusesByCategory,
  createPoison,
  createBurning,
  createBleed,
  createStun,
  createHaste,
  createShield,
  createStrength,
  createRegeneration,
  type StatusTickResult,
} from "./Status";

// ============= NPC Module =============
export {
  createNPC,
  addMemory,
  forgetOldMemories,
  recallMemories,
  hasMemoryOf,
  getRelationship,
  createRelationship,
  updateRelationship,
  calculateDisposition,
  addGoal,
  updateGoalProgress,
  getActiveGoals,
  getHighestPriorityGoal,
  hasTrait,
  getPersonalityScore,
  willLie,
  willHelp,
  calculateTradePrice,
  setCanTrade,
  addDialogue,
  setDialogue,
  getDialogueNode,
  getAvailableResponses,
  addQuestOffered,
  removeQuestOffered,
  addSecret,
  knowsSecret,
} from "./NPC";

// ============= Quest Module =============
export {
  createQuest,
  startQuest,
  completeQuest,
  failQuest,
  abandonQuest,
  updateObjective,
  setObjectiveProgress,
  revealHiddenObjective,
  isQuestComplete,
  getActiveObjectives,
  getProgress,
  canStartQuest,
  tickQuestTime,
  getRemainingTime,
  processKillEvent,
  processCollectEvent,
  processTalkEvent,
  processExploreEvent,
  createKillQuest,
  createFetchQuest,
  createEscortQuest,
  type QuestUpdateResult,
} from "./Quest";

// ============= Progression Module =============
export {
  getXpForLevel,
  getLevelForXp,
  createProgression,
  gainXp,
  calculateCombatXp,
  calculateQuestXp,
  calculateDiscoveryXp,
  getLevelUpBonus,
  getLevelProgression,
  calculateFinalStats,
  getAccumulatedLevelBonuses,
  unlockAbility,
  canUnlockAbility,
  getAvailableAbilitySlots,
  type GainXpResult,
} from "./Progression";

// ============= World Module =============
export {
  createWorldState,
  createCampaignSeed,
  addNPC,
  updateNPC,
  removeNPC,
  addQuest,
  updateQuest,
  addItem,
  addLocation,
  updateLocation,
  setFlag,
  getFlag,
  hasFlag,
  getFlagValue,
  initPlayerProgression,
  updatePlayerProgression,
  processWorldAction,
  advanceTime,
  tickAllQuests,
  getActiveQuests,
  getCompletedQuests,
  getAvailableQuests,
  getNPCsByFaction,
  getDiscoveredLocations,
  getNPCsAtLocation,
  serializeWorld,
  deserializeWorld,
  type WorldActionResult,
} from "./World";
