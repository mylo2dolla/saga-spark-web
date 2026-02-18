import type { MythicActionEventRow, MythicCombatantRow } from "@/hooks/useMythicCombatState";

export type CombatFxType = "projectile" | "burst" | "heal" | "status" | "move" | "death";

export type CombatFx = {
  id: string;
  type: CombatFxType;
  startedAtMs: number;
  durationMs: number;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  amount?: number;
};

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function posFromPayload(payload: Record<string, unknown> | null, key: string): { x: number; y: number } | null {
  if (!payload) return null;
  const raw = payload[key];
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const x = num(o.x, NaN);
  const y = num(o.y, NaN);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

export function fxFromEvent(
  e: MythicActionEventRow,
  combatantsById: Map<string, MythicCombatantRow>,
  nowMs: number,
): CombatFx[] {
  const payload = (e.payload ?? {}) as Record<string, unknown>;
  const fx: CombatFx[] = [];

  if (e.event_type === "skill_used") {
    const from = posFromPayload(payload, "at");
    const target = payload.target && typeof payload.target === "object" ? (payload.target as Record<string, unknown>) : null;
    const to = target ? { x: num(target.x, NaN), y: num(target.y, NaN) } : null;
    if (from && to && Number.isFinite(to.x) && Number.isFinite(to.y)) {
      fx.push({
        id: `${e.id}:proj`,
        type: "projectile",
        startedAtMs: nowMs,
        durationMs: 380,
        from,
        to: { x: Math.floor(to.x), y: Math.floor(to.y) },
      });
    } else if (from) {
      fx.push({
        id: `${e.id}:burst`,
        type: "burst",
        startedAtMs: nowMs,
        durationMs: 260,
        to: from,
      });
    }
  }

  if (e.event_type === "damage") {
    const targetId = String(payload.target_combatant_id ?? "");
    const t = combatantsById.get(targetId);
    if (t) {
      fx.push({
        id: `${e.id}:dmg`,
        type: "burst",
        startedAtMs: nowMs,
        durationMs: 320,
        to: { x: t.x, y: t.y },
        amount: Math.max(0, Math.floor(num(payload.damage_to_hp, 0))),
      });
    }
  }

  if (e.event_type === "healed") {
    const targetId = String(payload.target_combatant_id ?? "");
    const t = combatantsById.get(targetId);
    if (t) {
      fx.push({
        id: `${e.id}:heal`,
        type: "heal",
        startedAtMs: nowMs,
        durationMs: 360,
        to: { x: t.x, y: t.y },
        amount: Math.max(0, Math.floor(num(payload.amount, 0))),
      });
    }
  }

  if (e.event_type === "status_applied") {
    const targetId = String(payload.target_combatant_id ?? "");
    const t = combatantsById.get(targetId);
    if (t) {
      fx.push({
        id: `${e.id}:status`,
        type: "status",
        startedAtMs: nowMs,
        durationMs: 420,
        to: { x: t.x, y: t.y },
      });
    }
  }

  if (e.event_type === "moved") {
    const from = posFromPayload(payload, "from");
    const to = posFromPayload(payload, "to");
    if (from && to) {
      fx.push({
        id: `${e.id}:move`,
        type: "move",
        startedAtMs: nowMs,
        durationMs: 240,
        from,
        to,
      });
    }
  }

  if (e.event_type === "death") {
    const targetId = String(payload.target_combatant_id ?? "");
    const t = combatantsById.get(targetId);
    if (t) {
      fx.push({
        id: `${e.id}:death`,
        type: "death",
        startedAtMs: nowMs,
        durationMs: 520,
        to: { x: t.x, y: t.y },
      });
    }
  }

  return fx;
}

