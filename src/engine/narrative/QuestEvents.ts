import type { WorldEvent } from "./types";

const QUEST_EVENT_TYPES = new Set<WorldEvent["type"]>([
  "quest_started",
  "quest_updated",
  "quest_completed",
  "quest_failed",
  "quest_progress",
]);

export function getQuestNarration(event: WorldEvent): string | null {
  if (!QUEST_EVENT_TYPES.has(event.type)) {
    return null;
  }

  return event.description?.trim() || null;
}
