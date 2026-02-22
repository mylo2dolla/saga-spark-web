import { z } from "zod";

export const WORLD_FORGE_VERSION = "worldforge.v1.0.0";

export const TONE_PRESETS = [
  "dark",
  "comicbook",
  "anime",
  "mythic",
  "cozy",
  "chaotic",
  "grim",
  "heroic",
] as const;
export type TonePreset = (typeof TONE_PRESETS)[number];

export const LETHALITY_LEVELS = ["low", "medium", "high", "brutal"] as const;
export type LethalityLevel = (typeof LETHALITY_LEVELS)[number];

export const DENSITY_LEVELS = ["low", "medium", "high", "wild"] as const;
export type DensityLevel = (typeof DENSITY_LEVELS)[number];

export const TECH_LEVELS = ["primitive", "medieval", "steampunk", "arcane-tech"] as const;
export type TechLevel = (typeof TECH_LEVELS)[number];

export const COMPLEXITY_LEVELS = ["low", "medium", "high"] as const;
export type ComplexityLevel = (typeof COMPLEXITY_LEVELS)[number];

export const WORLD_SIZES = ["small", "medium", "large"] as const;
export type WorldSize = (typeof WORLD_SIZES)[number];

export const RANDOMIZATION_MODES = ["fullyRandom", "themeLockedRandom", "controlled"] as const;
export type RandomizationMode = (typeof RANDOMIZATION_MODES)[number];

export const TonePresetSchema = z.enum(TONE_PRESETS);
export const LethalityLevelSchema = z.enum(LETHALITY_LEVELS);
export const DensityLevelSchema = z.enum(DENSITY_LEVELS);
export const TechLevelSchema = z.enum(TECH_LEVELS);
export const ComplexityLevelSchema = z.enum(COMPLEXITY_LEVELS);
export const WorldSizeSchema = z.enum(WORLD_SIZES);
export const RandomizationModeSchema = z.enum(RANDOMIZATION_MODES);

export const ToneVectorSchema = z.object({
  darkness: z.number().min(0).max(1),
  whimsy: z.number().min(0).max(1),
  brutality: z.number().min(0).max(1),
  absurdity: z.number().min(0).max(1),
  cosmic: z.number().min(0).max(1),
  heroic: z.number().min(0).max(1),
  tragic: z.number().min(0).max(1),
  cozy: z.number().min(0).max(1),
}).strict();
export type ToneVector = z.infer<typeof ToneVectorSchema>;

export const ForgeInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  tonePreset: TonePresetSchema.optional(),
  selectedPresets: z.array(TonePresetSchema).max(4).optional(),
  humorLevel: z.number().int().min(0).max(5).optional(),
  lethality: LethalityLevelSchema.optional(),
  magicDensity: DensityLevelSchema.optional(),
  techLevel: TechLevelSchema.optional(),
  creatureFocus: z.union([
    z.string().trim().min(1).max(60),
    z.array(z.string().trim().min(1).max(60)).min(1).max(8),
  ]).optional(),
  factionComplexity: ComplexityLevelSchema.optional(),
  worldSize: WorldSizeSchema.optional(),
  startingRegionType: z.string().trim().min(1).max(80).optional(),
  villainArchetype: z.string().trim().min(1).max(120).optional(),
  corruptionLevel: z.number().int().min(0).max(5).optional(),
  divineInterferenceLevel: z.number().int().min(0).max(5).optional(),
  randomizationMode: RandomizationModeSchema.optional(),
  playerToggles: z.record(z.boolean()).optional(),
  manualSeedOverride: z.union([
    z.string().trim().min(1).max(120),
    z.number().int().min(0).max(2_147_483_647),
  ]).optional(),
}).strict();
export type ForgeInput = z.infer<typeof ForgeInputSchema>;
export const ForgeInputPatchSchema = ForgeInputSchema.partial();

export const WorldSeedSchema = z.object({
  worldForgeVersion: z.string().min(1),
  seedString: z.string().min(8),
  seedNumber: z.number().int().min(0).max(2_147_483_647),
  themeTags: z.array(z.string().min(1)).max(40),
  toneVector: ToneVectorSchema,
  presetTrace: z.array(TonePresetSchema),
  forgeInput: ForgeInputSchema,
}).strict();
export type WorldSeed = z.infer<typeof WorldSeedSchema>;

export const WorldBibleSchema = z.object({
  worldName: z.string().min(1).max(120),
  cosmologyRules: z.array(z.string().min(1)).min(3).max(8),
  magicSystemFlavor: z.string().min(1).max(220),
  coreConflicts: z.array(z.string().min(1)).min(3).max(8),
  dominantFactions: z.array(z.string().min(1)).min(2).max(8),
  minorFactions: z.array(z.string().min(1)).min(2).max(12),
  biomeDefinitions: z.array(z.string().min(1)).min(4).max(16),
  creatureArchetypes: z.array(z.string().min(1)).min(4).max(16),
  npcSpeechStyle: z.string().min(1).max(220),
  namingRules: z.array(z.string().min(1)).min(3).max(8),
  lootFlavorProfile: z.array(z.string().min(1)).min(3).max(12),
  moralClimate: z.string().min(1).max(200),
}).strict();
export type WorldBible = z.infer<typeof WorldBibleSchema>;

