import { md5Hex, rng01, rngInt, rngPick, weightedPick } from "../../shared/mythic_rng.js";
import {
  CampaignContextSchema,
  CharacterForgeInputSchema,
  CharacterForgeOutputSchema,
  DMBehaviorProfileSchema,
  DMContextSchema,
  ForgeInputPatchSchema,
  ForgeInputSchema,
  type BiomeMap,
  type CampaignContext,
  type CharacterForgeInput,
  type CharacterForgeOutput,
  type ComplexityLevel,
  type DensityLevel,
  type DMBehaviorProfile,
  type DMContext,
  type ForgeInput,
  type FactionGraph,
  type LethalityLevel,
  type LootFlavorProfile,
  type MagicRules,
  type NPCStyleRules,
  type PlayerWorldAction,
  type RandomizationMode,
  type TechLevel,
  type TonePreset,
  type ToneVector,
  type WorldBible,
  type WorldContext,
  type WorldSeed,
  type WorldSize,
  type WorldState,
  type TemplateKey,
  WorldSeedSchema,
  WorldStateSchema,
  PlayerWorldActionSchema,
  WORLD_FORGE_VERSION,
} from "./schema.js";
import { DEFAULT_PRESET, FORGE_PRESETS, templateToPreset } from "./presets.js";

const MAX_SEED = 2_147_483_647;

const DEFAULTS = {
  humorLevel: 2,
  lethality: "medium",
  magicDensity: "medium",
  techLevel: "medieval",
  factionComplexity: "medium",
  worldSize: "medium",
  startingRegionType: "borderlands",
  villainArchetype: "warlord",
  corruptionLevel: 2,
  divineInterferenceLevel: 2,
  randomizationMode: "controlled",
} as const;

const CREATURE_FOCUS_POOL = [
  "undead",
  "beasts",
  "vampires",
  "ninjas",
  "dragons",
  "cats",
  "dogs",
  "cosmic horror",
  "slimes",
  "constructs",
  "bandits",
  "spirits",
];

const STARTING_REGION_POOL = [
  "borderlands",
  "highlands",
  "marsh frontier",
  "sun plains",
  "storm coast",
  "rift basin",
  "obsidian district",
];

const VILLAIN_ARCHETYPE_POOL = [
  "fallen hero",
  "immortal tyrant",
  "cackling technomancer",
  "chessmaster bishop",
  "famine prophet",
  "charming usurper",
  "laughing void saint",
  "cat emperor",
];

const TONE_BASE: ToneVector = {
  darkness: 0.4,
  whimsy: 0.3,
  brutality: 0.35,
  absurdity: 0.25,
  cosmic: 0.3,
  heroic: 0.45,
  tragic: 0.35,
  cozy: 0.25,
};

const WORLD_PREFIX_POOL = [
  "Ashen",
  "Radiant",
  "Broken",
  "Velvet",
  "Gilded",
  "Grinning",
  "Starforged",
  "Moonless",
  "Honey",
  "Thunder",
  "Iron",
  "Whispering",
];
const WORLD_SUFFIX_POOL = [
  "March",
  "Archipelago",
  "Frontier",
  "Dominion",
  "Reaches",
  "Wilds",
  "Kingdoms",
  "Circuit",
  "Vale",
  "Parallax",
  "Sprawl",
  "Hollows",
];

const COSMOLOGY_RULE_POOL = [
  "Every oath leaves a visible scar in the sky for one season.",
  "Souls can reincarnate only inside their home biome unless a god intervenes.",
  "Storms inherit memory and repeat old battles in lightning silhouettes.",
  "The moon keeps score of betrayals and amplifies magic at confession shrines.",
  "Ancient roads are semi-sentient and reroute travelers toward unfinished stories.",
  "Factions can buy weather favors from storm monasteries at extreme cost.",
  "Death is reversible only through equivalent sacrifice and public witness.",
  "Dreams leak tactical hints from alternate timelines once per week.",
  "Cosmic gates open where tragedy and hope peak at the same location.",
  "Named relics choose owners based on intent, not bloodline.",
  "A hidden archive rewrites maps whenever power blocs collapse.",
  "Laughter can break low-tier curses, but empowers high-tier curses.",
];

const MAGIC_FLAVOR_POOL = [
  "spellcraft behaves like volatile weather fronts",
  "magic is debt-backed and collectors always arrive",
  "arcane power is sung into shape by breath control",
  "sigils awaken only when paired with emotional extremes",
  "ritual circles run like software and can crash catastrophically",
  "divine miracles are legal contracts with loopholes",
  "wild mana crystallizes into consumable storm-glass",
  "battle chants mutate nearby wildlife and terrain",
  "forbidden rites stitch shadow and light into unstable hybrids",
  "household magic is cozy, combat magic is savage",
];

const CONFLICT_POOL = [
  "A coalition of city guilds and zealot wardens race to seize border fortresses.",
  "An old empire's backup army keeps waking beneath regional capitals.",
  "Competing churches claim custody over a prophecy that changes weekly.",
  "Rival scavenger fleets weaponize relic tech against civilian routes.",
  "A hidden villain bankrolls both peace talks and assassination contracts.",
  "The strongest faction controls medicine and manipulates shortages.",
  "Pilgrim caravans vanish near a biome where reality keeps folding.",
  "A cursed inheritance war is dragging neutral towns into siege economics.",
  "Mercenary houses split over whether to protect or exploit cosmic breaches.",
  "Farm communes arm themselves after repeated raids by sanctified monsters.",
  "A cataclysm clock is counting down and only liars can read it.",
  "An absurd sports league secretly determines regional sovereignty.",
];

const FACTION_ADJECTIVES = [
  "Iron",
  "Velvet",
  "Cinder",
  "Moon",
  "Storm",
  "Hollow",
  "Golden",
  "Rift",
  "Bone",
  "Honey",
  "Neon",
  "Dusk",
  "Azure",
  "Void",
  "Thorn",
];
const FACTION_NOUNS = [
  "Accord",
  "Compact",
  "Syndicate",
  "Covenant",
  "Dynasty",
  "Assembly",
  "Choir",
  "Cartel",
  "Guard",
  "League",
  "Spiral",
  "Order",
  "Front",
  "Collective",
  "Union",
];

const IDEOLOGY_POOL = [
  "order through contracts",
  "survival by any means",
  "mercy before law",
  "profit-driven stability",
  "holy containment",
  "chaotic liberation",
  "technocratic stewardship",
  "ancestral restoration",
  "spectacle as control",
  "communal resilience",
  "predatory expansion",
  "ritual equilibrium",
];

const FACTION_GOAL_POOL = [
  "Secure control over regional supply chains.",
  "Capture or destroy an enemy strategic relic.",
  "Recruit elite operatives from neutral towns.",
  "Manipulate public rumor networks.",
  "Enforce ideological law in mixed-faction zones.",
  "Sabotage rival strongholds through deniable operations.",
  "Broker a temporary truce to prepare a betrayal.",
  "Expand influence into an unclaimed biome.",
  "Control pilgrimage routes and tribute lanes.",
  "Stage symbolic victories to maintain legitimacy.",
];

const BIOME_POOL_COMMON = [
  "sunfields",
  "thornwoods",
  "riverdelta",
  "stormcoast",
  "frostheath",
  "ambermarsh",
  "obsidianridge",
  "catacombs",
  "blightfen",
  "riftwaste",
  "clockwork quarter",
  "crystal dunes",
  "moonlit ruins",
  "lantern valley",
  "honey meadows",
  "echo caverns",
];

const BIOME_CREATURE_MAP: Record<string, string[]> = {
  sunfields: ["meadow boars", "gallant bandits", "sun sprites", "field golems"],
  thornwoods: ["thorn wolves", "forest spirits", "masked rangers", "vine mimics"],
  riverdelta: ["bog lurkers", "otter marauders", "mud elementals", "delta raiders"],
  stormcoast: ["tempest drakes", "salt corsairs", "reef trolls", "storm imps"],
  frostheath: ["ice wraiths", "frost hounds", "pale giants", "snow cultists"],
  ambermarsh: ["mire serpents", "fen witches", "amber slimes", "swamp stalkers"],
  obsidianridge: ["basalt titans", "ash harpies", "obsidian wolves", "ridge raiders"],
  catacombs: ["grave knights", "bone swarms", "crypt hags", "mourning shades"],
  blightfen: ["plague crows", "rotting behemoths", "blight cultists", "toxin oozes"],
  riftwaste: ["void hounds", "rift revenants", "anomaly clowns", "fractured angels"],
  "clockwork quarter": ["gear sentries", "arcane mechanics", "sparking rogues", "clockwork dogs"],
  "crystal dunes": ["glass wyrms", "mirage assassins", "sand apostles", "shard swarms"],
  "moonlit ruins": ["lunar guardians", "vampire duelists", "ruin stalkers", "echo monks"],
  "lantern valley": ["lantern spirits", "bandit caravans", "willow sentries", "copper foxes"],
  "honey meadows": ["slimes", "bee knights", "mischief cats", "garden golems"],
  "echo caverns": ["sonic bats", "echo giants", "deep ninjas", "crystal worms"],
};

const NPC_IDIOM_POOL = [
  "Keep your boots honest and your promises short.",
  "No free miracles, just expensive shortcuts.",
  "Luck likes prepared fools.",
  "Smile like you mean trouble.",
  "Every rumor has teeth if you feed it.",
  "Quiet heroes still leave loud consequences.",
  "If the map looks friendly, it is lying.",
  "Pay now in coin or later in blood.",
  "Take the deal before the storm takes you.",
  "Mercy is tactical if timed right.",
  "The gods are listening; unfortunately so are spies.",
  "Don't poke that shrine unless you brought snacks.",
];

