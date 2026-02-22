import { pickDeterministic, stableFloat } from "./deterministic.js";
import {
  SPELL_ABSURD,
  SPELL_CLASSIC,
  SPELL_ENHANCED,
  SPELL_HEROIC,
  SPELL_MYTHIC,
  SPELL_WHIMSY,
} from "./wordBanks.js";
import type { SpellRarity } from "./types.js";

const RARITY_SCORE: Record<SpellRarity, number> = {
  common: 0,
  magical: 1,
  unique: 2,
  legendary: 3,
  mythic: 4,
  unhinged: 5,
};

function cleanBase(base: string): string {
  const trimmed = base.trim().replace(/\s+/g, " ");
  if (trimmed.length > 0) return trimmed;
  return pickDeterministic(SPELL_CLASSIC, "spell:base:fallback");
}

function tierScore(rank: number, rarity: SpellRarity, escalationLevel: number): number {
  const safeRank = Math.max(1, Math.floor(rank));
  const safeEscalation = Math.max(0, Math.floor(escalationLevel));
  return (safeRank * 2) + (RARITY_SCORE[rarity] ?? 0) + safeEscalation;
}

export function buildSpellName(
  spellBase: string,
  rank: number,
  rarity: SpellRarity,
  escalationLevel: number,
  seedKey = "spell-name",
): string {
  const base = cleanBase(spellBase);
  const score = tierScore(rank, rarity, escalationLevel);

  const whimsicalInject = score >= 9 && stableFloat(seedKey, "whimsy") < 0.14;
  const whimsical = whimsicalInject
    ? pickDeterministic(SPELL_WHIMSY, seedKey, "whimsy-word")
    : null;

  if (score <= 3) {
    const classicLead = score <= 1
      ? ""
      : pickDeterministic(["Greater", "Grand"], seedKey, "classic-lead");
    return `${classicLead ? `${classicLead} ` : ""}${base}`.trim();
  }

  if (score <= 7) {
    const lead = pickDeterministic(SPELL_ENHANCED, seedKey, "enhanced");
    return `${lead} ${whimsical ? `${whimsical} ` : ""}${base}`.trim();
  }

  if (score <= 11) {
    const lead = pickDeterministic(SPELL_HEROIC, seedKey, "heroic");
    const tail = stableFloat(seedKey, "heroic-tail") < 0.45
      ? pickDeterministic(["Lance", "Strike", "Nova", "Burst", "Judgment"], seedKey, "heroic-tail-word")
      : "";
    return `${lead} ${whimsical ? `${whimsical} ` : ""}${base}${tail ? ` ${tail}` : ""}`.trim();
  }

  if (score <= 15) {
    const lead = pickDeterministic(SPELL_MYTHIC, seedKey, "mythic");
    const bridge = stableFloat(seedKey, "mythic-bridge") < 0.5
      ? pickDeterministic(["Stormbreaker", "Cataclysm", "Cascade", "Heavenfall", "Supernova"], seedKey, "mythic-bridge-word")
      : "";
    return `${lead} ${whimsical ? `${whimsical} ` : ""}${base}${bridge ? ` ${bridge}` : ""}`.trim();
  }

  const absurdA = pickDeterministic(SPELL_ABSURD, seedKey, "absurd-a");
  const absurdB = pickDeterministic(SPELL_ABSURD, seedKey, "absurd-b");
  const mythicLead = pickDeterministic([...SPELL_MYTHIC, ...SPELL_HEROIC], seedKey, "absurd-core");
  const suffix = stableFloat(seedKey, "absurd-suffix") < 0.45
    ? pickDeterministic(["EX", "Deluxe", "Maximum", "Final", "Ultimate"], seedKey, "absurd-suffix-word")
    : "";

  const parts = [absurdA, whimsical, mythicLead, absurdB, base, suffix].filter((entry): entry is string => Boolean(entry));
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
