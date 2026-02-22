import type { RenderFrameState, RenderSnapshot, VisualEvent } from "@/ui/components/mythic/board2/render/types";

interface EngineEventInput {
  id: string;
  turn_index: number;
  event_type: string;
  actor_combatant_id?: string | null;
  created_at?: string;
  payload?: Record<string, unknown>;
}

interface BuildVisualEventQueueOptions {
  snapshot: RenderSnapshot;
  boardType: RenderSnapshot["board"]["type"];
}

interface NormalizedEvent {
  id: string;
  tick: number;
  eventType: string;
  actorId: string | null;
  targetId: string | null;
  amount: number | null;
  statusId: string | null;
  createdAt: string;
  from: { x: number; y: number } | null;
  to: { x: number; y: number } | null;
  roll: number | null;
  threshold: number | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNum(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toPoint(value: unknown): { x: number; y: number } | null {
  const row = asRecord(value);
  const x = asNum(row.x);
  const y = asNum(row.y);
  if (x === null || y === null) return null;
  return { x: Math.floor(x), y: Math.floor(y) };
}

function eventCursor(event: NormalizedEvent | null): string | null {
  if (!event) return null;
  return `${event.tick}:${event.id}:${event.createdAt}`;
}

function normalizeEvent(raw: EngineEventInput): NormalizedEvent {
  const payload = asRecord(raw.payload);
  const actorId = asString(payload.source_combatant_id)
    || asString(payload.actor_combatant_id)
    || asString(raw.actor_combatant_id)
    || null;
  const targetId = asString(payload.target_combatant_id) || null;
  const damage = asNum(payload.damage_to_hp);
  const genericAmount = asNum(payload.amount);
  const finalDamage = asNum(payload.final_damage);
  const amount = damage ?? genericAmount ?? finalDamage;
  const status = asRecord(payload.status);
  const statusId = asString(status.id) || asString(payload.status_id) || null;

  return {
    id: raw.id,
    tick: Number.isFinite(Number(raw.turn_index)) ? Math.floor(Number(raw.turn_index)) : 0,
    eventType: asString(raw.event_type).toLowerCase(),
    actorId,
    targetId,
    amount: amount === null ? null : Math.round(amount),
    statusId,
    createdAt: asString(raw.created_at) || new Date().toISOString(),
    from: toPoint(payload.from),
    to: toPoint(payload.to),
    roll: asNum(payload.roll_d20),
    threshold: asNum(payload.required_roll),
  };
}

function dedupeEvents(events: NormalizedEvent[]): NormalizedEvent[] {
  const seen = new Set<string>();
  const out: NormalizedEvent[] = [];
  for (const event of events) {
    const signature = [
      event.tick,
      event.eventType,
      event.actorId ?? "na",
      event.targetId ?? "na",
      event.amount ?? "na",
      event.statusId ?? "na",
      event.from ? `${event.from.x},${event.from.y}` : "na",
      event.to ? `${event.to.x},${event.to.y}` : "na",
    ].join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(event);
  }
  return out;
}

function entityTile(snapshot: RenderSnapshot, entityId: string | null): { x: number; y: number } | null {
  if (!entityId) return null;
  const row = snapshot.entities.find((entity) => entity.id === entityId);
  if (!row) return null;
  return { x: row.x, y: row.y };
}

function movementEventToVisual(event: NormalizedEvent, sequence: number): VisualEvent | null {
  if (!event.actorId || !event.from || !event.to) return null;
  return {
    id: `move:${event.id}`,
    type: "MoveTrail",
    tick: event.tick,
    createdAt: event.createdAt,
    sequence,
    seedKey: event.id,
    entityId: event.actorId,
    from: event.from,
    to: event.to,
    durationMs: 820,
  };
}

function statusEventsToVisual(events: NormalizedEvent[], snapshot: RenderSnapshot, sequenceStart: number): VisualEvent[] {
  const grouped = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    const key = `${event.tick}|${event.targetId ?? "na"}`;
    const list = grouped.get(key) ?? [];
    list.push(event);
    grouped.set(key, list);
  }

  const out: VisualEvent[] = [];
  let sequence = sequenceStart;
  for (const rows of grouped.values()) {
    if (rows.length === 0) continue;
    const first = rows[0] as NormalizedEvent;
    const tile = first.to
      ?? entityTile(snapshot, first.targetId)
      ?? entityTile(snapshot, first.actorId)
      ?? { x: 0, y: 0 };

    if (rows.length === 1) {
      out.push({
        id: `status:${first.id}`,
        type: "StatusApply",
        tick: first.tick,
        createdAt: first.createdAt,
        sequence,
        seedKey: first.id,
        targetId: first.targetId ?? first.actorId ?? "unknown",
        tile,
        statusId: first.statusId ?? "status",
      });
      sequence += 1;
      continue;
    }

    out.push({
      id: `status-multi:${rows.map((entry) => entry.id).join(",")}`,
      type: "StatusApplyMulti",
      tick: first.tick,
      createdAt: first.createdAt,
      sequence,
      seedKey: rows.map((entry) => entry.id).join("|"),
      targetId: first.targetId ?? first.actorId ?? "unknown",
      tile,
      statusIds: rows.map((entry) => entry.statusId ?? "status"),
    });
    sequence += 1;
  }

  return out;
}

function damageEventsToVisual(events: NormalizedEvent[], snapshot: RenderSnapshot, sequenceStart: number): VisualEvent[] {
  const grouped = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    const key = `${event.tick}|${event.actorId ?? "na"}|${event.targetId ?? "na"}`;
    const list = grouped.get(key) ?? [];
    list.push(event);
    grouped.set(key, list);
  }

