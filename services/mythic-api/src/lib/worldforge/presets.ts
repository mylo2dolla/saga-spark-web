import type { TonePreset, ToneVector } from "./schema.js";

export interface ForgePreset {
  id: TonePreset;
  label: string;
  toneBias: ToneVector;
  aesthetics: string[];
  creatureBias: string[];
  namingStyle: string[];
  dmBias: {
    cruelty: number;
    generosity: number;
    chaos: number;
    fairness: number;
    humor: number;
  };
}

const V = (value: Partial<ToneVector>): ToneVector => ({
  darkness: value.darkness ?? 0.4,
  whimsy: value.whimsy ?? 0.3,
  brutality: value.brutality ?? 0.35,
  absurdity: value.absurdity ?? 0.25,
  cosmic: value.cosmic ?? 0.3,
  heroic: value.heroic ?? 0.45,
  tragic: value.tragic ?? 0.35,
  cozy: value.cozy ?? 0.25,
});

export const FORGE_PRESETS: Record<TonePreset, ForgePreset> = {
  dark: {
    id: "dark",
    label: "Dark",
    toneBias: V({ darkness: 0.86, brutality: 0.68, tragic: 0.62, whimsy: 0.12, cozy: 0.08 }),
    aesthetics: ["ink", "iron rain", "grave lanterns", "ashen skyline"],
    creatureBias: ["undead", "vampires", "wraiths", "night hounds"],
    namingStyle: ["Somber compounds", "Oathbound epithets"],
    dmBias: { cruelty: 0.72, generosity: 0.28, chaos: 0.42, fairness: 0.66, humor: 0.16 },
  },
  comicbook: {
    id: "comicbook",
    label: "Dark Comicbook",
    toneBias: V({ darkness: 0.72, brutality: 0.52, whimsy: 0.22, absurdity: 0.34, heroic: 0.58, tragic: 0.48, cozy: 0.1 }),
    aesthetics: ["neon", "hard shadows", "ink splashes", "dramatic panels"],
    creatureBias: ["vampires", "vigilantes", "cursed mobs", "clockwork brutes"],
    namingStyle: ["Bold verbs", "Tagline nicknames"],
    dmBias: { cruelty: 0.62, generosity: 0.38, chaos: 0.48, fairness: 0.64, humor: 0.28 },
  },
  anime: {
    id: "anime",
    label: "Anime Heroic",
    toneBias: V({ heroic: 0.84, absurdity: 0.54, whimsy: 0.48, brutality: 0.38, darkness: 0.34, tragic: 0.42, cozy: 0.34 }),
    aesthetics: ["sky streaks", "spectacle bursts", "banner sigils", "kinetic frames"],
    creatureBias: ["dragons", "rivals", "spirit beasts", "masked elites"],
    namingStyle: ["Ultra/Hyper prefixes", "Final-form escalations"],
    dmBias: { cruelty: 0.44, generosity: 0.56, chaos: 0.55, fairness: 0.62, humor: 0.5 },
  },
  mythic: {
    id: "mythic",
    label: "Mythic",
    toneBias: V({ cosmic: 0.78, heroic: 0.66, tragic: 0.5, absurdity: 0.32, darkness: 0.44, whimsy: 0.26, cozy: 0.16 }),
    aesthetics: ["celestial fractures", "ancient thrones", "god-etched relics", "starless temples"],
    creatureBias: ["titans", "oracles", "angels", "world serpents"],
    namingStyle: ["Epic honorifics", "Old-world titles"],
    dmBias: { cruelty: 0.55, generosity: 0.45, chaos: 0.48, fairness: 0.68, humor: 0.22 },
  },
  cozy: {
    id: "cozy",
    label: "Cozy Fantasy",
    toneBias: V({ cozy: 0.88, whimsy: 0.64, heroic: 0.52, darkness: 0.1, brutality: 0.08, absurdity: 0.32, tragic: 0.14 }),
    aesthetics: ["warm fields", "tea steam", "sun meadows", "lantern festivals"],
    creatureBias: ["slimes", "forest spirits", "helpful golems", "friendly beasts"],
    namingStyle: ["Playful surnames", "Village nicknames"],
    dmBias: { cruelty: 0.24, generosity: 0.76, chaos: 0.3, fairness: 0.74, humor: 0.58 },
  },
  chaotic: {
    id: "chaotic",
    label: "Chaotic Absurd",
    toneBias: V({ absurdity: 0.9, whimsy: 0.82, cosmic: 0.56, brutality: 0.42, darkness: 0.36, heroic: 0.48, tragic: 0.26, cozy: 0.24 }),
    aesthetics: ["glitch confetti", "floating stairs", "laughing storms", "wrong-way gravity"],
    creatureBias: ["mimics", "sentient furniture", "cosmic clowns", "anomaly swarms"],
    namingStyle: ["Ridiculous escalations", "Over-extended titles"],
    dmBias: { cruelty: 0.5, generosity: 0.5, chaos: 0.88, fairness: 0.4, humor: 0.84 },
  },
  grim: {
    id: "grim",
    label: "Grim",
    toneBias: V({ darkness: 0.92, brutality: 0.82, tragic: 0.72, cozy: 0.04, whimsy: 0.08, heroic: 0.32, absurdity: 0.14, cosmic: 0.34 }),
    aesthetics: ["cold iron", "bone banners", "war fog", "scarred stone"],
    creatureBias: ["ghouls", "executioners", "siege fiends", "warped knights"],
    namingStyle: ["Hard monosyllables", "Funeral epithets"],
    dmBias: { cruelty: 0.82, generosity: 0.18, chaos: 0.54, fairness: 0.56, humor: 0.08 },
  },
  heroic: {
    id: "heroic",
    label: "Heroic",
    toneBias: V({ heroic: 0.88, cozy: 0.38, whimsy: 0.42, darkness: 0.26, brutality: 0.34, tragic: 0.28, absurdity: 0.3, cosmic: 0.4 }),
    aesthetics: ["bright standards", "wind-swept cliffs", "sunsteel", "fanfare storms"],
    creatureBias: ["dragons", "bandits", "fallen champions", "war machines"],
    namingStyle: ["Clear hero nouns", "Banner verbs"],
    dmBias: { cruelty: 0.38, generosity: 0.62, chaos: 0.36, fairness: 0.8, humor: 0.36 },
  },
};

export const DEFAULT_PRESET: TonePreset = "mythic";

export function templateToPreset(templateKey: string): TonePreset {
  if (templateKey === "gothic_horror" || templateKey === "dark_mythic_horror") return "dark";
  if (templateKey === "graphic_novel_fantasy") return "comicbook";
  if (templateKey === "mythic_chaos") return "chaotic";
  if (templateKey === "sci_fi_ruins" || templateKey === "post_apoc_warlands" || templateKey === "post_apocalypse") return "grim";
  return "mythic";
}
