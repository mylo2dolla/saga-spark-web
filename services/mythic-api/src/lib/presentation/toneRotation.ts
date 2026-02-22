import { pickDeterministic, weightedPickWithoutImmediateRepeat } from "./deterministic.js";
import { TONE_LINES } from "./wordBanks.js";
import type { ToneMode, ToneSelectionInput, ToneSelectionResult } from "./types.js";

function normalizeTheme(theme: string): string {
  return theme.trim().toLowerCase();
}

export function selectToneMode(input: ToneSelectionInput): ToneSelectionResult {
  const hpPct = Math.max(0, Math.min(1, Number.isFinite(input.playerHpPct) ? input.playerHpPct : 0.65));
  const tension = Math.max(0, Math.min(100, Math.floor(input.tension || 0)));
  const bossBoost = input.bossPresent ? 1 : 0;
  const theme = normalizeTheme(input.regionTheme);

  const weights: Record<ToneMode, number> = {
    tactical: 1.6,
    mythic: 1.3,
    whimsical: 0.8,
    brutal: 0.9,
    minimalist: 0.7,
  };

  if (tension >= 65) {
    weights.tactical += 0.7;
    weights.brutal += 0.8;
    weights.minimalist += 0.4;
  }
  if (bossBoost) {
    weights.mythic += 1.2;
    weights.brutal += 0.6;
  }
  if (hpPct <= 0.35) {
    weights.brutal += 1.0;
    weights.minimalist += 0.6;
    weights.whimsical -= 0.2;
  }
  if (theme.includes("town") || theme.includes("market") || theme.includes("festival")) {
    weights.whimsical += 0.8;
    weights.tactical += 0.2;
  }
  if (theme.includes("dungeon") || theme.includes("crypt") || theme.includes("grave")) {
    weights.brutal += 0.4;
    weights.mythic += 0.5;
  }

  const tone = weightedPickWithoutImmediateRepeat(
    weights,
    input.seedKey,
    input.lastTone,
    "tone-mode",
  );

  const reason = `${tone}:${tension}:${Math.round(hpPct * 100)}:${input.bossPresent ? 1 : 0}`;
  return { tone, reason };
}

export function toneSeedLine(tone: ToneMode, seedKey: string): string {
  const pool = TONE_LINES[tone] ?? TONE_LINES.tactical;
  if (pool.length === 0) return "";
  return pickDeterministic(pool, seedKey, `tone-line:${tone}`);
}
