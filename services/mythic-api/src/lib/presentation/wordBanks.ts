import type { ToneMode } from "./types.js";

export const SPELL_CLASSIC = [
  "Fireball",
  "Ice Shard",
  "Lightning Bolt",
  "Stone Spike",
  "Wind Slash",
  "Water Jet",
  "Light Beam",
  "Shadow Blink",
] as const;

export const SPELL_ENHANCED = [
  "Greater",
  "Grand",
  "Burst",
  "Surge",
  "Strike",
  "Blast",
  "Nova",
  "Lance",
  "Wave",
] as const;

export const SPELL_HEROIC = [
  "Inferno",
  "Tempest",
  "Radiant",
  "Storm",
  "Prism",
  "Glacier",
  "Starfire",
  "Skybreaker",
  "Emberstorm",
] as const;

export const SPELL_MYTHIC = [
  "Cataclysm",
  "Supernova",
  "Celestial",
  "Omega",
  "Eternal",
  "Infinite",
  "Heavenfall",
  "Sunburst",
  "Moonflare",
] as const;

export const SPELL_ABSURD = [
  "Ultra",
  "Hyper",
  "Turbo",
  "Supreme",
  "Deluxe",
  "EX",
  "Final",
  "Ultimate",
  "Maximum",
] as const;

export const SPELL_WHIMSY = [
  "Sparkle",
  "Zappy",
  "Fizzy",
  "Boomy",
  "Twinkly",
  "Snappy",
  "Glowy",
  "Shiny",
  "Whirly",
  "Fluffy",
  "Crackly",
  "Zingy",
  "Peppy",
  "Bouncy",
] as const;

export const TITLE_STANDARD_CLASSES = [
  "Wizard",
  "Knight",
  "Ranger",
  "Cleric",
  "Rogue",
  "Paladin",
  "Bard",
  "Druid",
  "Warlock",
] as const;

export const TITLE_WHIMSICAL_CLASSES = [
  "Snackomancer",
  "Chaos Intern",
  "Goblin Priest",
  "Dungeon Inspector",
  "Dragon Therapist",
  "Sword Accountant",
  "Cloud Puncher",
  "Spell DJ",
  "Potion Enthusiast",
  "Professional Sidekick",
] as const;

export const TOWN_SYLLABLE_A = [
  "Honey",
  "Berry",
  "Brook",
  "Vale",
  "Glow",
  "Sun",
  "Moon",
  "Clover",
  "Sparkle",
  "Willow",
  "Lantern",
  "Apple",
  "Moss",
  "Puddle",
  "Rainbow",
] as const;

export const TOWN_SYLLABLE_B = [
  "haven",
  "ford",
  "glen",
  "hollow",
  "crossing",
  "rest",
  "meadow",
  "bay",
  "field",
  "crest",
] as const;

export const MONSTER_CORE = [
  "Slime",
  "Goblin",
  "Sprite",
  "Wyrm",
  "Drake",
  "Golem",
  "Kitty",
  "Serpent",
  "Mimic",
  "Crab",
  "Spider",
  "Treant",
  "Beast",
  "Goose",
] as const;

export const MONSTER_ENHANCER = [
  "Mega",
  "Dire",
  "Ancient",
  "Spark",
  "Storm",
  "Crystal",
  "Bubble",
  "Shadow",
  "Flame",
  "Frost",
  "Thunder",
] as const;

export const BOARD_OPENERS = [
  "The contract is live.",
  "Someone is watching.",
  "Lanternlight hides teeth.",
  "The square smells like trouble.",
  "That contract won't wait.",
  "The road won't forgive hesitation.",
  "You feel eyes on you.",
  "The healer is overwhelmed.",
  "Time is thinning.",
] as const;

export const NARRATION_VERBS = [
  "strike",
  "smash",
  "crack",
  "detonate",
  "burst",
  "snap",
  "slice",
  "slam",
  "flash",
  "shatter",
  "ignite",
  "freeze",
  "zap",
  "crash",
  "whirl",
  "boom",
  "bonk",
] as const;

export const ENEMY_VOICE = {
  aggressive: ["It commits.", "No hesitation.", "It lunges again."],
  cunning: ["It waits.", "It feints.", "It reads you."],
  chaotic: ["It thrashes wildly.", "It overextends.", "It wobbles."],
  brutal: ["Bone cracks.", "Blood sprays.", "It hits hard."],
  whimsical: ["It bonks you.", "It wobbles.", "Someone regrets that tile."],
  pack: ["It presses when you falter.", "The pack closes from two angles.", "It hunts the weak seam."],
} as const;

export const TONE_LINES: Record<ToneMode, readonly string[]> = {
  tactical: [
    "The supply line is open. Move now or lose leverage.",
    "Angles are clean for one turn. Use them.",
    "You have tempo. Spend it before they reset.",
  ],
  mythic: [
    "The sky answers in lightning.",
    "Old names wake when steel meets oath.",
    "The ground remembers who stood here.",
  ],
  whimsical: [
    "Someone is about to regret standing there.",
    "Luck trips over your boots and keeps running.",
    "That plan is ridiculous. It might work.",
  ],
  brutal: [
    "It hits hard. Something cracks.",
    "Claws rake, armor sings, blood answers.",
    "One clean blow can end this.",
  ],
  minimalist: [
    "Claws. Blood. Stone.",
    "Step. Strike. Breathe.",
    "No noise. Just impact.",
  ],
};

export const BANNED_PLAYER_PHRASES = [
  "command:unknown",
  "opening move",
  "board answers with hard state",
  "committed pressure lines",
  "commit one decisive move",
  "resolved non-player turn steps",
  "campaign_intro_opening",
];
