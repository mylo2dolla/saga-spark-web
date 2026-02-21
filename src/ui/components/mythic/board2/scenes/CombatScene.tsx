import { useEffect, useMemo, useState } from "react";
import { BoardGridLayer, readGridPointFromEvent } from "@/ui/components/mythic/board2/BoardGridLayer";
import type { CombatSceneData, NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface CombatSceneProps {
  scene: NarrativeBoardSceneModel;
  isActing: boolean;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

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

export function CombatScene(props: CombatSceneProps) {
  const details = props.scene.details as CombatSceneData;
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 350);
    return () => window.clearInterval(timer);
  }, []);

  const liveDeltaByCombatant = useMemo(() => {
    const out = new Map<string, Array<{ id: string; label: string; tone: string }>>();
    details.recentDeltas.forEach((delta) => {
      if (!delta.targetCombatantId) return;
      const createdAtMs = Number(new Date(delta.createdAt));
      if (!Number.isFinite(createdAtMs)) return;
      if (nowMs - createdAtMs > 5_800) return;
      const tone = delta.eventType === "damage" || delta.eventType === "power_drain"
        ? "text-rose-100"
        : delta.eventType === "healed" || delta.eventType === "power_gain"
          ? "text-emerald-100"
          : delta.eventType === "moved"
            ? "text-sky-100"
          : "text-amber-100";
      const next = out.get(delta.targetCombatantId) ?? [];
      next.push({ id: delta.id, label: delta.label, tone });
      out.set(delta.targetCombatantId, next.slice(-2));
    });
    return out;
  }, [details.recentDeltas, nowMs]);

  const movedRecentlyByCombatant = useMemo(() => {
    const out = new Set<string>();
    details.recentDeltas.forEach((delta) => {
      if (delta.eventType !== "moved" || !delta.targetCombatantId) return;
      const createdAtMs = Number(new Date(delta.createdAt));
      if (!Number.isFinite(createdAtMs)) return;
      if (nowMs - createdAtMs > 3_000) return;
      out.add(delta.targetCombatantId);
    });
    return out;
  }, [details.recentDeltas, nowMs]);

  const movementTrails = useMemo(() => {
    return details.recentDeltas
      .filter((delta) => delta.eventType === "moved" && delta.from && delta.to)
      .filter((delta) => {
        const createdAtMs = Number(new Date(delta.createdAt));
        if (!Number.isFinite(createdAtMs)) return false;
        return nowMs - createdAtMs <= 2_800;
      })
      .slice(-6)
      .map((delta) => {
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
        return {
          id: delta.id,
          x1,
          y1,
          x2,
          y2,
          length,
          angle,
        };
      });
  }, [cols, details.recentDeltas, nowMs, rows]);

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
  const turnPulsePercent = (nowMs % 2200) / 22;

  const compactNameById = useMemo(() => {
    const baseCounts = new Map<string, number>();
    details.combatants.forEach((combatant) => {
      const base = compactName(combatant.name, 8);
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
    });
    const out = new Map<string, string>();
    details.combatants.forEach((combatant) => {
      const base = compactName(combatant.name, 8);
      if ((baseCounts.get(base) ?? 0) <= 1) {
        out.set(combatant.id, base);
        return;
      }
      const suffix = combatant.id.replace(/[^a-z0-9]/gi, "").slice(-2).toUpperCase();
      out.set(combatant.id, `${compactName(combatant.name, 6)} ${suffix || "X"}`);
    });
    return out;
  }, [details.combatants]);

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
      {activeTurnCombatant ? (
        <div className="pointer-events-none absolute right-2 top-[30px] h-1.5 w-[120px] overflow-hidden rounded-full border border-white/15 bg-black/45">
          <div
            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(244,114,182,0.8),rgba(56,189,248,0.85))]"
            style={{ width: `${Math.max(8, Math.min(100, turnPulsePercent))}%` }}
          />
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
              transform: `translateY(-50%) rotate(${trail.angle}deg)`,
            }}
          />
          <div
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-100 shadow-[0_0_10px_rgba(186,230,253,0.85)]"
            style={{
              left: `${trail.x2}%`,
              top: `${trail.y2}%`,
            }}
          />
        </div>
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
        const offsetPx = Math.min(3, stackIndex) * 5;

        return (
          <button
            key={combatant.id}
            type="button"
            className={[
              "absolute rounded-md border px-1 py-1 text-left text-[9px] text-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]",
              tone,
              focused ? "ring-2 ring-amber-300" : "",
              active ? "ring-2 ring-white/80 animate-pulse" : "",
              movedRecently ? "ring-2 ring-sky-200/80" : "",
            ].join(" ")}
            style={{
              left: toPercent(x, cols),
              top: toPercent(y, rows),
              width: toPercent(1, cols),
              minHeight: "30px",
              transform: offsetPx > 0 ? `translate(${offsetPx}px, ${-offsetPx}px)` : undefined,
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
                  <div key={`${combatant.id}:${delta.id}`} className={`truncate animate-[pulse_0.8s_ease-in-out_1] text-[8px] font-semibold ${delta.tone}`}>
                    {delta.label}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="truncate font-semibold leading-tight">{compactNameById.get(combatant.id) ?? compactName(combatant.name)}</div>
            <div className="mt-0.5 h-1 w-full rounded bg-black/35">
              <div className="h-full rounded bg-emerald-300" style={{ width: `${hp}%` }} />
            </div>
            <div className="mt-0.5 h-1 w-full rounded bg-black/35">
              <div className="h-full rounded bg-sky-300" style={{ width: `${mp}%` }} />
            </div>
            <div className="mt-0.5 flex items-center justify-between text-[8px] text-white/85">
              <span>{Math.floor(combatant.hp)}</span>
              <span>{Math.floor(combatant.power)}MP</span>
            </div>
          </button>
        );
      })}
    </BoardGridLayer>
  );
}
