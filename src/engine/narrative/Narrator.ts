import type { GameEvent } from "@/engine/types";
import type { WorldEvent } from "./types";
import { getQuestNarration } from "./QuestEvents";

export type NarrationSource = "game" | "world";

export interface NarrationEntry {
  readonly id: string;
  readonly text: string;
  readonly timestamp: number;
  readonly source: NarrationSource;
}

const MOCK_NARRATIVE_PATTERN = /\b(test|demo|sample|placeholder)\b/i;
const MOCK_NARRATIVE_PHRASES = [
  "Test your new",
  "Swap places with the Clone",
  "Gelatinous Clone",
];

function isMockNarrative(text: string): boolean {
  if (MOCK_NARRATIVE_PATTERN.test(text)) return true;
  return MOCK_NARRATIVE_PHRASES.some((phrase) => text.includes(phrase));
}

export function createNarrationEntry(event: GameEvent | WorldEvent): NarrationEntry | null {
  const timestamp = "timestamp" in event ? event.timestamp : Date.now();
  const questNarration = "type" in event ? getQuestNarration(event as WorldEvent) : null;
  const text = questNarration ?? event.description?.trim();

  if (!text || isMockNarrative(text)) {
    return null;
  }

  return {
    id: `${event.type}-${timestamp}`,
    text,
    timestamp,
    source: "timestamp" in event ? "world" : "game",
  };
}