const LOOT_ADJECTIVES = [
  "Oak",
  "Steel",
  "Moon",
  "Glitter",
  "Storm",
  "Honey",
  "Grim",
  "Solar",
  "Neon",
  "Dusk",
  "Chaos",
  "Lantern",
];
const LOOT_NOUNS = [
  "Wand",
  "Blade",
  "Charm",
  "Buckler",
  "Helm",
  "Talisman",
  "Spear",
  "Mace",
  "Pendant",
  "Ring",
  "Totem",
  "Boots",
];
const LOOT_FLOURISHES = [
  "of Bonking",
  "of Sparkles",
  "of Quiet Doom",
  "of Proper Manners",
  "of Side Quests",
  "of Thunder Snacks",
  "of Midnight Tea",
  "of Noble Panic",
  "of Meteor Insurance",
  "of Heroic Overkill",
  "of Cozy Violence",
  "of Laughing Static",
];

const MAGIC_SCHOOL_POOL = [
  "evocation",
  "wardcraft",
  "binding",
  "hexes",
  "chronomancy",
  "songweaving",
  "biomancy",
  "stormcalling",
  "runeforging",
  "rift surgery",
];

const MAGIC_TABOO_POOL = [
  "memory theft",
  "oath forgery",
  "soul counterfeiting",
  "child-star summoning",
  "plague hymncasting",
  "void grafting",
  "time debt laundering",
  "grave market pacts",
];

const BACKGROUND_POOL_BY_TECH: Record<string, string[]> = {
  primitive: [
    "clan outrider",
    "totem keeper",
    "beast trail cartographer",
    "marsh skirmisher",
    "village oath runner",
  ],
  medieval: [
    "guild dropout",
    "ex-temple courier",
    "border watch veteran",
    "market duelist",
    "archive thief",
  ],
  steampunk: [
    "boiler saboteur",
    "airship deck gunner",
    "clocktower mechanic",
    "railline investigator",
    "patent pirate",
  ],
  "arcane-tech": [
    "rift engineer",
    "arc-net signal hunter",
    "mana reactor medic",
    "void compliance auditor",
    "relic firmware smuggler",
  ],
};

const PERSONALITY_TRAIT_POOL = [
  "reckless optimist",
  "grim strategist",
  "sarcastic altruist",
  "ceremonial menace",
  "quiet loyalist",
  "chaos enthusiast",
  "soft-hearted bruiser",
  "paranoid analyst",
  "dramatic showstopper",
  "methodical avenger",
  "joyfully stubborn",
  "reluctant icon",
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number.isFinite(value) ? value : 0;
}

function clampInt(value: number, min: number, max: number): number {
  const floor = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, floor));
}

function slugify(value: string): string {
  const token = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return token.length > 0 ? token : "token";
}

function uniqueStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const clean = item.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const inner = keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",");
  return `{${inner}}`;
}

function normalizeCreatureFocus(value: ForgeInput["creatureFocus"]): string[] {
  if (Array.isArray(value)) return uniqueStrings(value.map((entry) => String(entry)));
  if (typeof value === "string") return uniqueStrings([value]);
  return [];
}

