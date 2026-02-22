import { pickDeterministic } from "./deterministic.js";
import type { SpellStyleTags } from "./types.js";

function clean(value: string, fallback: string): string {
  const text = value.trim();
  return text.length > 0 ? text : fallback;
}

export function buildSpectacleLine(args: {
  seedKey: string;
  spellName: string;
  escalationLevel: number;
  styleTags: Partial<SpellStyleTags> | null | undefined;
  targetName: string;
}): string {
  const level = Math.max(0, Math.floor(args.escalationLevel));
  const style = {
    element: clean(args.styleTags?.element ?? "arcane", "arcane"),
    mood: clean(args.styleTags?.mood ?? "volatile", "volatile"),
    visual: clean(args.styleTags?.visual_signature ?? "shockwave", "shockwave"),
    impact: clean(args.styleTags?.impact_verb ?? "strike", "strike"),
  };
  const target = clean(args.targetName, "the target");

  if (level <= 1) {
    return `${args.spellName} ${style.impact}s ${target}. ${style.element} light snaps over the tile.`;
  }
  if (level <= 3) {
    return `${args.spellName} detonates in ${style.visual}. ${target} reels under ${style.element} force.`;
  }
  if (level <= 5) {
    return `${args.spellName} tears the lane open. ${style.element} thunder drops ${target} into chaos.`;
  }
  const finisher = pickDeterministic([
    "Heaven signs your name in lightning.",
    "The sky answers with a verdict.",
    "Reality buckles and the strike lands anyway.",
    "The field blinks white and then the damage speaks.",
  ], args.seedKey, "spectacle:finisher");
  return `${args.spellName} erupts in ${style.visual}. ${target} takes the full ${style.mood} ${style.element} ${style.impact}. ${finisher}`;
}