  const out: VisualEvent[] = [];
  let sequence = sequenceStart;
  for (const rows of grouped.values()) {
    const first = rows[0] as NormalizedEvent;
    const tile = first.to
      ?? entityTile(snapshot, first.targetId)
      ?? entityTile(snapshot, first.actorId)
      ?? { x: 0, y: 0 };
    const total = rows.reduce((acc, row) => acc + Math.max(0, row.amount ?? 0), 0);
    const hitCount = rows.length;
    const crit = rows.some((row) => (row.amount ?? 0) >= 50);

    if (first.actorId) {
      out.push({
        id: `windup:${first.id}`,
        type: "AttackWindup",
        tick: first.tick,
        createdAt: first.createdAt,
        sequence,
        seedKey: first.id,
        attackerId: first.actorId,
        targetTile: tile,
        style: "melee",
      });
      sequence += 1;
    }

    if (first.actorId && first.targetId) {
      out.push({
        id: `impact:${rows.map((row) => row.id).join(",")}`,
        type: "HitImpact",
        tick: first.tick,
        createdAt: first.createdAt,
        sequence,
        seedKey: rows.map((row) => row.id).join("|"),
        attackerId: first.actorId,
        targetId: first.targetId,
        tile,
        damage: total,
        isCrit: crit,
      });
      sequence += 1;
    }

    if (first.targetId) {
      out.push({
        id: `damage-number:${rows.map((row) => row.id).join(",")}`,
        type: "DamageNumber",
        tick: first.tick,
        createdAt: first.createdAt,
        sequence,
        seedKey: rows.map((row) => row.id).join("|"),
        targetId: first.targetId,
        tile,
        amount: total,
        isCrit: crit,
        hitCount,
      });
      sequence += 1;
    }
  }

  return out;
}

function missEventsToVisual(events: NormalizedEvent[], snapshot: RenderSnapshot, sequenceStart: number): VisualEvent[] {
  let sequence = sequenceStart;
  const out: VisualEvent[] = [];

  for (const event of events) {
    if (!event.actorId || !event.targetId) continue;
    const tile = event.to ?? entityTile(snapshot, event.targetId) ?? entityTile(snapshot, event.actorId) ?? { x: 0, y: 0 };
    out.push({
      id: `miss:${event.id}`,
      type: "MissIndicator",
      tick: event.tick,
      createdAt: event.createdAt,
      sequence,
      seedKey: event.id,
      attackerId: event.actorId,
      targetId: event.targetId,
      tile,
      roll: event.roll ?? undefined,
      threshold: event.threshold ?? undefined,
    });
    sequence += 1;
  }

  return out;
}

function healEventsToVisual(events: NormalizedEvent[], snapshot: RenderSnapshot, sequenceStart: number): VisualEvent[] {
  let sequence = sequenceStart;
  const out: VisualEvent[] = [];
  for (const event of events) {
    if (!event.targetId || !event.actorId) continue;
    const tile = entityTile(snapshot, event.targetId) ?? entityTile(snapshot, event.actorId) ?? { x: 0, y: 0 };
    const amount = Math.max(0, event.amount ?? 0);
    out.push({
      id: `heal-impact:${event.id}`,
      type: "HealImpact",
      tick: event.tick,
      createdAt: event.createdAt,
      sequence,
      seedKey: event.id,
      sourceId: event.actorId,
      targetId: event.targetId,
      tile,
      amount,
    });
    sequence += 1;
    out.push({
      id: `heal-number:${event.id}`,
      type: "HealNumber",
      tick: event.tick,
      createdAt: event.createdAt,
      sequence,
      seedKey: event.id,
      targetId: event.targetId,
      tile,
      amount,
    });
    sequence += 1;
  }
  return out;
}

function tickEventsToVisual(events: NormalizedEvent[], snapshot: RenderSnapshot, sequenceStart: number): VisualEvent[] {
  let sequence = sequenceStart;
  const out: VisualEvent[] = [];
  for (const event of events) {
    if (!event.targetId) continue;
    const tile = entityTile(snapshot, event.targetId) ?? { x: 0, y: 0 };
    out.push({
      id: `tick:${event.id}`,
      type: "StatusTick",
      tick: event.tick,
      createdAt: event.createdAt,
      sequence,
      seedKey: event.id,
      targetId: event.targetId,
      tile,
      statusId: event.statusId ?? "status",
      amount: event.amount ?? undefined,
    });
    sequence += 1;
  }
  return out;
}