export const BiomeRegionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dominantBiome: z.string().min(1),
  corruption: z.number().min(0).max(1),
  dungeonDensity: z.number().min(0).max(1),
  townDensity: z.number().min(0).max(1),
  capitalTown: z.string().min(1),
  tags: z.array(z.string().min(1)).max(8),
}).strict();
export type BiomeRegion = z.infer<typeof BiomeRegionSchema>;

export const BiomeMapSchema = z.object({
  worldSize: WorldSizeSchema,
  regions: z.array(BiomeRegionSchema).min(4).max(18),
  corruptionZones: z.array(z.object({
    regionId: z.string().min(1),
    severity: z.number().min(0).max(1),
    note: z.string().min(1),
  }).strict()).max(18),
  capitalTowns: z.array(z.string().min(1)).min(1).max(18),
  averageDungeonDensity: z.number().min(0).max(1),
}).strict();
export type BiomeMap = z.infer<typeof BiomeMapSchema>;

export const FactionNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  ideology: z.string().min(1),
  moralAlignment: z.object({
    order: z.number().min(-1).max(1),
    mercy: z.number().min(-1).max(1),
    ambition: z.number().min(-1).max(1),
  }).strict(),
  powerLevel: z.number().int().min(1).max(100),
  homeRegionId: z.string().min(1),
  goals: z.array(z.string().min(1)).min(1).max(6),
}).strict();
export type FactionNode = z.infer<typeof FactionNodeSchema>;

export const FactionGraphSchema = z.object({
  factions: z.array(FactionNodeSchema).min(3).max(14),
  relations: z.record(z.record(z.number().min(-100).max(100))),
  activeTensions: z.array(z.string().min(1)).min(2).max(20),
}).strict();
export type FactionGraph = z.infer<typeof FactionGraphSchema>;

export const CreaturePoolsSchema = z.object({
  featuredFocus: z.array(z.string().min(1)).max(8),
  globalPool: z.array(z.string().min(1)).min(6).max(30),
  byBiome: z.record(z.array(z.string().min(1)).min(3).max(18)),
  byThreatTier: z.object({
    low: z.array(z.string().min(1)).min(2).max(12),
    medium: z.array(z.string().min(1)).min(2).max(12),
    high: z.array(z.string().min(1)).min(2).max(12),
  }).strict(),
}).strict();
export type CreaturePools = z.infer<typeof CreaturePoolsSchema>;

export const NPCStyleRulesSchema = z.object({
  speechTone: z.string().min(1).max(120),
  humorFrequency: z.number().min(0).max(1),
  threatLevel: z.number().min(0).max(1),
  namingConventions: z.array(z.string().min(1)).min(2).max(8),
  signatureIdioms: z.array(z.string().min(1)).min(2).max(12),
}).strict();
export type NPCStyleRules = z.infer<typeof NPCStyleRulesSchema>;

export const LootFlavorProfileSchema = z.object({
  adjectivePool: z.array(z.string().min(1)).min(4).max(24),
  nounPool: z.array(z.string().min(1)).min(4).max(24),
  flourishPool: z.array(z.string().min(1)).min(4).max(24),
  raritySuffixByTier: z.record(z.string().min(1)),
  whimsicalScale: z.number().min(0).max(1),
}).strict();
export type LootFlavorProfile = z.infer<typeof LootFlavorProfileSchema>;

export const MagicRulesSchema = z.object({
  density: DensityLevelSchema,
  volatility: z.number().min(0).max(1),
  schools: z.array(z.string().min(1)).min(3).max(10),
  tabooPractices: z.array(z.string().min(1)).min(1).max(6),
  cosmicLeakage: z.number().min(0).max(1),
}).strict();
export type MagicRules = z.infer<typeof MagicRulesSchema>;

export const DMBehaviorProfileSchema = z.object({
  crueltyBias: z.number().min(0).max(1),
  generosityBias: z.number().min(0).max(1),
  chaosBias: z.number().min(0).max(1),
  fairnessBias: z.number().min(0).max(1),
  humorBias: z.number().min(0).max(1),
  memoryDepth: z.number().int().min(2).max(20),
}).strict();
export type DMBehaviorProfile = z.infer<typeof DMBehaviorProfileSchema>;

