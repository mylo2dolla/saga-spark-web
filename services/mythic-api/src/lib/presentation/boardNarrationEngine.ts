import { pickDeterministicWithoutImmediateRepeat } from "./deterministic.js";
import { BOARD_OPENERS, TOWN_SYLLABLE_A, TOWN_SYLLABLE_B } from "./wordBanks.js";
import type { BoardNarrationInput, BoardNarrationResult } from "./types.js";

function compactText(text: string, max = 120): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).replace(/\s+\S*$/, "").trim()}...`;
}

function townTag(seedKey: string): string {
  const a = pickDeterministicWithoutImmediateRepeat(TOWN_SYLLABLE_A, seedKey, null, "town-tag-a");
  const b = pickDeterministicWithoutImmediateRepeat(TOWN_SYLLABLE_B, seedKey, null, "town-tag-b");
  return `${a}${b}`;
}

export function buildBoardNarration(input: BoardNarrationInput): BoardNarrationResult {
  const opener = pickDeterministicWithoutImmediateRepeat(
    BOARD_OPENERS,
    input.seedKey,
    input.lastOpenerId ?? null,
    `${input.boardType}:opener`,
  );
  const openerId = opener;

  const hooks = input.hooks
    .map((entry) => compactText(entry, 72))
    .filter((entry) => entry.length > 0)
    .slice(0, 2);

  const parts: string[] = [opener];

  if (input.boardType === "town") {
    const district = input.regionName && input.regionName.trim().length > 0
      ? compactText(input.regionName, 40)
      : townTag(input.seedKey);
    const faction = input.factionTension ? compactText(input.factionTension, 64) : null;
    const hook = hooks[0] ?? null;
    const second = [
      hook ? `Lead: ${hook}.` : null,
      faction ? `Faction pressure: ${faction}.` : null,
      input.timePressure ? `Clock: ${compactText(input.timePressure, 52)}.` : null,
      `District: ${district}.`,
    ].filter((entry): entry is string => Boolean(entry))[0] ?? `District: ${district}.`;
    parts.push(second);
  } else if (input.boardType === "travel") {
    const second = hooks[0]
      ? `Route lead: ${hooks[0]}.`
      : input.timePressure
        ? `Clock: ${compactText(input.timePressure, 52)}.`
        : "The route window is open, briefly.";
    parts.push(second);
  } else if (input.boardType === "dungeon") {
    const second = hooks[0]
      ? `Stone hook: ${hooks[0]}.`
      : input.resourceWindow
        ? `Resources: ${compactText(input.resourceWindow, 52)}.`
        : "Every room keeps score.";
    parts.push(second);
  }

  const text = parts
    .filter((entry) => entry.trim().length > 0)
    .slice(0, 2)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    openerId,
    text,
  };
}
