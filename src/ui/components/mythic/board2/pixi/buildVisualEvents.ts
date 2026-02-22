import type {
  CombatSceneData,
  NarrativeBoardSceneModel,
  RenderEffectsQueueState,
  VisualEvent,
} from "@/ui/components/mythic/board2/types";

function parseMs(value: string): number {
  const parsed = Number(new Date(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildCursor(event: { turnIndex: number; id: string; createdAt: string } | null): string | null {
  if (!event) return null;
  return `${event.turnIndex}:${event.id}:${event.createdAt || "na"}`;
}

export function buildVisualEvents(scene: NarrativeBoardSceneModel): RenderEffectsQueueState {
  if (scene.mode !== "combat") {
    return {
      queue: [],
      latestCursor: null,
    };
  }

  const details = scene.details as CombatSceneData;
  const queue: VisualEvent[] = [];

  for (const delta of details.recentDeltas) {
    const createdAt = delta.createdAt;

    if (delta.eventType === "moved" && delta.targetCombatantId && delta.from && delta.to) {
      queue.push({
        id: `move-${delta.id}`,
        type: "MoveTrail",
        actorId: delta.targetCombatantId,
        from: delta.from,
        to: delta.to,
        createdAt,
      });
      continue;
    }

    if (delta.eventType === "damage" && delta.targetCombatantId) {
      queue.push({
        id: `hit-${delta.id}`,
        type: "HitImpact",
        actorId: delta.targetCombatantId,
        targetId: delta.targetCombatantId,
        amount: delta.amount,
        createdAt,
      });
      if (typeof delta.amount === "number" && delta.amount > 0) {
        queue.push({
          id: `dmg-${delta.id}`,
          type: "DamageNumber",
          targetId: delta.targetCombatantId,
          amount: Math.max(0, Math.floor(delta.amount)),
          createdAt,
          critical: delta.amount >= 50,
        });
      }
      continue;
    }

    if (delta.eventType === "miss" && delta.targetCombatantId) {
      queue.push({
        id: `miss-${delta.id}`,
        type: "MissIndicator",
        actorId: delta.targetCombatantId,
        targetId: delta.targetCombatantId,
        createdAt,
      });
      continue;
    }

    if ((delta.eventType === "healed" || delta.eventType === "power_gain") && delta.targetCombatantId && typeof delta.amount === "number") {
      queue.push({
        id: `heal-${delta.id}`,
        type: "HealNumber",
        targetId: delta.targetCombatantId,
        amount: Math.max(0, Math.floor(delta.amount)),
        createdAt,
      });
      continue;
    }

    if (delta.eventType === "power_drain" && delta.targetCombatantId && typeof delta.amount === "number") {
      queue.push({
        id: `drain-${delta.id}`,
        type: "DamageNumber",
        targetId: delta.targetCombatantId,
        amount: Math.max(0, Math.floor(delta.amount)),
        createdAt,
        critical: false,
      });
      continue;
    }

    if (delta.eventType === "status_applied" && delta.targetCombatantId) {
      queue.push({
        id: `status-${delta.id}`,
        type: "StatusApply",
        targetId: delta.targetCombatantId,
        label: delta.label,
        amount: delta.amount,
        createdAt,
      });
      continue;
    }

    if (delta.eventType === "status_tick" && delta.targetCombatantId) {
      queue.push({
        id: `tick-${delta.id}`,
        type: "StatusTick",
        targetId: delta.targetCombatantId,
        label: delta.label,
        amount: delta.amount,
        createdAt,
      });
      continue;
    }

    if (delta.eventType === "death" && delta.targetCombatantId) {
      queue.push({
        id: `death-${delta.id}`,
        type: "DeathBurst",
        targetId: delta.targetCombatantId,
        createdAt,
      });
      continue;
    }

    if (delta.eventType === "armor_shred" && delta.targetCombatantId) {
      queue.push({
        id: `barrier-break-${delta.id}`,
        type: "BarrierBreak",
        targetId: delta.targetCombatantId,
        label: "Armor Shred",
        amount: delta.amount,
        createdAt,
      });
      continue;
    }
  }

  const latestDelta = [...details.recentDeltas]
    .sort((left, right) => parseMs(left.createdAt) - parseMs(right.createdAt))
    .slice(-1)[0] ?? null;

  if (details.activeTurnCombatantId) {
    queue.push({
      id: `turn-start-${details.session?.current_turn_index ?? 0}-${details.activeTurnCombatantId}`,
      type: "TurnStart",
      actorId: details.activeTurnCombatantId,
      createdAt: latestDelta?.createdAt ?? new Date().toISOString(),
    });
  }

  const latestCursor = latestDelta
    ? buildCursor({
        turnIndex: latestDelta.turnIndex,
        id: latestDelta.id,
        createdAt: latestDelta.createdAt,
      })
    : null;

  return {
    queue: queue.slice(-32),
    latestCursor,
  };
}