function barrierEventsToVisual(events: NormalizedEvent[], snapshot: RenderSnapshot, sequenceStart: number): VisualEvent[] {
  let sequence = sequenceStart;
  const out: VisualEvent[] = [];
  for (const event of events) {
    if (!event.targetId) continue;
    const tile = entityTile(snapshot, event.targetId) ?? { x: 0, y: 0 };
    out.push({
      id: `${event.eventType}:${event.id}`,
      type: event.eventType === "armor_shred" ? "BarrierBreak" : "BarrierGain",
      tick: event.tick,
      createdAt: event.createdAt,
      sequence,
      seedKey: event.id,
      targetId: event.targetId,
      tile,
      amount: event.amount ?? undefined,
    });
    sequence += 1;
  }
  return out;
}

function deathEventsToVisual(events: NormalizedEvent[], snapshot: RenderSnapshot, sequenceStart: number): VisualEvent[] {
  let sequence = sequenceStart;
  const out: VisualEvent[] = [];
  for (const event of events) {
    if (!event.targetId) continue;
    const tile = event.to ?? entityTile(snapshot, event.targetId) ?? { x: 0, y: 0 };
    out.push({
      id: `death:${event.id}`,
      type: "DeathBurst",
      tick: event.tick,
      createdAt: event.createdAt,
      sequence,
      seedKey: event.id,
      targetId: event.targetId,
      tile,
    });
    sequence += 1;
  }
  return out;
}

export function buildVisualEventQueue(
  engineEvents: Array<EngineEventInput | Record<string, unknown>>,
  prevFrameState: RenderFrameState | null,
  options: BuildVisualEventQueueOptions,
): { queue: VisualEvent[]; cursor: string | null; frameState: RenderFrameState } {
  const normalized = dedupeEvents(
    engineEvents
      .map((raw) => normalizeEvent(raw as EngineEventInput))
      .sort((a, b) => {
        if (a.tick !== b.tick) return a.tick - b.tick;
        if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
        return a.id.localeCompare(b.id);
      }),
  );

  const latest = normalized.length > 0 ? normalized[normalized.length - 1] as NormalizedEvent : null;
  const cursor = eventCursor(latest);
  const queue: VisualEvent[] = [];
  let sequence = 1;

  if (prevFrameState && prevFrameState.boardType !== options.boardType) {
    queue.push({
      id: `transition:${prevFrameState.boardType}:${options.boardType}:${latest?.id ?? "na"}`,
      type: "BoardTransition",
      tick: latest?.tick ?? 0,
      createdAt: latest?.createdAt ?? new Date().toISOString(),
      sequence,
      seedKey: `${prevFrameState.boardType}:${options.boardType}`,
      fromBoardType: prevFrameState.boardType,
      toBoardType: options.boardType,
    });
    sequence += 1;
  }

  const damage = normalized.filter((event) => event.eventType === "damage");
  const misses = normalized.filter((event) => event.eventType === "miss");
  const statusApplied = normalized.filter((event) => event.eventType === "status_applied");
  const statusTicks = normalized.filter((event) => event.eventType === "status_tick");
  const heals = normalized.filter((event) => event.eventType === "healed" || event.eventType === "power_gain");
  const barriers = normalized.filter((event) => event.eventType === "barrier_gain" || event.eventType === "armor_shred");
  const deaths = normalized.filter((event) => event.eventType === "death");
  const moves = normalized.filter((event) => event.eventType === "moved");

  for (const event of moves) {
    const visual = movementEventToVisual(event, sequence);
    if (visual) {
      queue.push(visual);
      sequence += 1;
    }
  }

  queue.push(...damageEventsToVisual(damage, options.snapshot, sequence));
  sequence = queue.length + 1;
  queue.push(...missEventsToVisual(misses, options.snapshot, sequence));
  sequence = queue.length + 1;
  queue.push(...healEventsToVisual(heals, options.snapshot, sequence));
  sequence = queue.length + 1;
  queue.push(...statusEventsToVisual(statusApplied, options.snapshot, sequence));
  sequence = queue.length + 1;
  queue.push(...tickEventsToVisual(statusTicks, options.snapshot, sequence));
  sequence = queue.length + 1;
  queue.push(...barrierEventsToVisual(barriers, options.snapshot, sequence));
  sequence = queue.length + 1;
  queue.push(...deathEventsToVisual(deaths, options.snapshot, sequence));

  const turnTransitions = normalized.filter((event) => event.eventType === "turn_start" || event.eventType === "turn_end");
  for (const event of turnTransitions) {
    queue.push({
      id: `${event.eventType}:${event.id}`,
      type: event.eventType === "turn_start" ? "TurnStart" : "TurnEnd",
      tick: event.tick,
      createdAt: event.createdAt,
      sequence: queue.length + 1,
      seedKey: event.id,
      actorId: event.actorId ?? undefined,
    });
  }

  const frameState: RenderFrameState = {
    boardType: options.boardType,
    turnIndex: latest?.tick ?? prevFrameState?.turnIndex ?? 0,
    cursor,
  };

  return {
    queue: queue.slice(-80),
    cursor,
    frameState,
  };
}
