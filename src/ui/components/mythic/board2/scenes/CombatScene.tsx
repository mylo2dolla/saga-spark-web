import { useEffect, useMemo, useState } from "react";
import { BoardGridLayer, readGridPointFromEvent } from "@/ui/components/mythic/board2/BoardGridLayer";
import type { CombatSceneData, NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface CombatSceneProps {
  scene: NarrativeBoardSceneModel;
  isActing: boolean;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

const MAX_FLOATING_DELTAS = 8;
const MAX_DELTA_PER_TOKEN = 2;
const MAX_MOVEMENT_TRAILS = 6;
const DELTA_DURATION_MIN_MS = 650;
const DELTA_DURATION_MAX_MS = 900;
const MOVE_TRAIL_DURATION_MS = 900;
const TURN_PULSE_CYCLE_MS = 2200;

function toPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
}

function hpPercent(current: number, max: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

function mpPercent(current: number, max: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

function compactName(name: string, max = 9): string {
  const clean = name.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(3, max - 1))}…`;
}

function cellCenterPercent(cell: number, total: number): number {
  if (total <= 0) return 0;
  return ((Math.floor(cell) + 0.5) / total) * 100;
}

function parseIsoMs(value: string): number {
  const parsed = Number(new Date(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function stackOffset(index: number): { x: number; y: number } {
  const presets: Array<{ x: number; y: number }> = [
    { x: 0, y: 0 },
    { x: 6, y: -6 },
    { x: -6, y: 6 },
    { x: 6, y: 6 },
    { x: -6, y: -6 },
    { x: 10, y: -2 },
  ];
  return presets[Math.max(0, Math.min(presets.length - 1, index))] ?? { x: 0, y: 0 };
}

function deltaTone(eventType: CombatSceneData["recentDeltas"][number]["eventType"]): string {
  if (eventType === "damage" || eventType === "power_drain") return "text-rose-100";
  if (eventType === "healed" || eventType === "power_gain") return "text-emerald-100";
  if (eventType === "moved") return "text-sky-100";
  return "text-amber-100";
}

function deltaDuration(eventType: CombatSceneData["recentDeltas"][number]["eventType"]): number {
  if (eventType === "status_applied") return DELTA_DURATION_MAX_MS;
  if (eventType === "moved") return DELTA_DURATION_MIN_MS;
  return 780;
}

export function CombatScene(props: CombatSceneProps) {
  const details = props.scene.details as CombatSceneData;
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReducedMotion(media.matches);
    sync();
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", sync);
      return () => media.removeEventListener("change", sync);
    }
    media.onchange = sync;
    return () => {
      media.onchange = null;
    };
  }, []);

  const liveDeltaByCombatant = useMemo(() => {
    const out = new Map<string, Array<{ id: string; label: string; tone: string; opacity: number; liftPx: number }>>();
    if (reducedMotion) return out;

    const active = details.recentDeltas
      .map((delta) => {
        if (!delta.targetCombatantId) return null;
        const createdAtMs = parseIsoMs(delta.createdAt);
        if (createdAtMs <= 0) return null;
        const ageMs = nowMs - createdAtMs;
        const durationMs = deltaDuration(delta.eventType);
        if (ageMs < 0 || ageMs > durationMs) return null;
        const fade = Math.max(0, Math.min(1, 1 - (ageMs / durationMs)));
        return {
          id: delta.id,
          label: delta.label,
          tone: deltaTone(delta.eventType),
          targetCombatantId: delta.targetCombatantId,
          createdAtMs,
          opacity: fade,
          liftPx: Math.round((1 - fade) * 10),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, MAX_FLOATING_DELTAS);

    active.forEach((entry) => {
      const next = out.get(entry.targetCombatantId) ?? [];
      if (next.length >= MAX_DELTA_PER_TOKEN) return;
      next.push({
        id: entry.id,
        label: entry.label,
        tone: entry.tone,
        opacity: entry.opacity,
        liftPx: entry.liftPx,
      });
      out.set(entry.targetCombatantId, next);
    });
    return out;
  }, [details.recentDeltas, nowMs, reducedMotion]);

  const movedRecentlyByCombatant = useMemo(() => {
    const out = new Set<string>();
    details.recentDeltas.forEach((delta) => {
      if (delta.eventType !== "moved" || !delta.targetCombatantId) return;
      const age = nowMs - parseIsoMs(delta.createdAt);
      if (age >= 0 && age <= MOVE_TRAIL_DURATION_MS) {
        out.add(delta.targetCombatantId);
      }
    });
    return out;
  }, [details.recentDeltas, nowMs]);

  const movementTrails = useMemo(() => {
    if (reducedMotion) return [];
    return details.recentDeltas
      .filter((delta) => delta.eventType === "moved" && delta.from && delta.to)
      .map((delta) => {
        const createdAtMs = parseIsoMs(delta.createdAt);
        const age = nowMs - createdAtMs;
        if (createdAtMs <= 0 || age < 0 || age > MOVE_TRAIL_DURATION_MS) return null;
        const from = delta.from!;
        const to = delta.to!;
        const x1 = cellCenterPercent(from.x, cols);
        const y1 = cellCenterPercent(from.y, rows);
        const x2 = cellCenterPercent(to.x, cols);
        const y2 = cellCenterPercent(to.y, rows);
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.max(0.6, Math.sqrt((dx * dx) + (dy * dy)));
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        const opacity = Math.max(0, Math.min(1, 1 - (age / MOVE_TRAIL_DURATION_MS)));
        return {
          id: delta.id,
          x1,
          y1,
          x2,
          y2,
          length,
          angle,
          opacity,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .slice(-MAX_MOVEMENT_TRAILS);
  }, [cols, details.recentDeltas, nowMs, reducedMotion, rows]);

  const tileStackIndexByCombatant = useMemo(() => {
    const grouped = new Map<string, string[]>();
    details.combatants.forEach((combatant) => {
      const key = `${Math.floor(combatant.x)}:${Math.floor(combatant.y)}`;
      const list = grouped.get(key) ?? [];
      list.push(combatant.id);
      grouped.set(key, list);
    });
    const out = new Map<string, number>();
    grouped.forEach((ids) => {
      ids.forEach((id, index) => out.set(id, index));
    });
    return out;
  }, [details.combatants]);

  const activeTurnCombatant = useMemo(
    () => (details.activeTurnCombatantId
      ? details.combatants.find((entry) => entry.id === details.activeTurnCombatantId) ?? null
      : null),
    [details.activeTurnCombatantId, details.combatants],
  );

  const turnCue = useMemo(() => {
    if (!activeTurnCombatant) {
      return {
        label: "Awaiting Turn",
        tone: "border-amber-200/35 text-amber-100/80",
      };
    }
    const isPlayer = activeTurnCombatant.entity_type === "player";
    const isAlly = !isPlayer && typeof activeTurnCombatant.player_id === "string" && activeTurnCombatant.player_id.trim().length > 0;
    if (isPlayer) {
      return {
        label: "Your Turn",
        tone: "border-emerald-200/40 text-emerald-100/90",
      };
    }
    if (isAlly) {
      return {
        label: "Ally Turn",
        tone: "border-cyan-200/40 text-cyan-100/90",
      };
    }
    return {
      label: "Enemy Turn",
      tone: "border-rose-200/40 text-rose-100/90",
    };
  }, [activeTurnCombatant]);

  const paceBadge = useMemo(() => {
    const pace = details.paceState;
    if (!pace) return null;
    if (pace.phase === "waiting_voice_end") {
      return { label: "Pace: waiting on voice", tone: "border-cyan-200/35 text-cyan-100/90" };
    }
    if (pace.phase === "step_committed" || pace.phase === "narrating") {
      return { label: "Pace: narrating", tone: "border-blue-200/35 text-blue-100/90" };
    }
    if (pace.phase === "next_step_ready") {
      return { label: "Pace: next step ready", tone: "border-emerald-200/35 text-emerald-100/90" };
    }
    return { label: "Pace: idle", tone: "border-amber-200/35 text-amber-100/90" };
  }, [details.paceState]);

  const moveStateText = details.distanceToFocusedTarget !== null
    ? `Range ${details.distanceToFocusedTarget} · Move ${details.moveBudget} · ${details.moveUsedThisTurn ? "Move used" : "Move ready"}`
    : `Move ${details.moveBudget} · ${details.moveUsedThisTurn ? "Move used" : "Move ready"}`;

  const turnPulsePercent = reducedMotion
    ? 100
    : ((nowMs % TURN_PULSE_CYCLE_MS) / TURN_PULSE_CYCLE_MS) * 100;

  const compactFeed = details.stepResolutions.slice(-5).reverse();

  return (
    <BoardGridLayer
      cols={cols}
      rows={rows}
      blockedTiles={props.scene.grid.blockedTiles}
      className="h-full border-red-200/35 bg-[radial-gradient(circle_at_50%_14%,rgba(248,113,113,0.2),rgba(8,8,16,0.95))]"
      gridLineColor="rgba(254,205,211,0.12)"
      blockedTileClassName="border border-amber-200/35 bg-amber-400/20"
      onSelectMiss={props.onSelectMiss}
    >
      <div className="pointer-events-none absolute left-2 top-2 rounded border border-red-200/35 bg-black/35 px-2 py-1 text-[10px] uppercase tracking-wide text-red-100/85">
        Combat {details.status}
      </div>
      <div className={`pointer-events-none absolute right-2 top-2 rounded border bg-black/35 px-2 py-1 text-[10px] uppercase tracking-wide ${turnCue.tone}`}>
        {props.isActing ? "Action Committed" : turnCue.label}
      </div>
      {paceBadge ? (
        <div
          data-testid="combat-pace-badge"
          className={`pointer-events-none absolute left-2 top-[30px] rounded border bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wide ${paceBadge.tone}`}
        >
          {paceBadge.label}
        </div>
      ) : null}
      <div
        data-testid="combat-move-state"
        className="pointer-events-none absolute left-2 top-[56px] rounded border border-amber-200/35 bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-100/85"
      >
        {moveStateText}
      </div>
      {activeTurnCombatant ? (
        <div className="pointer-events-none absolute right-2 top-[30px] h-1.5 w-[120px] overflow-hidden rounded-full border border-white/15 bg-black/45">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(244,114,182,0.8),rgba(56,189,248,0.85))] motion-reduce:transition-none"
            style={{ width: `${Math.max(8, Math.min(100, turnPulsePercent))}%` }}
          />
        </div>
      ) : null}
      {details.rewardSummary ? (
        <div className="pointer-events-none absolute left-2 right-2 top-[84px] rounded border border-emerald-200/35 bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-100">
          {details.rewardSummary.victory ? "Victory" : "Setback"} · +{details.rewardSummary.xpGained} XP
          {details.rewardSummary.loot.length > 0 ? ` · Loot: ${details.rewardSummary.loot.slice(0, 2).join(", ")}` : ""}
        </div>
      ) : null}

      {movementTrails.map((trail) => (
        <div key={`trail-${trail.id}`} className="pointer-events-none absolute inset-0">
          <div
            className="absolute h-[2px] origin-left rounded bg-sky-200/75 shadow-[0_0_8px_rgba(125,211,252,0.6)]"
            style={{
              left: `${trail.x1}%`,
              top: `${trail.y1}%`,
              width: `${trail.length}%`,
              opacity: trail.opacity,
              transform: `translateY(-50%) rotate(${trail.angle}deg)`,
            }}
          />
          <div
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-100 shadow-[0_0_10px_rgba(186,230,253,0.85)]"
            style={{
              left: `${trail.x2}%`,
              top: `${trail.y2}%`,
              opacity: trail.opacity,
            }}
          />
        </div>
      ))}

      {details.movementTiles.map((tile) => (
        <div
          key={`movement-tile-${tile.x}-${tile.y}`}
          className="pointer-events-none absolute border border-cyan-200/45 bg-cyan-400/16"
          style={{
            left: toPercent(tile.x, cols),
            top: toPercent(tile.y, rows),
            width: toPercent(1, cols),
            height: toPercent(1, rows),
          }}
        />
      ))}

      {details.combatants.map((combatant) => {
        const x = Math.max(0, Math.min(cols - 1, Math.floor(combatant.x)));
        const y = Math.max(0, Math.min(rows - 1, Math.floor(combatant.y)));
        const hp = hpPercent(combatant.hp, combatant.hp_max);
        const mp = mpPercent(combatant.power, combatant.power_max);
        const focused = details.focusedCombatantId === combatant.id;
        const active = details.activeTurnCombatantId === combatant.id;
        const isAlly = typeof combatant.player_id === "string" && combatant.player_id.trim().length > 0;
        const tone = isAlly ? "bg-emerald-300/45 border-emerald-200/70" : "bg-red-300/45 border-red-200/70";
        const hotspot = props.scene.hotspots.find((entry) => entry.id === `combatant-${combatant.id}`);
        const liveDeltas = liveDeltaByCombatant.get(combatant.id) ?? [];
        const movedRecently = movedRecentlyByCombatant.has(combatant.id);
        const stackIndex = tileStackIndexByCombatant.get(combatant.id) ?? 0;
        const offset = stackOffset(stackIndex);
        const focusRing = focused ? "ring-2 ring-amber-300/95" : "";
        const activeRing = active ? "shadow-[0_0_0_2px_rgba(125,211,252,0.82)]" : "";
        const movedRing = movedRecently ? "shadow-[0_0_0_2px_rgba(125,211,252,0.55)]" : "";

        return (
          <button
            key={`${combatant.id}:${details.session?.current_turn_index ?? 0}`}
            type="button"
            data-testid={`combat-token-${combatant.id}`}
            data-hp={Math.max(0, Math.round(combatant.hp))}
            className={[
              "absolute rounded-md border px-1 py-1 text-left text-[9px] text-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]",
              tone,
              focusRing,
              activeRing,
              movedRing,
            ].join(" ")}
            style={{
              left: toPercent(x, cols),
              top: toPercent(y, rows),
              width: toPercent(1, cols),
              minHeight: "30px",
              transform: offset.x === 0 && offset.y === 0 ? undefined : `translate(${offset.x}px, ${offset.y}px)`,
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (!hotspot) return;
              props.onSelectHotspot(hotspot, readGridPointFromEvent(event, cols, rows));
            }}
          >
            {liveDeltas.length > 0 ? (
              <div className="pointer-events-none absolute -top-2 left-1/2 max-w-[76px] -translate-x-1/2 text-center">
                {liveDeltas.map((delta) => (
                  <div
                    key={`${combatant.id}:${delta.id}`}
                    className={`truncate text-[8px] font-semibold ${delta.tone}`}
                    style={{
                      opacity: delta.opacity,
                      transform: `translateY(-${delta.liftPx}px)`,
                    }}
                  >
                    {delta.label}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="truncate font-semibold leading-tight">{details.displayNames[combatant.id]?.displayLabel ?? compactName(combatant.name)}</div>
            <div className="mt-0.5 h-1 w-full rounded bg-black/35">
              <div className="h-full rounded bg-emerald-300" style={{ width: `${hp}%` }} />
            </div>
            <div className="mt-0.5 h-1 w-full rounded bg-black/35">
              <div className="h-full rounded bg-sky-300" style={{ width: `${mp}%` }} />
            </div>
            <div className="mt-0.5 flex items-center justify-between text-[8px] text-white/85">
              <span>{Math.max(0, Math.round(combatant.hp))}</span>
              <span>{Math.max(0, Math.round(combatant.power))}MP</span>
            </div>
          </button>
        );
      })}

      {compactFeed.length > 0 ? (
        <div
          data-testid="combat-impact-feed"
          className="pointer-events-none absolute bottom-2 left-2 max-w-[58%] rounded border border-amber-200/35 bg-black/45 p-1.5 text-[9px] text-amber-100/80"
        >
          <div className="mb-0.5 text-[8px] uppercase tracking-wide text-amber-100/70">Feed</div>
          {compactFeed.map((entry) => (
            <div key={`step-resolution-${entry.id}`} className="truncate">
              {entry.actor}
              {entry.target ? ` -> ${entry.target}` : ""} · {entry.eventType.replace(/_/g, " ")}
              {entry.amount !== null ? ` ${entry.amount}` : ""}
            </div>
          ))}
        </div>
      ) : null}
    </BoardGridLayer>
  );
}
