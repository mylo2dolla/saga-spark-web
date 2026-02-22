import type { ProceduralEventType, ProceduralNarrationEvent } from "./types.js";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return Math.floor(parsed);
  }
  return fallback;
}

function toEventType(raw: string, boardType: string): ProceduralEventType {
  const key = raw.trim().toLowerCase();
  if (key === "damage" || key === "miss" || key === "healed" || key === "death" || key === "combat_end") {
    return "COMBAT_ATTACK_RESOLVED";
  }
  if (key === "status_tick" || key === "status_applied" || key === "status_expired") {
    return "STATUS_TICK";
  }
  if (key === "loot_drop") return "LOOT_DROPPED";
  if (key === "xp_gain") return "LEVEL_UP";
  if (key === "moved") return boardType === "travel" ? "TRAVEL_STEP" : "BOARD_TRANSITION";
  if (key === "dialogue" || key === "npc_dialogue") return "NPC_DIALOGUE";
  if (key === "room_entered" || key === "room_transition") return "DUNGEON_ROOM_ENTERED";
  if (key === "travel_step") return "TRAVEL_STEP";
  if (key === "quest_update" || key === "objective") return "QUEST_UPDATE";
  if (key === "board_transition" || key === "runtime_transition") return "BOARD_TRANSITION";
  if (boardType === "dungeon") return "DUNGEON_ROOM_ENTERED";
  if (boardType === "travel") return "TRAVEL_STEP";
  if (boardType === "combat") return "COMBAT_ATTACK_RESOLVED";
  return "QUEST_UPDATE";
}

function eventFromStateChange(args: {
  seed: string;
  stateChange: string;
  index: number;
  boardType: string;
}): ProceduralNarrationEvent {
  return {
    type: toEventType("quest_update", args.boardType),
    ts: Date.now() + args.index,
    seed: args.seed,
    id: `state_change_${args.index}`,
    context: {
      summary: args.stateChange,
      source: "state_change",
    },
  };
}

export function mapProceduralEvents(args: {
  seed: string;
  boardType: string;
  events: Array<Record<string, unknown>>;
  stateChanges: string[];
  fallbackEventId: string;
}): ProceduralNarrationEvent[] {
  const mapped: ProceduralNarrationEvent[] = [];
  const normalizedBoardType = args.boardType.trim().toLowerCase();

  for (let index = 0; index < args.events.length; index += 1) {
    const raw = asObject(args.events[index]);
    if (!raw) continue;
    const payload = asObject(raw.payload) ?? {};
    const rawEventType = typeof raw.event_type === "string"
      ? raw.event_type
      : typeof payload.event_type === "string"
        ? payload.event_type
        : "quest_update";
    const eventType = toEventType(rawEventType, normalizedBoardType);
    const eventId = typeof raw.id === "string" && raw.id.trim().length > 0
      ? raw.id.trim()
      : `${eventType.toLowerCase()}_${index}`;
    const ts = toTimestamp(
      raw.created_at ?? raw.ts ?? payload.ts,
      Math.floor(Date.now() + index),
    );
    const actor = typeof payload.source_name === "string"
      ? payload.source_name
      : typeof payload.actor_name === "string"
        ? payload.actor_name
        : "You";
    const target = typeof payload.target_name === "string" ? payload.target_name : "the line";
    const amount = Number(payload.damage_to_hp ?? payload.amount ?? payload.final_damage ?? Number.NaN);
    const status = asObject(payload.status);
    mapped.push({
      type: eventType,
      ts,
      seed: args.seed,
      id: eventId,
      context: {
        actor,
        target,
        amount: Number.isFinite(amount) ? amount : null,
        status: typeof status?.id === "string" ? status.id : (typeof payload.status_id === "string" ? payload.status_id : null),
        raw_event_type: rawEventType,
        payload,
      },
    });
  }

  if (mapped.length === 0 && args.stateChanges.length > 0) {
    for (let index = 0; index < args.stateChanges.length; index += 1) {
      const stateChange = args.stateChanges[index]?.trim();
      if (!stateChange) continue;
      mapped.push(eventFromStateChange({
        seed: args.seed,
        stateChange,
        index,
        boardType: normalizedBoardType,
      }));
      if (mapped.length >= 6) break;
    }
  }

  if (mapped.length === 0) {
    mapped.push({
      type: toEventType("quest_update", normalizedBoardType),
      ts: Date.now(),
      seed: args.seed,
      id: args.fallbackEventId.trim().length > 0 ? args.fallbackEventId : "event_fallback",
      context: {
        actor: "You",
        target: normalizedBoardType === "combat" ? "hostiles" : "the board",
        amount: null,
        status: null,
      },
    });
  }

  return mapped;
}