function parseManualSeed(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampInt(value, 0, MAX_SEED);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function pickUnique(seed: number, label: string, pool: readonly string[], count: number): string[] {
  const clampedCount = Math.max(0, Math.min(count, pool.length));
  const picked: string[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  while (picked.length < clampedCount && cursor < pool.length * 6) {
    const value = rngPick(seed, `${label}:${cursor}`, pool);
    if (!seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      picked.push(value);
    }
    cursor += 1;
  }
  if (picked.length < clampedCount) {
    for (const value of pool) {
      if (picked.length >= clampedCount) break;
      if (seen.has(value.toLowerCase())) continue;
      seen.add(value.toLowerCase());
      picked.push(value);
    }
  }
  return picked;
}

function ensureMinUniqueStrings(values: string[], minCount: number, fallbackPool: readonly string[]): string[] {
  const out = uniqueStrings(values);
  if (out.length >= minCount) return out;
  for (const candidate of fallbackPool) {
    if (out.length >= minCount) break;
    const clean = candidate.trim();
    if (!clean) continue;
    if (out.some((entry) => entry.toLowerCase() === clean.toLowerCase())) continue;
    out.push(clean);
  }
  return out;
}

function resolveForgeInput(rawInput: ForgeInput): ForgeInput {
  const parsed = ForgeInputSchema.parse(rawInput);
  const manualSeedOverride = parseManualSeed(parsed.manualSeedOverride);
  const randomizationMode = parsed.randomizationMode ?? DEFAULTS.randomizationMode;
  const seedPrimeHex = md5Hex(`${parsed.title}::${parsed.description}::${manualSeedOverride ?? "auto"}`);
  const seedPrime = clampInt(Number.parseInt(seedPrimeHex.slice(0, 8), 16), 1, MAX_SEED);

  const modeIsFullRandom = randomizationMode === "fullyRandom";
  const modeIsThemeLockedRandom = randomizationMode === "themeLockedRandom";

  const pickTonePreset = () => rngPick(seedPrime, "forge:tonePreset", Object.keys(FORGE_PRESETS) as TonePreset[]);
  const tonePreset = modeIsFullRandom
    ? pickTonePreset()
    : parsed.tonePreset ?? (modeIsThemeLockedRandom ? pickTonePreset() : DEFAULT_PRESET);

  const selectedPresets = (() => {
    if (modeIsFullRandom) {
      return uniqueStrings([
        tonePreset,
        rngPick(seedPrime, "forge:preset:1", Object.keys(FORGE_PRESETS) as TonePreset[]),
      ]) as TonePreset[];
    }
    if (Array.isArray(parsed.selectedPresets) && parsed.selectedPresets.length > 0) {
      return uniqueStrings([tonePreset, ...parsed.selectedPresets]) as TonePreset[];
    }
    return [tonePreset];
  })();

  const pickOptional = <T,>(args: {
    provided: T | undefined;
    fallback: T;
    randomPool: readonly T[];
    label: string;
  }): T => {
    if (modeIsFullRandom) return rngPick(seedPrime, args.label, args.randomPool);
    if (typeof args.provided !== "undefined") return args.provided;
    if (modeIsThemeLockedRandom) return rngPick(seedPrime, args.label, args.randomPool);
    return args.fallback;
  };

  const humorLevel = pickOptional<number>({
    provided: parsed.humorLevel,
    fallback: DEFAULTS.humorLevel,
    randomPool: [0, 1, 2, 3, 4, 5] as const,
    label: "forge:humor",
  });
  const lethality = pickOptional<LethalityLevel>({
    provided: parsed.lethality,
    fallback: DEFAULTS.lethality,
    randomPool: ["low", "medium", "high", "brutal"] as const,
    label: "forge:lethality",
  });
  const magicDensity = pickOptional<DensityLevel>({
    provided: parsed.magicDensity,
    fallback: DEFAULTS.magicDensity,
    randomPool: ["low", "medium", "high", "wild"] as const,
    label: "forge:magicDensity",
  });
  const techLevel = pickOptional<TechLevel>({
    provided: parsed.techLevel,
    fallback: DEFAULTS.techLevel,
    randomPool: ["primitive", "medieval", "steampunk", "arcane-tech"] as const,
    label: "forge:techLevel",
  });
  const factionComplexity = pickOptional<ComplexityLevel>({
    provided: parsed.factionComplexity,
    fallback: DEFAULTS.factionComplexity,
    randomPool: ["low", "medium", "high"] as const,
    label: "forge:factionComplexity",
  });
  const worldSize = pickOptional<WorldSize>({
    provided: parsed.worldSize,
    fallback: DEFAULTS.worldSize,
    randomPool: ["small", "medium", "large"] as const,
    label: "forge:worldSize",
  });

  const focusProvided = normalizeCreatureFocus(parsed.creatureFocus);
  const focusResolved = (() => {
    if (modeIsFullRandom) {
      return pickUnique(seedPrime, "forge:focus", CREATURE_FOCUS_POOL, 2);
    }
    if (focusProvided.length > 0) return focusProvided;
    if (modeIsThemeLockedRandom) return pickUnique(seedPrime, "forge:focus:locked", CREATURE_FOCUS_POOL, 2);
    return pickUnique(seedPrime, `forge:focus:${tonePreset}`, FORGE_PRESETS[tonePreset].creatureBias, 2);
  })();

  const startingRegionType = (() => {
    if (modeIsFullRandom) return rngPick(seedPrime, "forge:startingRegion", STARTING_REGION_POOL);
    if (parsed.startingRegionType && parsed.startingRegionType.trim().length > 0) return parsed.startingRegionType.trim();
    if (modeIsThemeLockedRandom) return rngPick(seedPrime, "forge:startingRegion:locked", STARTING_REGION_POOL);
    return DEFAULTS.startingRegionType;
  })();

  const villainArchetype = (() => {
    if (modeIsFullRandom) return rngPick(seedPrime, "forge:villain", VILLAIN_ARCHETYPE_POOL);
    if (parsed.villainArchetype && parsed.villainArchetype.trim().length > 0) return parsed.villainArchetype.trim();
    if (modeIsThemeLockedRandom) return rngPick(seedPrime, "forge:villain:locked", VILLAIN_ARCHETYPE_POOL);
    return DEFAULTS.villainArchetype;
  })();

  const corruptionLevel = clampInt(
    modeIsFullRandom
      ? rngInt(seedPrime, "forge:corruption", 0, 5)
      : typeof parsed.corruptionLevel === "number"
        ? parsed.corruptionLevel
        : modeIsThemeLockedRandom
          ? rngInt(seedPrime, "forge:corruption:locked", 0, 5)
          : DEFAULTS.corruptionLevel,
    0,
    5,
  );

  const divineInterferenceLevel = clampInt(
    modeIsFullRandom
      ? rngInt(seedPrime, "forge:divine", 0, 5)
      : typeof parsed.divineInterferenceLevel === "number"
        ? parsed.divineInterferenceLevel
        : modeIsThemeLockedRandom
          ? rngInt(seedPrime, "forge:divine:locked", 0, 5)
          : DEFAULTS.divineInterferenceLevel,
    0,
    5,
  );

  return {
    ...parsed,
    tonePreset,
    selectedPresets,
    humorLevel,
    lethality,
    magicDensity,
    techLevel,
    creatureFocus: focusResolved,
    factionComplexity,
    worldSize,
    startingRegionType,
    villainArchetype,
    corruptionLevel,
    divineInterferenceLevel,
    randomizationMode,
    playerToggles: parsed.playerToggles ?? {},
    manualSeedOverride,
  };
}

function adjustToneByPreset(base: ToneVector, presets: TonePreset[]): ToneVector {
  const next = { ...base };
  for (const preset of presets) {
    const bias = FORGE_PRESETS[preset].toneBias;
    next.darkness = (next.darkness * 0.64) + (bias.darkness * 0.36);
    next.whimsy = (next.whimsy * 0.64) + (bias.whimsy * 0.36);
    next.brutality = (next.brutality * 0.64) + (bias.brutality * 0.36);
    next.absurdity = (next.absurdity * 0.64) + (bias.absurdity * 0.36);
    next.cosmic = (next.cosmic * 0.64) + (bias.cosmic * 0.36);
    next.heroic = (next.heroic * 0.64) + (bias.heroic * 0.36);
    next.tragic = (next.tragic * 0.64) + (bias.tragic * 0.36);
    next.cozy = (next.cozy * 0.64) + (bias.cozy * 0.36);
  }
  return next;
}

function applyToggleAdjustments(tone: ToneVector, input: ForgeInput): ToneVector {
  const next = { ...tone };
  const humorNorm = clamp01(Number(input.humorLevel ?? DEFAULTS.humorLevel) / 5);

  next.whimsy += (humorNorm - 0.35) * 0.38;
  next.absurdity += humorNorm * 0.24;
  next.darkness -= humorNorm * 0.12;
  next.cozy += humorNorm * 0.18;

  const lethality = input.lethality ?? DEFAULTS.lethality;
  if (lethality === "low") {
    next.brutality -= 0.18;
    next.darkness -= 0.08;
    next.cozy += 0.16;
  } else if (lethality === "high") {
    next.brutality += 0.2;
    next.darkness += 0.12;
    next.tragic += 0.08;
  } else if (lethality === "brutal") {
    next.brutality += 0.34;
    next.darkness += 0.2;
    next.tragic += 0.16;
    next.cozy -= 0.16;
  }

  const magicDensity = input.magicDensity ?? DEFAULTS.magicDensity;
  if (magicDensity === "low") {
    next.cosmic -= 0.16;
  } else if (magicDensity === "high") {
    next.cosmic += 0.18;
    next.heroic += 0.04;
  } else if (magicDensity === "wild") {
    next.cosmic += 0.32;
    next.absurdity += 0.2;
    next.tragic += 0.06;
  }

  const techLevel = input.techLevel ?? DEFAULTS.techLevel;
  if (techLevel === "primitive") {
    next.cozy += 0.06;
    next.heroic += 0.08;
    next.cosmic += 0.06;
  } else if (techLevel === "steampunk") {
    next.absurdity += 0.1;
    next.brutality += 0.06;
  } else if (techLevel === "arcane-tech") {
    next.cosmic += 0.22;
    next.absurdity += 0.1;
    next.darkness += 0.04;
  }

  const corruptionLevel = clampInt(Number(input.corruptionLevel ?? DEFAULTS.corruptionLevel), 0, 5);
  const divineLevel = clampInt(Number(input.divineInterferenceLevel ?? DEFAULTS.divineInterferenceLevel), 0, 5);

  next.darkness += corruptionLevel * 0.055;
  next.tragic += corruptionLevel * 0.04;
  next.cozy -= corruptionLevel * 0.038;

  next.cosmic += divineLevel * 0.06;
  next.heroic += divineLevel * 0.028;
  next.tragic += divineLevel * 0.02;

  const toggles = input.playerToggles ?? {};
  for (const [key, enabled] of Object.entries(toggles)) {
    if (!enabled) continue;
    const token = key.toLowerCase();
    if (token.includes("hard") || token.includes("nightmare")) {
      next.brutality += 0.08;
      next.darkness += 0.06;
    }
    if (token.includes("cozy") || token.includes("relax")) {
      next.cozy += 0.1;
      next.brutality -= 0.06;
    }
    if (token.includes("chaos") || token.includes("wild")) {
      next.absurdity += 0.1;
      next.cosmic += 0.06;
    }
    if (token.includes("hero") || token.includes("story")) {
      next.heroic += 0.09;
    }
  }

  next.darkness = clamp01(next.darkness);
  next.whimsy = clamp01(next.whimsy);
  next.brutality = clamp01(next.brutality);
  next.absurdity = clamp01(next.absurdity);
  next.cosmic = clamp01(next.cosmic);
  next.heroic = clamp01(next.heroic);
  next.tragic = clamp01(next.tragic);
  next.cozy = clamp01(next.cozy);

  return next;
}

function buildThemeTags(input: ForgeInput, toneVector: ToneVector): string[] {
  const tags = [
    ...(input.selectedPresets ?? []),
    input.tonePreset ?? "",
    input.lethality ?? "",
    input.magicDensity ?? "",
    input.techLevel ?? "",
    input.factionComplexity ?? "",
    input.worldSize ?? "",
    input.startingRegionType ?? "",
    input.villainArchetype ?? "",
    ...normalizeCreatureFocus(input.creatureFocus),
  ];

  if (toneVector.darkness >= 0.72) tags.push("bleak");
  if (toneVector.whimsy >= 0.62) tags.push("playful");
  if (toneVector.brutality >= 0.68) tags.push("punishing");
  if (toneVector.absurdity >= 0.62) tags.push("ridiculous");
  if (toneVector.cosmic >= 0.66) tags.push("cosmic");
  if (toneVector.heroic >= 0.68) tags.push("heroic");
  if (toneVector.tragic >= 0.62) tags.push("tragic");
  if (toneVector.cozy >= 0.62) tags.push("cozy");

  return uniqueStrings(tags.map((entry) => String(entry).replace(/[_]+/g, " "))).slice(0, 36);
}

export function buildWorldSeed(input: ForgeInput): WorldSeed {
  const resolvedInput = resolveForgeInput(input);
  const stableMaterial = stableSerialize({
    title: resolvedInput.title,
    description: resolvedInput.description,
    forge: {
      ...resolvedInput,
      creatureFocus: normalizeCreatureFocus(resolvedInput.creatureFocus),
    },
  });

  const seedHash = md5Hex(stableMaterial);
  const manualSeedRaw = parseManualSeed(resolvedInput.manualSeedOverride);
  const seedString = `${manualSeedRaw ?? "auto"}:${seedHash}`;
  const seedNumber = clampInt(Number.parseInt(seedHash.slice(0, 8), 16), 1, MAX_SEED);

  const presetTrace = uniqueStrings([
    ...(resolvedInput.selectedPresets ?? []),
    resolvedInput.tonePreset ?? DEFAULT_PRESET,
  ]) as TonePreset[];

  const toneVector = applyToggleAdjustments(
    adjustToneByPreset(TONE_BASE, presetTrace.length > 0 ? presetTrace : [DEFAULT_PRESET]),
    resolvedInput,
  );

  return WorldSeedSchema.parse({
    worldForgeVersion: WORLD_FORGE_VERSION,
    seedString,
    seedNumber,
    themeTags: buildThemeTags(resolvedInput, toneVector),
    toneVector,
    presetTrace,
    forgeInput: resolvedInput,
  });
}

function weightedBiomePick(seed: number, label: string, tone: ToneVector, startHint: string | undefined): string {
  const startHintToken = (startHint ?? "").toLowerCase();
  return weightedPick(seed, label, BIOME_POOL_COMMON.map((biome) => {
    let weight = 5;
    if (biome === "blightfen" || biome === "catacombs" || biome === "riftwaste") {
      weight += Math.floor((tone.darkness + tone.brutality) * 8);
    }
    if (biome === "honey meadows" || biome === "lantern valley" || biome === "sunfields") {
      weight += Math.floor((tone.cozy + tone.whimsy) * 7);
    }
    if (biome === "riftwaste" || biome === "crystal dunes" || biome === "echo caverns") {
      weight += Math.floor((tone.cosmic + tone.absurdity) * 7);
    }
    if (startHintToken.length > 0 && biome.includes(startHintToken.replace(/\s+/g, ""))) {
      weight += 6;
    }
    return { item: biome, weight: Math.max(1, weight) };
  }));
}

function buildCapitalTown(seed: number, label: string, tone: ToneVector): string {
  const prefixPool = tone.cozy >= 0.55
    ? ["Honey", "Willow", "Lantern", "Clover", "Sun", "Bramble"]
    : tone.darkness >= 0.6
      ? ["Grim", "Black", "Ash", "Rift", "Dusk", "Iron"]
      : ["Moon", "Storm", "Silver", "Oak", "River", "Glow"];
  const suffixPool = ["ford", "haven", "cross", "gate", "rest", "spire", "hollow", "bay"];
  return `${rngPick(seed, `${label}:townPrefix`, prefixPool)}${rngPick(seed, `${label}:townSuffix`, suffixPool)}`;
}

function worldSizeRegionCount(size: WorldSize, seed: number): number {
  if (size === "small") return rngInt(seed, "world:size:small", 5, 7);
  if (size === "large") return rngInt(seed, "world:size:large", 11, 14);
  return rngInt(seed, "world:size:medium", 8, 10);
}

function describeMoralClimate(tone: ToneVector): string {
  if (tone.cozy >= 0.62 && tone.heroic >= 0.58) {
    return "Compassion has social weight, but every favor still carries tactical consequence.";
  }
  if (tone.darkness >= 0.68 && tone.brutality >= 0.62) {
    return "Mercy is rare currency; survival rewards decisive cruelty and punishes hesitation.";
  }
  if (tone.absurdity >= 0.62) {
    return "Ethics bend under spectacle, but hypocrisy is remembered and weaponized.";
  }
  if (tone.heroic >= 0.7) {
    return "Honor matters publicly, and betrayal becomes a multi-faction liability.";
  }
  return "Pragmatism dominates; altruism and brutality both reshape long-term trust.";
}

function generateFactionNames(seed: number, label: string, count: number): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count * 5; i += 1) {
    if (names.length >= count) break;
    const name = `${rngPick(seed, `${label}:adj:${i}`, FACTION_ADJECTIVES)} ${rngPick(seed, `${label}:noun:${i}`, FACTION_NOUNS)}`;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

function conflictCountByComplexity(complexity: ComplexityLevel): number {
  if (complexity === "low") return 3;
  if (complexity === "high") return 6;
  return 4;
}

export function generateWorldBible(seed: WorldSeed): WorldBible {
  const size = (seed.forgeInput.worldSize ?? DEFAULTS.worldSize) as WorldSize;
  const complexity = (seed.forgeInput.factionComplexity ?? DEFAULTS.factionComplexity) as ComplexityLevel;
  const tone = seed.toneVector;

  const worldName = `${rngPick(seed.seedNumber, "worldName:prefix", WORLD_PREFIX_POOL)} ${rngPick(seed.seedNumber, "worldName:suffix", WORLD_SUFFIX_POOL)}`;

  const cosmologyRules = pickUnique(seed.seedNumber, "cosmology", COSMOLOGY_RULE_POOL, 4 + (size === "large" ? 1 : 0));
  const magicSystemFlavor = rngPick(seed.seedNumber, "magicFlavor", MAGIC_FLAVOR_POOL);
  const coreConflicts = pickUnique(seed.seedNumber, "coreConflicts", CONFLICT_POOL, conflictCountByComplexity(complexity));

  const dominantCount = complexity === "low" ? 3 : complexity === "high" ? 6 : 4;
  const minorCount = complexity === "low" ? 3 : complexity === "high" ? 7 : 5;

  const generatedFactions = generateFactionNames(seed.seedNumber, "factionName", dominantCount + minorCount + 2);
  const dominantFactions = generatedFactions.slice(0, dominantCount);
  const minorFactions = generatedFactions.slice(dominantCount, dominantCount + minorCount);

  const biomeDefinitions = pickUnique(seed.seedNumber, "biomeDef", BIOME_POOL_COMMON, size === "large" ? 10 : size === "small" ? 6 : 8)
    .map((biome) => `${biome}: ${rngPick(seed.seedNumber, `biomeDesc:${biome}`, [
      "resource-rich but contested",
      "haunted by old conflicts",
      "strategically vital for travel lanes",
      "volatile weather and unstable magic",
      "civilian settlements cling to fragile safety",
    ])}`);

  const focus = normalizeCreatureFocus(seed.forgeInput.creatureFocus);
  const creatureArchetypes = uniqueStrings([
    ...focus,
    ...pickUnique(seed.seedNumber, "creatureArchetypes", [
      "vampire duelists",
      "rift beasts",
      "clockwork sentinels",
      "grave hounds",
      "rogue paladins",
      "storm witches",
      "slime cadres",
      "dragonkin raiders",
      "masked ninjas",
      "cat mercenaries",
      "dog wardens",
      "cosmic parasites",
      "forest spirits",
      "bone golems",
      "contract killers",
      "anomaly jesters",
    ], 7),
  ]).slice(0, 14);

  const npcSpeechStyle = tone.whimsy >= 0.58
    ? "NPCs speak in quick, vivid banter with tactical jokes and emotional honesty under pressure."
    : tone.darkness >= 0.66
      ? "NPCs speak in clipped, guarded phrases with threat-aware pragmatism and very little sentimental padding."
      : "NPCs speak directly, mixing strategic clarity with occasional dry humor and faction-coded idioms.";

  const namingRules = uniqueStrings([
    ...seed.presetTrace.flatMap((preset) => FORGE_PRESETS[preset].namingStyle),
    "Mix one concrete noun with one dramatic modifier for locations.",
    "Use whimsical escalation for rare loot names even in dark settings.",
    "Faction names should imply ideology and logistics role.",
  ]).slice(0, 7);

  const lootFlavorProfile = uniqueStrings([
    ...pickUnique(seed.seedNumber, "lootFlavor", LOOT_FLOURISHES, 5),
    tone.darkness >= 0.6 ? "flourish should imply risk or curse" : "flourish should imply playful utility",
    tone.absurdity >= 0.58 ? "allow ridiculous suffixes with escalation" : "keep suffixes grounded in setting",
  ]);

  const moralClimate = describeMoralClimate(tone);

  return {
    worldName,
    cosmologyRules,
    magicSystemFlavor,
    coreConflicts,
    dominantFactions,
    minorFactions,
    biomeDefinitions,
    creatureArchetypes,
    npcSpeechStyle,
    namingRules,
    lootFlavorProfile,
    moralClimate,
  };
}

function unpackSeed(seed: WorldSeed | number): { seedNumber: number; toneVector: ToneVector; forgeInput: Partial<ForgeInput> } {
  if (typeof seed === "number") {
    return {
      seedNumber: clampInt(seed, 1, MAX_SEED),
      toneVector: { ...TONE_BASE },
      forgeInput: {},
    };
  }
  return {
    seedNumber: seed.seedNumber,
    toneVector: seed.toneVector,
    forgeInput: seed.forgeInput,
  };
}

export function generateBiomeMap(seed: WorldSeed | number, worldSize: WorldSize = "medium"): BiomeMap {
  const seedMeta = unpackSeed(seed);
  const resolvedWorldSize = (seedMeta.forgeInput.worldSize as WorldSize | undefined) ?? worldSize;
  const regionCount = worldSizeRegionCount(resolvedWorldSize, seedMeta.seedNumber);
  const regions: BiomeMap["regions"] = [];

  for (let index = 0; index < regionCount; index += 1) {
    const dominantBiome = weightedBiomePick(
      seedMeta.seedNumber,
      `biome:${index}`,
      seedMeta.toneVector,
      seedMeta.forgeInput.startingRegionType,
    );
    const corruptionBase = (
      (seedMeta.toneVector.darkness * 0.55)
      + (Number(seedMeta.forgeInput.corruptionLevel ?? DEFAULTS.corruptionLevel) * 0.06)
      + rng01(seedMeta.seedNumber, `biome:corruption:${index}`) * 0.28
    );
    const corruption = clamp01(corruptionBase);

    const dungeonDensity = clamp01(
      0.18
      + (seedMeta.toneVector.darkness * 0.35)
      + (seedMeta.toneVector.brutality * 0.24)
      - (seedMeta.toneVector.cozy * 0.2)
      + (rng01(seedMeta.seedNumber, `biome:dungeonDensity:${index}`) - 0.5) * 0.2,
    );

    const townDensity = clamp01(
      0.58
      - (dungeonDensity * 0.35)
      + (seedMeta.toneVector.cozy * 0.24)
      + (seedMeta.toneVector.heroic * 0.14)
      - (seedMeta.toneVector.darkness * 0.1),
    );

    const regionName = `${rngPick(seedMeta.seedNumber, `biome:regionPrefix:${index}`, [
      "North",
      "South",
      "East",
      "West",
      "Upper",
      "Lower",
      "High",
      "Deep",
      "Outer",
      "Inner",
    ])} ${rngPick(seedMeta.seedNumber, `biome:regionSuffix:${index}`, [
      "March",
      "Basin",
      "Reach",
      "Quarter",
      "Wild",
      "Front",
      "Ward",
      "Circuit",
      "Terrace",
      "Span",
    ])}`;

    regions.push({
      id: `region_${index + 1}`,
      name: regionName,
      dominantBiome,
      corruption,
      dungeonDensity,
      townDensity,
      capitalTown: buildCapitalTown(seedMeta.seedNumber, `biome:capital:${index}`, seedMeta.toneVector),
      tags: uniqueStrings([
        dominantBiome,
        corruption >= 0.62 ? "corrupted" : "stable",
        dungeonDensity >= 0.55 ? "dungeon-heavy" : "town-heavy",
      ]),
    });
  }

  const corruptionZones = regions
    .filter((region) => region.corruption >= 0.55)
    .sort((a, b) => b.corruption - a.corruption)
    .slice(0, Math.max(1, Math.floor(regions.length / 3)))
    .map((region) => ({
      regionId: region.id,
      severity: region.corruption,
      note: region.corruption >= 0.75
        ? "Corruption storms distort landmarks and spawn elite threats."
        : "Corruption pressure spikes faction hostility and dungeon instability.",
    }));

  const averageDungeonDensity = regions.length > 0
    ? clamp01(regions.reduce((sum, region) => sum + region.dungeonDensity, 0) / regions.length)
    : 0.4;

  return {
    worldSize: resolvedWorldSize,
    regions,
    corruptionZones,
    capitalTowns: regions.map((region) => region.capitalTown),
    averageDungeonDensity,
  };
}

function generateFactionAlignment(seed: number, label: string, tone: ToneVector): FactionGraph["factions"][number]["moralAlignment"] {
  const order = clamp01(0.5 + (tone.heroic * 0.2) - (tone.absurdity * 0.24) + (rng01(seed, `${label}:order`) - 0.5) * 0.7) * 2 - 1;
  const mercy = clamp01(0.5 + (tone.cozy * 0.24) + (tone.heroic * 0.18) - (tone.brutality * 0.35) + (rng01(seed, `${label}:mercy`) - 0.5) * 0.7) * 2 - 1;
  const ambition = clamp01(0.5 + (tone.brutality * 0.24) + (tone.cosmic * 0.12) + (rng01(seed, `${label}:ambition`) - 0.5) * 0.7) * 2 - 1;
  return {
    order: Math.max(-1, Math.min(1, Number(order.toFixed(3)))),
    mercy: Math.max(-1, Math.min(1, Number(mercy.toFixed(3)))),
    ambition: Math.max(-1, Math.min(1, Number(ambition.toFixed(3)))),
  };
}

function factionCountByComplexity(complexity: ComplexityLevel): number {
  if (complexity === "low") return 4;
  if (complexity === "high") return 8;
  return 6;
}

export function generateFactionGraph(seed: WorldSeed, worldBible: WorldBible, biomeMap: BiomeMap): FactionGraph {
  const complexity = (seed.forgeInput.factionComplexity ?? DEFAULTS.factionComplexity) as ComplexityLevel;
  const count = factionCountByComplexity(complexity);
  const namePool = uniqueStrings([...worldBible.dominantFactions, ...worldBible.minorFactions, ...generateFactionNames(seed.seedNumber, "graphFaction", count + 4)]);
  const factions: FactionGraph["factions"] = [];

  for (let i = 0; i < count; i += 1) {
    const rawName = namePool[i] ?? `${rngPick(seed.seedNumber, `graph:faction:adj:${i}`, FACTION_ADJECTIVES)} ${rngPick(seed.seedNumber, `graph:faction:noun:${i}`, FACTION_NOUNS)}`;
    const id = `faction_${slugify(rawName)}_${i + 1}`;
    const homeRegion = biomeMap.regions[i % biomeMap.regions.length] ?? biomeMap.regions[0]!;
    const alignment = generateFactionAlignment(seed.seedNumber, `graph:faction:${id}`, seed.toneVector);

    const powerBase = 35 + Math.floor(rng01(seed.seedNumber, `graph:faction:power:${id}`) * 50);
    const powerShift = Math.floor(seed.toneVector.darkness * 8) - Math.floor(seed.toneVector.cozy * 4);

    factions.push({
      id,
      name: rawName,
      ideology: rngPick(seed.seedNumber, `graph:faction:ideology:${id}`, IDEOLOGY_POOL),
      moralAlignment: alignment,
      powerLevel: clampInt(powerBase + powerShift, 10, 95),
      homeRegionId: homeRegion.id,
      goals: pickUnique(seed.seedNumber, `graph:faction:goals:${id}`, FACTION_GOAL_POOL, 2),
    });
  }

  const relations: Record<string, Record<string, number>> = {};
  const tensions: Array<{ summary: string; score: number }> = [];
  for (let i = 0; i < factions.length; i += 1) {
    const a = factions[i]!;
    relations[a.id] = relations[a.id] ?? {};
    for (let j = 0; j < factions.length; j += 1) {
      const b = factions[j]!;
      if (a.id === b.id) {
        relations[a.id]![b.id] = 100;
        continue;
      }
      if (typeof relations[a.id]![b.id] === "number") continue;
      const dist = Math.abs(a.moralAlignment.order - b.moralAlignment.order)
        + Math.abs(a.moralAlignment.mercy - b.moralAlignment.mercy)
        + Math.abs(a.moralAlignment.ambition - b.moralAlignment.ambition);
      const jitter = rngInt(seed.seedNumber, `graph:rel:${a.id}:${b.id}`, -24, 24);
      const relation = clampInt(Math.round(58 - (dist * 28) + jitter), -100, 100);
      relations[a.id]![b.id] = relation;
      relations[b.id] = relations[b.id] ?? {};
      relations[b.id]![a.id] = relation;
      if (relation <= -25) {
        tensions.push({
          summary: `${a.name} and ${b.name} are on the brink of open conflict.`,
          score: relation,
        });
      }
    }
  }

  tensions.sort((left, right) => left.score - right.score);
  const activeTensions = uniqueStrings(tensions.slice(0, 8).map((entry) => entry.summary));
  if (factions.length >= 2 && activeTensions.length < 2) {
    activeTensions.push(`${factions[0]!.name} and ${factions[1]!.name} contest regional influence through proxy violence.`);
  }
  if (factions.length >= 3 && activeTensions.length < 2) {
    activeTensions.push(`${factions[0]!.name} and ${factions[2]!.name} sabotage each other through deniable operatives.`);
  }
  if (factions.length >= 2 && activeTensions.length < 2) {
    activeTensions.push(`${factions[1]!.name} pressures neutral towns to deny supplies to ${factions[0]!.name}.`);
  }

  return {
    factions,
    relations,
    activeTensions: activeTensions.slice(0, 12),
  };
}

function creaturePoolForBiome(biome: string): string[] {
  const direct = BIOME_CREATURE_MAP[biome];
  if (direct) return direct;
  const normalized = biome.toLowerCase();
  if (normalized.includes("rift")) return BIOME_CREATURE_MAP.riftwaste;
  if (normalized.includes("catacomb") || normalized.includes("crypt")) return BIOME_CREATURE_MAP.catacombs;
  if (normalized.includes("meadow") || normalized.includes("field")) return BIOME_CREATURE_MAP["honey meadows"];
  if (normalized.includes("ruin")) return BIOME_CREATURE_MAP["moonlit ruins"];
  return ["bandits", "wild beasts", "cultists", "constructs"];
}

export function generateCreaturePools(seed: WorldSeed, biomeMap: BiomeMap): WorldContext["creaturePools"] {
  const focus = normalizeCreatureFocus(seed.forgeInput.creatureFocus);
  const presetCreatureBias = seed.presetTrace.flatMap((preset) => FORGE_PRESETS[preset].creatureBias);

  const globalPool = uniqueStrings([
    ...focus,
    ...presetCreatureBias,
    ...worldCreatureFallbackByTone(seed.toneVector),
  ]).slice(0, 26);

  const byBiome: Record<string, string[]> = {};
  for (const region of biomeMap.regions) {
    const biomePool = uniqueStrings([
      ...creaturePoolForBiome(region.dominantBiome),
      ...focus,
      ...pickUnique(seed.seedNumber, `creature:extra:${region.id}`, globalPool, 2),
    ]).slice(0, 12);
    byBiome[region.id] = biomePool;
  }

  const highKeywords = ["lord", "ancient", "titan", "behemoth", "dragon", "archon", "void", "grave"];
  const lowKeywords = ["slime", "scout", "bandit", "hound", "sprite", "fox", "cat", "dog"];

  const low = globalPool.filter((entry) => lowKeywords.some((key) => entry.toLowerCase().includes(key)));
  const high = globalPool.filter((entry) => highKeywords.some((key) => entry.toLowerCase().includes(key)));
  const medium = globalPool.filter((entry) => !low.includes(entry) && !high.includes(entry));

  return {
    featuredFocus: focus.slice(0, 6),
    globalPool,
    byBiome,
    byThreatTier: {
      low: ensureMinUniqueStrings((low.length > 0 ? low : globalPool).slice(0, 8), 2, worldCreatureFallbackByTone(seed.toneVector)),
      medium: ensureMinUniqueStrings((medium.length > 0 ? medium : globalPool).slice(0, 8), 2, worldCreatureFallbackByTone(seed.toneVector)),
      high: ensureMinUniqueStrings((high.length > 0 ? high : globalPool.slice(-8)).slice(0, 8), 2, worldCreatureFallbackByTone(seed.toneVector)),
    },
  };
}

function worldCreatureFallbackByTone(tone: ToneVector): string[] {
  const entries: string[] = ["bandits", "war beasts", "rogue mages", "contract killers"];
  if (tone.darkness >= 0.58) entries.push("undead", "plague wardens", "grave hounds");
  if (tone.whimsy >= 0.55) entries.push("slimes", "mischief spirits", "talking cats");
  if (tone.absurdity >= 0.55) entries.push("anomaly clowns", "sentient armor", "gravity ninjas");
  if (tone.cosmic >= 0.55) entries.push("void serpents", "rift angels", "star parasites");
  if (tone.heroic >= 0.6) entries.push("dragons", "champion duelists", "oath knights");
  return uniqueStrings(entries);
}

export function generateNpcStyleRules(seed: WorldSeed, worldBible: WorldBible): NPCStyleRules {
  const tone = seed.toneVector;
  const speechTone = tone.darkness >= 0.66
    ? "hard-edged and wary"
    : tone.cozy >= 0.62
      ? "warm, local, and practical"
      : tone.absurdity >= 0.6
        ? "playfully intense with strange metaphors"
        : "direct tactical vernacular";

  const humorFrequency = clamp01(0.12 + (tone.whimsy * 0.52) + (tone.absurdity * 0.2) - (tone.brutality * 0.2));
  const threatLevel = clamp01(0.24 + (tone.darkness * 0.42) + (tone.brutality * 0.3) - (tone.cozy * 0.26));

  const namingConventions = uniqueStrings([
    ...seed.presetTrace.flatMap((preset) => FORGE_PRESETS[preset].namingStyle),
    "Given name + tactical epithet for notable NPCs",
    "Town names should remain pronounceable in combat callouts",
    ...worldBible.namingRules.slice(0, 2),
  ]).slice(0, 7);

  const signatureIdioms = pickUnique(seed.seedNumber, "npcIdioms", NPC_IDIOM_POOL, 6);

  return {
    speechTone,
    humorFrequency,
    threatLevel,
    namingConventions,
    signatureIdioms,
  };
}

export function generateLootFlavorProfile(seed: WorldSeed): LootFlavorProfile {
  const tone = seed.toneVector;
  const adjectivePool = uniqueStrings([
    ...pickUnique(seed.seedNumber, "lootAdj", LOOT_ADJECTIVES, 8),
    ...(tone.darkness >= 0.62 ? ["Grave", "Cursed", "Doom"] : []),
    ...(tone.cozy >= 0.6 ? ["Cozy", "Honey", "Willow"] : []),
  ]).slice(0, 16);

  const nounPool = uniqueStrings([
    ...pickUnique(seed.seedNumber, "lootNoun", LOOT_NOUNS, 8),
    ...((seed.forgeInput.techLevel ?? DEFAULTS.techLevel) === "steampunk" ? ["Gadget", "Coil"] : []),
  ]).slice(0, 16);

  const flourishPool = uniqueStrings([
    ...pickUnique(seed.seedNumber, "lootFlourish", LOOT_FLOURISHES, 9),
    ...(tone.absurdity >= 0.58 ? ["of Respectful Chaos", "of Tactical Nonsense"] : []),
  ]).slice(0, 18);

  return {
    adjectivePool,
    nounPool,
    flourishPool,
    raritySuffixByTier: {
      common: "(plain)",
      uncommon: "(worn)",
      rare: "(rare)",
      epic: "(epic)",
      legendary: "(legendary)",
      mythic: "(mythic)",
    },
    whimsicalScale: clamp01((tone.whimsy * 0.6) + (tone.absurdity * 0.35)),
  };
}

export function generateMagicRules(seed: WorldSeed): MagicRules {
  const density = (seed.forgeInput.magicDensity ?? DEFAULTS.magicDensity) as MagicRules["density"];
  const tone = seed.toneVector;
  const volatility = clamp01(
    0.2
    + (density === "wild" ? 0.25 : density === "high" ? 0.12 : density === "low" ? -0.08 : 0)
    + (tone.cosmic * 0.24)
    + (tone.absurdity * 0.18),
  );

  return {
    density,
    volatility,
    schools: pickUnique(seed.seedNumber, "magicSchools", MAGIC_SCHOOL_POOL, 6),
    tabooPractices: pickUnique(seed.seedNumber, "magicTaboo", MAGIC_TABOO_POOL, 3),
    cosmicLeakage: clamp01((tone.cosmic * 0.72) + (density === "wild" ? 0.22 : 0.04)),
  };
}

export function generateDMBehaviorProfile(seed: WorldSeed): DMBehaviorProfile {
  const tone = seed.toneVector;
  const crueltyBias = clamp01(0.22 + (tone.darkness * 0.42) + (tone.brutality * 0.34) - (tone.cozy * 0.26));
  const generosityBias = clamp01(0.22 + (tone.heroic * 0.32) + (tone.cozy * 0.34) - (tone.darkness * 0.22));
  const chaosBias = clamp01(0.16 + (tone.absurdity * 0.52) + (tone.cosmic * 0.22));
  const fairnessBias = clamp01(0.42 + (tone.heroic * 0.22) + (tone.cozy * 0.16) - (chaosBias * 0.2));
  const humorBias = clamp01(0.08 + (tone.whimsy * 0.55) + (tone.absurdity * 0.2) - (tone.brutality * 0.12));
  const memoryDepth = clampInt(4 + Math.round((fairnessBias * 8) + (tone.cosmic * 4)), 4, 18);

  return DMBehaviorProfileSchema.parse({
    crueltyBias,
    generosityBias,
    chaosBias,
    fairnessBias,
    humorBias,
    memoryDepth,
  });
}

function buildDmContext(worldSeed: WorldSeed, dmBehaviorProfile: DMBehaviorProfile): DMContext {
  const directives = [
    "Keep narration anchored to seeded conflicts, faction tensions, and biome pressure.",
    "Reward intelligent risk occasionally, but punish sloppy certainty quickly.",
    "Use moral climate as a persistent filter for consequences and NPC reactions.",
    "Reference at least one world-specific noun every turn where practical.",
    "Mischief is allowed; contradiction is not.",
    "Preserve deterministic logic and avoid arbitrary outcomes.",
  ];

  const tacticalDirectives = [
    "Escalate villain pressure when player actions increase chaos or brutality.",
    "Thread faction relationships through rumors, shop tone, and encounter framing.",
    "Use biome atmosphere to modulate threat pacing and rewards.",
    "Mirror generosity with temporary opportunities, not permanent safety.",
    "Condense repeated status outcomes while preserving tactical readability.",
  ];

  return DMContextSchema.parse({
    worldSeed,
    dmBehaviorProfile,
    narrativeDirectives: directives,
    tacticalDirectives,
  });
}

function buildInitialWorldState(args: {
  worldSeed: WorldSeed;
  worldBible: WorldBible;
  biomeMap: BiomeMap;
  factionGraph: FactionGraph;
}): WorldState {
  const { worldSeed, worldBible, biomeMap, factionGraph } = args;
  const factionStates = factionGraph.factions.map((faction) => ({
    factionId: faction.id,
    powerLevel: faction.powerLevel,
    trustDelta: 0,
    lastActionTick: 0,
  }));

  return WorldStateSchema.parse({
    seedNumber: worldSeed.seedNumber,
    worldName: worldBible.worldName,
    tick: 0,
    activeTowns: biomeMap.capitalTowns.slice(0, 8),
    activeRumors: uniqueStrings([
      ...worldBible.coreConflicts.slice(0, 3),
      ...factionGraph.activeTensions.slice(0, 2),
    ]),
    collapsedDungeons: [],
    villainEscalation: clampInt(Math.round((worldSeed.toneVector.darkness + worldSeed.toneVector.brutality) * 14), 0, 999),
    factionStates,
    history: [],
  });
}

export function buildCampaignContext(input: ForgeInput): CampaignContext {
  const worldSeed = buildWorldSeed(input);
  const worldBible = generateWorldBible(worldSeed);
  const biomeMap = generateBiomeMap(worldSeed, (worldSeed.forgeInput.worldSize ?? DEFAULTS.worldSize) as WorldSize);
  const factionGraph = generateFactionGraph(worldSeed, worldBible, biomeMap);
  const creaturePools = generateCreaturePools(worldSeed, biomeMap);
  const npcStyleRules = generateNpcStyleRules(worldSeed, worldBible);
  const lootFlavorProfile = generateLootFlavorProfile(worldSeed);
  const magicRules = generateMagicRules(worldSeed);
  const dmBehaviorProfile = generateDMBehaviorProfile(worldSeed);
  const worldState = buildInitialWorldState({ worldSeed, worldBible, biomeMap, factionGraph });

  const worldContext: WorldContext = {
    worldSeed,
    worldBible,
    biomeMap,
    factionGraph,
    creaturePools,
    npcStyleRules,
    lootFlavorProfile,
    magicRules,
    worldState,
  };

  const dmContext = buildDmContext(worldSeed, dmBehaviorProfile);

  return CampaignContextSchema.parse({
    worldForgeVersion: WORLD_FORGE_VERSION,
    title: worldSeed.forgeInput.title,
    description: worldSeed.forgeInput.description,
    worldSeed,
    worldContext,
    dmContext,
  });
}

export function buildWorldProfilePayload(args: {
  source: string;
  campaignContext: CampaignContext;
  templateKey?: string;
}): Record<string, unknown> {
  const { source, campaignContext, templateKey } = args;
  const worldContext = campaignContext.worldContext;
  const dmBehavior = campaignContext.dmContext.dmBehaviorProfile;

  return {
    source,
    world_forge_version: WORLD_FORGE_VERSION,
    template_key: templateKey ?? null,
    seed: campaignContext.worldSeed.seedNumber,
    seed_string: campaignContext.worldSeed.seedString,
    theme_tags: campaignContext.worldSeed.themeTags,
    tone_vector: campaignContext.worldSeed.toneVector,
    world_name: worldContext.worldBible.worldName,
    moral_climate: worldContext.worldBible.moralClimate,
    core_conflicts: worldContext.worldBible.coreConflicts,
    dominant_factions: worldContext.worldBible.dominantFactions,
    active_tensions: worldContext.factionGraph.activeTensions,
    campaign_context: campaignContext,
    world_context: worldContext,
    dm_context: campaignContext.dmContext,
    dm_behavior_profile: dmBehavior,
    world_state: worldContext.worldState,
  };
}

export function summarizeWorldContext(campaignContext: CampaignContext): Record<string, unknown> {
  const world = campaignContext.worldContext;
  return {
    world_forge_version: campaignContext.worldForgeVersion,
    world_name: world.worldBible.worldName,
    tone_vector: campaignContext.worldSeed.toneVector,
    theme_tags: campaignContext.worldSeed.themeTags,
    moral_climate: world.worldBible.moralClimate,
    core_conflicts: world.worldBible.coreConflicts.slice(0, 4),
    dominant_factions: world.factionGraph.factions.slice(0, 6).map((faction) => ({
      id: faction.id,
      name: faction.name,
      power: faction.powerLevel,
      ideology: faction.ideology,
    })),
    faction_tensions: world.factionGraph.activeTensions.slice(0, 5),
    biome_atmosphere: world.biomeMap.regions.slice(0, 6).map((region) => ({
      id: region.id,
      name: region.name,
      dominant_biome: region.dominantBiome,
      corruption: region.corruption,
      dungeon_density: region.dungeonDensity,
      capital_town: region.capitalTown,
    })),
    creature_focus: world.creaturePools.featuredFocus,
    magic_rules: {
      density: world.magicRules.density,
      volatility: world.magicRules.volatility,
      schools: world.magicRules.schools.slice(0, 4),
    },
    loot_flavor: {
      whimsical_scale: world.lootFlavorProfile.whimsicalScale,
      flourish_samples: world.lootFlavorProfile.flourishPool.slice(0, 4),
    },
    dm_behavior_profile: campaignContext.dmContext.dmBehaviorProfile,
  };
}

export function coerceCampaignContextFromProfile(args: {
  seedTitle: string;
  seedDescription: string;
  templateKey?: string;
  worldProfileJson?: Record<string, unknown>;
}): CampaignContext {
  const worldProfileJson = args.worldProfileJson ?? {};

  const embeddedContext = (worldProfileJson.campaign_context ?? worldProfileJson.campaignContext) as unknown;
  if (embeddedContext) {
    const parsed = CampaignContextSchema.safeParse(embeddedContext);
    if (parsed.success) return parsed.data;
  }

  const seedRecord = asRecord(worldProfileJson.world_seed ?? worldProfileJson.worldSeed);
  const manualSeedOverride = parseManualSeed(
    worldProfileJson.seed
      ?? seedRecord.seed
      ?? seedRecord.seed_number
      ?? (asRecord(worldProfileJson.world_context).worldSeed as Record<string, unknown> | undefined)?.seedNumber,
  );

  const patchRaw = ForgeInputPatchSchema.safeParse(
    asRecord(worldProfileJson.forge_input ?? worldProfileJson.forgeInput),
  );

  const patch = patchRaw.success ? patchRaw.data : {};
  const fallbackTonePreset = templateToPreset(args.templateKey ?? "custom");

  const forgeInput: ForgeInput = ForgeInputSchema.parse({
    title: args.seedTitle,
    description: args.seedDescription,
    tonePreset: patch.tonePreset ?? fallbackTonePreset,
    selectedPresets: patch.selectedPresets,
    humorLevel: patch.humorLevel,
    lethality: patch.lethality,
    magicDensity: patch.magicDensity,
    techLevel: patch.techLevel,
    creatureFocus: patch.creatureFocus,
    factionComplexity: patch.factionComplexity,
    worldSize: patch.worldSize,
    startingRegionType: patch.startingRegionType,
    villainArchetype: patch.villainArchetype,
    corruptionLevel: patch.corruptionLevel,
    divineInterferenceLevel: patch.divineInterferenceLevel,
    randomizationMode: patch.randomizationMode,
    playerToggles: patch.playerToggles,
    manualSeedOverride: patch.manualSeedOverride ?? manualSeedOverride,
  });

  return buildCampaignContext(forgeInput);
}

function bucketMoralLean(value: number): string {
  if (value >= 0.4) return "idealistic";
  if (value <= -0.4) return "ruthless";
  return "pragmatic";
}

function resolveRegionByInput(worldContext: WorldContext, rawRegion: string | undefined, seedNumber: number): BiomeMap["regions"][number] {
  const regions = worldContext.biomeMap.regions;
  if (rawRegion && rawRegion.trim().length > 0) {
    const token = rawRegion.trim().toLowerCase();
    const hit = regions.find((region) => region.id.toLowerCase() === token || region.name.toLowerCase() === token || region.name.toLowerCase().includes(token));
    if (hit) return hit;
  }
  return regions[rngInt(seedNumber, "character:originRegion", 0, regions.length - 1)]!;
}

function resolveFactionByInput(worldContext: WorldContext, rawFaction: string | undefined, originRegionId: string, seedNumber: number) {
  const factions = worldContext.factionGraph.factions;
  if (rawFaction && rawFaction.trim().length > 0) {
    const token = rawFaction.trim().toLowerCase();
    const hit = factions.find((faction) => faction.id.toLowerCase() === token || faction.name.toLowerCase() === token || faction.name.toLowerCase().includes(token));
    if (hit) return hit;
  }
  const regional = factions.find((faction) => faction.homeRegionId === originRegionId);
  if (regional) return regional;
  return factions[rngInt(seedNumber, "character:faction", 0, factions.length - 1)]!;
}

function pickBackground(techLevel: string, seedNumber: number, label: string): string {
  const pool = BACKGROUND_POOL_BY_TECH[techLevel] ?? BACKGROUND_POOL_BY_TECH.medieval;
  return rngPick(seedNumber, label, pool);
}

function pickPersonalityTraits(seedNumber: number, label: string): string[] {
  return pickUnique(seedNumber, label, PERSONALITY_TRAIT_POOL, 3);
}

export function forgeCharacterFromWorld(args: {
  campaignContext: CampaignContext;
  input?: CharacterForgeInput;
}): CharacterForgeOutput {
  const campaignContext = CampaignContextSchema.parse(args.campaignContext);
  const rawInput = CharacterForgeInputSchema.parse(args.input ?? {});
  const worldContext = campaignContext.worldContext;
  const seedNumber = campaignContext.worldSeed.seedNumber;

  const originRegion = resolveRegionByInput(worldContext, rawInput.originRegionId, seedNumber);
  const alignedFaction = resolveFactionByInput(worldContext, rawInput.factionAlignmentId, originRegion.id, seedNumber);
  const background = rawInput.background && rawInput.background.trim().length > 0
    ? rawInput.background.trim()
    : pickBackground(String(campaignContext.worldSeed.forgeInput.techLevel ?? "medieval"), seedNumber, "character:background");

  const personalityTraits = rawInput.personalityTraits && rawInput.personalityTraits.length >= 2
    ? uniqueStrings(rawInput.personalityTraits).slice(0, 5)
    : pickPersonalityTraits(seedNumber, "character:traits");

  const moralFromTone = (
    (campaignContext.worldSeed.toneVector.heroic + campaignContext.worldSeed.toneVector.cozy)
    - (campaignContext.worldSeed.toneVector.darkness + campaignContext.worldSeed.toneVector.brutality)
  ) * 0.5;
  const moralLeaning = Math.max(-1, Math.min(1,
    typeof rawInput.moralLeaning === "number"
      ? rawInput.moralLeaning
      : moralFromTone + ((rng01(seedNumber, "character:moral") - 0.5) * 0.35),
  ));

  const npcStyle = worldContext.npcStyleRules;
  const startingNpcRelationships: Record<string, number> = {};
  for (let i = 0; i < 3; i += 1) {
    const npcName = `${rngPick(seedNumber, `character:npc:prefix:${i}`, ["Mira", "Kael", "Oona", "Rook", "Pip", "Sable", "Iris", "Bram"])} ${rngPick(seedNumber, `character:npc:suffix:${i}`, ["of the Gate", "Lanternwright", "Market Scribe", "Route Warden", "Bellrunner", "Whisper Clerk"])};`;
    const relationBase = Math.round((moralLeaning * 22) + (npcStyle.humorFrequency * 8) - (npcStyle.threatLevel * 6));
    const delta = rngInt(seedNumber, `character:npc:relation:${i}`, -12, 16);
    startingNpcRelationships[npcName.replace(/;$/, "")] = clampInt(relationBase + delta, -100, 100);
  }

  const initialFactionTrust: Record<string, number> = {};
  for (const faction of worldContext.factionGraph.factions) {
    const base = faction.id === alignedFaction.id ? 22 : -4;
    const mercyFactor = faction.moralAlignment.mercy * 10;
    const ambitionPenalty = faction.moralAlignment.ambition * 6;
    initialFactionTrust[faction.id] = clampInt(Math.round(base + (moralLeaning * 14) + mercyFactor - ambitionPenalty), -100, 100);
  }

  const startingRumors = uniqueStrings([
    ...worldContext.worldState.activeRumors.slice(0, 3),
    ...worldContext.worldBible.coreConflicts.slice(0, 2),
    `${alignedFaction.name} is quietly watching newcomers from ${originRegion.name}.`,
  ]).slice(0, 6);

  const startingFlags = uniqueStrings([
    `origin:${originRegion.id}`,
    `faction:${alignedFaction.id}`,
    `background:${slugify(background)}`,
    `moral:${bucketMoralLean(moralLeaning)}`,
    ...personalityTraits.map((trait) => `trait:${slugify(trait)}`),
  ]).slice(0, 10);

  return CharacterForgeOutputSchema.parse({
    originRegionId: originRegion.id,
    originRegionName: originRegion.name,
    factionAlignmentId: alignedFaction.id,
    factionAlignmentName: alignedFaction.name,
    background,
    personalityTraits,
    moralLeaning: Number(moralLeaning.toFixed(3)),
    startingTown: originRegion.capitalTown,
    startingNpcRelationships,
    initialFactionTrust,
    startingRumors,
    startingFlags,
  });
}

export function applyCharacterForgeToState(
  runtimeState: Record<string, unknown>,
  forged: CharacterForgeOutput,
): Record<string, unknown> {
  const baseState = asRecord(runtimeState);
  const rumors = Array.isArray(baseState.rumors) ? [...baseState.rumors] : [];
  const discoveryLog = Array.isArray(baseState.discovery_log) ? [...baseState.discovery_log] : [];
  const factionsPresent = Array.isArray(baseState.factions_present) ? [...baseState.factions_present] : [];
  const townRelationships = asRecord(baseState.town_relationships);

  const mergedRumors = uniqueStrings([
    ...rumors.map((entry) => String(entry)),
    ...forged.startingRumors,
  ]).slice(-26);

  const nextTownRelationships: Record<string, unknown> = { ...townRelationships };
  for (const [npcName, value] of Object.entries(forged.startingNpcRelationships)) {
    nextTownRelationships[npcName] = clampInt(Number(value), -100, 100);
  }

  const mergedFactions = uniqueStrings([
    ...factionsPresent.map((entry) => String(entry)),
    forged.factionAlignmentName,
  ]).slice(0, 10);

  discoveryLog.push({
    kind: "character_forge",
    detail: `${forged.originRegionName} origin; aligned with ${forged.factionAlignmentName}; start at ${forged.startingTown}.`,
    flags: forged.startingFlags,
  });

  return {
    ...baseState,
    rumors: mergedRumors,
    factions_present: mergedFactions,
    town_relationships: nextTownRelationships,
    character_forge_profile: forged,
    starting_town: forged.startingTown,
    discovery_log: discoveryLog.slice(-60),
    world_context: {
      ...asRecord(baseState.world_context),
      last_character_origin: forged.originRegionId,
      last_character_faction: forged.factionAlignmentId,
    },
  };
}

export function updateWorldState(worldState: WorldState, playerAction: PlayerWorldAction): WorldState {
  const state = WorldStateSchema.parse(worldState);
  const action = PlayerWorldActionSchema.parse(playerAction);
  const nextTick = state.tick + 1;

  const targetFactionId = action.targetFactionId ?? "";
  const factionStates = state.factionStates.map((factionState) => {
    const isTarget = targetFactionId.length > 0 && factionState.factionId === targetFactionId;
    const moralImpact = Number(action.moralImpact ?? 0);
    const generosityImpact = Number(action.generosityImpact ?? 0);
    const chaosImpact = Number(action.chaosImpact ?? 0);
    const brutalityImpact = Number(action.brutalityImpact ?? 0);
    const randomPowerShift = rngInt(state.seedNumber, `world:faction:power:${nextTick}:${factionState.factionId}`, -3, 3);
    const randomTrustShift = rngInt(state.seedNumber, `world:faction:trust:${nextTick}:${factionState.factionId}`, -4, 4);

    const powerDelta = randomPowerShift
      + Math.round((isTarget ? 4 : 0) + (brutalityImpact * 3) + (chaosImpact * 2) - (generosityImpact * 2));
    const trustDelta = randomTrustShift
      + Math.round((isTarget ? 3 : 0) + (moralImpact * 8) + (generosityImpact * 6) - (brutalityImpact * 7));

    return {
      factionId: factionState.factionId,
      powerLevel: clampInt(factionState.powerLevel + powerDelta, 1, 120),
      trustDelta: clampInt(factionState.trustDelta + trustDelta, -100, 100),
      lastActionTick: nextTick,
    };
  });

  const actionSummary = action.summary && action.summary.trim().length > 0
    ? action.summary.trim()
    : action.actionType;

  const escalationDelta = Math.round(
    Math.max(0, Number(action.brutalityImpact ?? 0) * 8)
    + Math.max(0, Number(action.chaosImpact ?? 0) * 6)
    - Math.max(0, Number(action.generosityImpact ?? 0) * 4)
    + rngInt(state.seedNumber, `world:escalation:${nextTick}`, 0, 3),
  );
  const villainEscalation = clampInt(state.villainEscalation + escalationDelta, 0, 999);

  const rumorPrefix = rngPick(state.seedNumber, `world:rumorPrefix:${nextTick}`, [
    "Street whisper",
    "Courier report",
    "Campfire rumor",
    "Temple bulletin",
    "Guild leak",
    "Questionable prophecy",
  ]);
  const dynamicRumor = `${rumorPrefix}: ${actionSummary}.`;
  const activeRumors = uniqueStrings([...state.activeRumors, dynamicRumor]).slice(-40);

  const collapsedDungeons = [...state.collapsedDungeons];
  const collapseTriggered = (Array.isArray(action.tags) && action.tags.some((tag) => tag.toLowerCase().includes("collapse")))
    || rng01(state.seedNumber, `world:collapse:${nextTick}`) > 0.86;
  if (collapseTriggered) {
    const dungeonName = `${rngPick(state.seedNumber, `world:collapseNamePrefix:${nextTick}`, ["Old", "Black", "Sable", "Thorn", "Glass", "Cinder"])} ${rngPick(state.seedNumber, `world:collapseNameSuffix:${nextTick}`, ["Vault", "Catacomb", "Spire", "Labyrinth", "Den", "Keep"])}`;
    collapsedDungeons.push(dungeonName);
  }

  const activeTowns = [...state.activeTowns];
  const townRenameChance = rng01(state.seedNumber, `world:townRename:${nextTick}`);
  if (townRenameChance > 0.9 && activeTowns.length > 0) {
    const townIndex = rngInt(state.seedNumber, `world:townRename:index:${nextTick}`, 0, activeTowns.length - 1);
    const oldTown = activeTowns[townIndex]!;
    const renamed = `${oldTown.split(" ")[0] ?? oldTown} ${rngPick(state.seedNumber, `world:townRename:suffix:${nextTick}`, ["Cross", "Ward", "Rest", "Gate", "Rise"])}`;
    activeTowns[townIndex] = renamed;
  }

  const nextHistory = [...state.history, {
    tick: nextTick,
    type: action.actionType,
    summary: actionSummary,
    impacts: {
      moral: Number(action.moralImpact ?? 0),
      chaos: Number(action.chaosImpact ?? 0),
      generosity: Number(action.generosityImpact ?? 0),
      brutality: Number(action.brutalityImpact ?? 0),
      escalation_delta: escalationDelta,
    },
  }].slice(-120);

  return WorldStateSchema.parse({
    ...state,
    tick: nextTick,
    factionStates,
    villainEscalation,
    activeRumors,
    collapsedDungeons: uniqueStrings(collapsedDungeons).slice(-40),
    activeTowns,
    history: nextHistory,
  });
}

export function applyWorldGrowthToContext(args: {
  campaignContext: CampaignContext;
  playerAction: PlayerWorldAction;
}): CampaignContext {
  const campaignContext = CampaignContextSchema.parse(args.campaignContext);
  const nextWorldState = updateWorldState(campaignContext.worldContext.worldState, args.playerAction);
  const worldContext: WorldContext = {
    ...campaignContext.worldContext,
    worldState: nextWorldState,
  };
  const updated: CampaignContext = {
    ...campaignContext,
    worldContext,
  };
  return CampaignContextSchema.parse(updated);
}

export function fromTemplateKey(input: {
  title: string;
  description: string;
  templateKey: TemplateKey;
  manualSeedOverride?: string | number;
  forgePatch?: Record<string, unknown>;
}): CampaignContext {
  const patch = ForgeInputPatchSchema.safeParse(input.forgePatch ?? {});
  const forgeInput = ForgeInputSchema.parse({
    title: input.title,
    description: input.description,
    tonePreset: patch.success && patch.data.tonePreset ? patch.data.tonePreset : templateToPreset(input.templateKey),
    selectedPresets: patch.success ? patch.data.selectedPresets : undefined,
    humorLevel: patch.success ? patch.data.humorLevel : undefined,
    lethality: patch.success ? patch.data.lethality : undefined,
    magicDensity: patch.success ? patch.data.magicDensity : undefined,
    techLevel: patch.success ? patch.data.techLevel : undefined,
    creatureFocus: patch.success ? patch.data.creatureFocus : undefined,
    factionComplexity: patch.success ? patch.data.factionComplexity : undefined,
    worldSize: patch.success ? patch.data.worldSize : undefined,
    startingRegionType: patch.success ? patch.data.startingRegionType : undefined,
    villainArchetype: patch.success ? patch.data.villainArchetype : undefined,
    corruptionLevel: patch.success ? patch.data.corruptionLevel : undefined,
    divineInterferenceLevel: patch.success ? patch.data.divineInterferenceLevel : undefined,
    randomizationMode: patch.success ? patch.data.randomizationMode : undefined,
    playerToggles: patch.success ? patch.data.playerToggles : undefined,
    manualSeedOverride: patch.success ? patch.data.manualSeedOverride ?? input.manualSeedOverride : input.manualSeedOverride,
  });
  return buildCampaignContext(forgeInput);
}
