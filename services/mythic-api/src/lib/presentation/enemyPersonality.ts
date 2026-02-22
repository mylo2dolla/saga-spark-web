import { pickDeterministic } from "./deterministic.js";
import { ENEMY_VOICE } from "./wordBanks.js";
import type { EnemyPersonalityTraits, ToneMode } from "./types.js";

function normalizeTraits(input: Partial<EnemyPersonalityTraits> | null | undefined): EnemyPersonalityTraits {
  const aggression = Math.max(0, Math.min(100, Math.floor(Number(input?.aggression ?? 50))));
  const discipline = Math.max(0, Math.min(100, Math.floor(Number(input?.discipline ?? 50))));
  const intelligence = Math.max(0, Math.min(100, Math.floor(Number(input?.intelligence ?? 50))));
  const instinct = typeof input?.instinct_type === "string" ? input.instinct_type : "predator";
  return {
    aggression,
    discipline,
    intelligence,
    instinct_type:
      instinct === "pack" || instinct === "duelist" || instinct === "ambush" || instinct === "guardian" || instinct === "chaotic"
        ? instinct
        : "predator",
  };
}

function modeFromTraits(traits: EnemyPersonalityTraits, tone: ToneMode): keyof typeof ENEMY_VOICE {
  if (traits.instinct_type === "pack") return "pack";
  if (traits.instinct_type === "chaotic") return "chaotic";
  if (tone === "whimsical") return "whimsical";
  if (traits.aggression >= 70 && traits.intelligence < 45) return "aggressive";
  if (traits.intelligence >= 65 || traits.discipline >= 68) return "cunning";
  if (traits.aggression >= 65) return "brutal";
  return "aggressive";
}

export function personalityLine(args: {
  seedKey: string;
  traits: Partial<EnemyPersonalityTraits> | null | undefined;
  tone: ToneMode;
}): string {
  const traits = normalizeTraits(args.traits);
  const mode = modeFromTraits(traits, args.tone);
  const pool = ENEMY_VOICE[mode] ?? ENEMY_VOICE.aggressive;
  return pickDeterministic(pool, args.seedKey, `enemy-personality:${mode}`);
}

export function defaultEnemyTraits(seedKey: string): EnemyPersonalityTraits {
  const aggression = Number((pickDeterministic([38, 46, 55, 64, 72, 81], seedKey, "enemy:aggression")));
  const discipline = Number((pickDeterministic([34, 42, 51, 63, 74], seedKey, "enemy:discipline")));
  const intelligence = Number((pickDeterministic([30, 40, 49, 58, 67, 76], seedKey, "enemy:intelligence")));
  const instinct = pickDeterministic(["pack", "duelist", "predator", "ambush", "guardian", "chaotic"] as const, seedKey, "enemy:instinct");
  return {
    aggression,
    discipline,
    intelligence,
    instinct_type: instinct,
  };
}