export const WorldFactionStateSchema = z.object({
  factionId: z.string().min(1),
  powerLevel: z.number().int().min(1).max(120),
  trustDelta: z.number().int().min(-100).max(100),
  lastActionTick: z.number().int().min(0),
}).strict();
export type WorldFactionState = z.infer<typeof WorldFactionStateSchema>;

export const WorldStateLogEntrySchema = z.object({
  tick: z.number().int().min(1),
  type: z.string().min(1),
  summary: z.string().min(1),
  impacts: z.record(z.number()).optional(),
}).strict();
export type WorldStateLogEntry = z.infer<typeof WorldStateLogEntrySchema>;

export const WorldStateSchema = z.object({
  seedNumber: z.number().int().min(0).max(2_147_483_647),
  worldName: z.string().min(1),
  tick: z.number().int().min(0),
  activeTowns: z.array(z.string().min(1)).min(1).max(24),
  activeRumors: z.array(z.string().min(1)).max(40),
  collapsedDungeons: z.array(z.string().min(1)).max(40),
  villainEscalation: z.number().int().min(0).max(999),
  factionStates: z.array(WorldFactionStateSchema).min(1).max(24),
  history: z.array(WorldStateLogEntrySchema).max(120),
}).strict();
export type WorldState = z.infer<typeof WorldStateSchema>;

export const WorldContextSchema = z.object({
  worldSeed: WorldSeedSchema,
  worldBible: WorldBibleSchema,
  biomeMap: BiomeMapSchema,
  factionGraph: FactionGraphSchema,
  creaturePools: CreaturePoolsSchema,
  npcStyleRules: NPCStyleRulesSchema,
  lootFlavorProfile: LootFlavorProfileSchema,
  magicRules: MagicRulesSchema,
  worldState: WorldStateSchema,
}).strict();
export type WorldContext = z.infer<typeof WorldContextSchema>;

export const DMContextSchema = z.object({
  worldSeed: WorldSeedSchema,
  dmBehaviorProfile: DMBehaviorProfileSchema,
  narrativeDirectives: z.array(z.string().min(1)).min(4).max(16),
  tacticalDirectives: z.array(z.string().min(1)).min(3).max(12),
}).strict();
export type DMContext = z.infer<typeof DMContextSchema>;

export const CampaignContextSchema = z.object({
  worldForgeVersion: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(2000),
  worldSeed: WorldSeedSchema,
  worldContext: WorldContextSchema,
  dmContext: DMContextSchema,
}).strict();
export type CampaignContext = z.infer<typeof CampaignContextSchema>;

export const PlayerWorldActionSchema = z.object({
  actionType: z.string().trim().min(1).max(80),
  summary: z.string().trim().min(1).max(240).optional(),
  targetRegionId: z.string().trim().min(1).max(80).optional(),
  targetFactionId: z.string().trim().min(1).max(80).optional(),
  moralImpact: z.number().min(-1).max(1).optional(),
  chaosImpact: z.number().min(-1).max(1).optional(),
  generosityImpact: z.number().min(-1).max(1).optional(),
  brutalityImpact: z.number().min(-1).max(1).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(8).optional(),
}).strict();
export type PlayerWorldAction = z.infer<typeof PlayerWorldActionSchema>;

export const CharacterForgeInputSchema = z.object({
  characterName: z.string().trim().min(1).max(80).optional(),
  originRegionId: z.string().trim().min(1).max(80).optional(),
  factionAlignmentId: z.string().trim().min(1).max(80).optional(),
  background: z.string().trim().min(1).max(160).optional(),
  personalityTraits: z.array(z.string().trim().min(1).max(80)).max(6).optional(),
  moralLeaning: z.number().min(-1).max(1).optional(),
}).strict();
export type CharacterForgeInput = z.infer<typeof CharacterForgeInputSchema>;

export const CharacterForgeOutputSchema = z.object({
  originRegionId: z.string().min(1),
  originRegionName: z.string().min(1),
  factionAlignmentId: z.string().min(1),
  factionAlignmentName: z.string().min(1),
  background: z.string().min(1),
  personalityTraits: z.array(z.string().min(1)).min(2).max(5),
  moralLeaning: z.number().min(-1).max(1),
  startingTown: z.string().min(1),
  startingNpcRelationships: z.record(z.number().int().min(-100).max(100)),
  initialFactionTrust: z.record(z.number().int().min(-100).max(100)),
  startingRumors: z.array(z.string().min(1)).min(1).max(8),
  startingFlags: z.array(z.string().min(1)).min(1).max(12),
}).strict();
export type CharacterForgeOutput = z.infer<typeof CharacterForgeOutputSchema>;

export type TemplateKey =
  | "custom"
  | "graphic_novel_fantasy"
  | "sci_fi_ruins"
  | "post_apoc_warlands"
  | "gothic_horror"
  | "mythic_chaos"
  | "dark_mythic_horror"
  | "post_apocalypse";
