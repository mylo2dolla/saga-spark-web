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

export function createNarrationEntry(event: GameEvent | WorldEvent): NarrationEntry | null {
  const timestamp = "timestamp" in event ? event.timestamp : Date.now();
  const questNarration = "type" in event ? getQuestNarration(event as WorldEvent) : null;
  const text = questNarration ?? event.description?.trim();

  if (!text) {
    return null;
  }

  return {
    id: `${event.type}-${timestamp}`,
    text,
    timestamp,
    source: "timestamp" in event ? "world" : "game",
  };
}
