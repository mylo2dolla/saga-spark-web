import type { MythicActionEventRow } from "@/hooks/useMythicCombatState";

export type CombatFxKind =
  | "damage"
  | "healed"
  | "status"
  | "armor_shred"
  | "power"
  | "death"
  | "moved";

export type CombatFx = {
  id: string;
  kind: CombatFxKind;
  targetCombatantId: string;
  startedAt: number; // seconds (performance time base)
  duration: number; // seconds
  magnitude: number;
  text?: string;
};

function asPayload(event: MythicActionEventRow): Record<string, unknown> {
  return event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {};
}

function findTargetId(event: MythicActionEventRow): string | null {
  const payload = asPayload(event);
  const keys = ["target_combatant_id", "target_id", "defender_combatant_id", "receiver_combatant_id"];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return event.actor_combatant_id ?? null;
}

function numberField(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const n = Number(payload[key]);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return null;
}

export function deriveFxFromEvent(event: MythicActionEventRow, startedAt: number): CombatFx[] {
  const targetId = findTargetId(event);
  if (!targetId) return [];
  const payload = asPayload(event);
  const kind = event.event_type;

  if (kind === "damage") {
    const amount = numberField(payload, ["damage_to_hp", "amount", "value"]) ?? 0;
    return [{
      id: `${event.id}:damage`,
      kind: "damage",
      targetCombatantId: targetId,
      startedAt,
      duration: 0.95,
      magnitude: Math.abs(amount),
      text: amount ? `-${Math.floor(Math.abs(amount))}` : undefined,
    }];
  }

  if (kind === "healed" || kind === "revive") {
    const amount = numberField(payload, ["amount", "healing_to_hp", "value"]) ?? 0;
    return [{
      id: `${event.id}:healed`,
      kind: "healed",
      targetCombatantId: targetId,
      startedAt,
      duration: 0.95,
      magnitude: Math.abs(amount),
      text: amount ? `+${Math.floor(Math.abs(amount))}` : undefined,
    }];
  }

  if (kind === "status_applied" || kind === "cleanse" || kind === "status_roll") {
    return [{
      id: `${event.id}:status`,
      kind: "status",
      targetCombatantId: targetId,
      startedAt,
      duration: 0.85,
      magnitude: 1,
    }];
  }

  if (kind === "armor_shred") {
    const amount = numberField(payload, ["amount"]) ?? 0;
    return [{
      id: `${event.id}:armor`,
      kind: "armor_shred",
      targetCombatantId: targetId,
      startedAt,
      duration: 0.85,
      magnitude: Math.abs(amount),
    }];
  }

  if (kind === "power_gain" || kind === "power_drain") {
    const amount = numberField(payload, ["amount"]) ?? 0;
    return [{
      id: `${event.id}:power`,
      kind: "power",
      targetCombatantId: targetId,
      startedAt,
      duration: 0.85,
      magnitude: Math.abs(amount),
      text: amount ? `${kind === "power_gain" ? "+" : "-"}${Math.floor(Math.abs(amount))}` : undefined,
    }];
  }

  if (kind === "death") {
    return [{
      id: `${event.id}:death`,
      kind: "death",
      targetCombatantId: targetId,
      startedAt,
      duration: 1.2,
      magnitude: 1,
    }];
  }

  if (kind === "moved") {
    return [{
      id: `${event.id}:moved`,
      kind: "moved",
      targetCombatantId: targetId,
      startedAt,
      duration: 0.65,
      magnitude: 1,
    }];
  }

  return [];
}

