import { pickDeterministic } from "./deterministic.js";
import { TITLE_STANDARD_CLASSES, TITLE_WHIMSICAL_CLASSES } from "./wordBanks.js";
import type { ReputationInput, ReputationResult } from "./types.js";

function cleanFlags(flags: string[]): string[] {
  return flags
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function deriveTier(score: number): 1 | 2 | 3 | 4 | 5 {
  if (score >= 320) return 5;
  if (score >= 210) return 4;
  if (score >= 120) return 3;
  if (score >= 55) return 2;
  return 1;
}

function behaviorOverride(input: ReputationInput): string | null {
  const flags = cleanFlags(input.behaviorFlags);
  const kills = cleanFlags(input.notableKills);

  if (flags.some((entry) => entry.includes("sparkle_50") || entry.includes("sparkle_only"))) return "Glitterstorm";
  if (flags.some((entry) => entry.includes("low_hp_win") || entry.includes("one_hp_clutch"))) return "Barely Alive Legend";
  if (flags.some((entry) => entry.includes("fire_only") || entry.includes("wildfire_chain"))) return "The Walking Wildfire";
  if (kills.some((entry) => entry.includes("slime_100") || entry.includes("slime_hunter"))) return "Slimebreaker";

  const strongestFaction = Object.entries(input.factionStanding)
    .map(([key, value]) => ({ key, score: Number(value) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score)[0];

  if (strongestFaction && strongestFaction.score >= 140) {
    const factionName = strongestFaction.key.replace(/[_-]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
    return `Banner of ${factionName}`;
  }

  return null;
}

export function buildReputationTitle(input: ReputationInput): ReputationResult {
  const baseName = input.baseName.trim();
  const safeBase = baseName.length > 0 ? baseName : "Wanderer";
  const tier = deriveTier(Number.isFinite(input.reputationScore) ? input.reputationScore : 0);
  const override = behaviorOverride(input);

  if (override) {
    const displayName = tier >= 3 ? override : `${safeBase} ${override}`;
    return {
      tier,
      displayName,
      title: override,
    };
  }

  if (tier === 1) {
    return { tier, displayName: safeBase, title: null };
  }

  if (tier === 2) {
    return {
      tier,
      displayName: `${safeBase} the Sparkling`,
      title: "the Sparkling",
    };
  }

  if (tier === 3) {
    const title = pickDeterministic([
      "Stormcaller",
      "Glorybound",
      "Dawnbreaker",
      "Nightlancer",
      ...TITLE_STANDARD_CLASSES,
      ...TITLE_WHIMSICAL_CLASSES,
    ], input.seedKey, "rep:tier3");
    return { tier, displayName: title, title };
  }

  if (tier === 4) {
    const title = pickDeterministic([
      "The Storm of Honeybrook",
      "The Oath of Lantern's Rest",
      "The Blade of Rainbow Crossing",
      "The Warden of Moonberry Hollow",
      "Patron of Infinite Snacks",
    ], input.seedKey, "rep:tier4");
    return { tier, displayName: title, title };
  }

  const title = pickDeterministic([
    "The Thunder That Split the Vale",
    "The Skyfire Behind the Gate",
    "The Eternal Bell of Dawnfield",
    "The Final Spark of Cloverrest",
  ], input.seedKey, "rep:tier5");
  return { tier, displayName: title, title };
}
