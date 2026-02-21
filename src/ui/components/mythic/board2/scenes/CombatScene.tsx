import { useEffect, useMemo, useState } from "react";
import { BoardGridLayer, readGridPointFromEvent } from "@/ui/components/mythic/board2/BoardGridLayer";
import type { CombatSceneData, NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface CombatSceneProps {
  scene: NarrativeBoardSceneModel;
  isActing: boolean;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
  onQuickCast: (skillId: string, targeting: string) => void;
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
          : "text-amber-100";
      const next = out.get(delta.targetCombatantId) ?? [];
      next.push({ id: delta.id, label: delta.label, tone });
      out.set(delta.targetCombatantId, next.slice(-1));
    });
    return out;
  }, [details.recentDeltas, nowMs]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-red-200/35 bg-[linear-gradient(165deg,rgba(68,18,20,0.93),rgba(7,8,14,0.98))] p-3 text-red-50">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-display text-lg text-red-100">{props.scene.title}</div>
          <div className="text-xs text-red-100/75">{props.scene.subtitle}</div>
        </div>
        <div className="rounded border border-red-200/45 bg-red-100/10 px-2 py-1 text-[11px] uppercase tracking-wide text-red-100/85">
          {details.status}
        </div>
      </div>

      <BoardGridLayer
        cols={cols}
        rows={rows}
        blockedTiles={props.scene.grid.blockedTiles}
        className="flex-1 border-red-200/35 bg-[radial-gradient(circle_at_50%_14%,rgba(248,113,113,0.2),rgba(8,8,16,0.95))]"
        gridLineColor="rgba(254,205,211,0.12)"
        blockedTileClassName="border border-amber-200/35 bg-amber-400/20"
        onSelectMiss={props.onSelectMiss}
      >
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

          return (
            <button
              key={combatant.id}
              type="button"
              className={`absolute rounded-md border px-1 py-1 text-left text-[9px] text-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)] ${tone} ${focused ? "ring-2 ring-amber-300" : ""} ${active ? "ring-2 ring-white/80" : ""}`}
              style={{
                left: toPercent(x, cols),
                top: toPercent(y, rows),
                width: toPercent(1, cols),
                minHeight: "30px",
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (!hotspot) return;
                props.onSelectHotspot(hotspot, readGridPointFromEvent(event, cols, rows));
              }}
            >
              {liveDeltas.length > 0 ? (
                <div className="pointer-events-none absolute -top-2 left-1/2 max-w-[80px] -translate-x-1/2 text-center">
                  {liveDeltas.map((delta) => (
                    <div key={`${combatant.id}:${delta.id}`} className={`truncate animate-[pulse_0.8s_ease-in-out_1] text-[8px] font-semibold ${delta.tone}`}>
                      {delta.label}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="truncate font-semibold leading-tight">{compactName(combatant.name)}</div>
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

      <div className="text-[11px] text-red-100/70">
        Focus a token to inspect options. Core actions are pinned above the board.
      </div>
    </div>
  );
}
