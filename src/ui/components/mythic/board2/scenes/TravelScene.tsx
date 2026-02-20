import type { MouseEvent } from "react";
import type { NarrativeBoardSceneModel, NarrativeHotspot, TravelSceneData } from "@/ui/components/mythic/board2/types";

interface TravelSceneProps {
  scene: NarrativeBoardSceneModel;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

function toPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
}

function readGridPoint(event: MouseEvent<HTMLElement>, cols: number, rows: number): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = Math.floor(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * cols);
  const y = Math.floor(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * rows);
  return {
    x: Math.max(0, Math.min(cols - 1, x)),
    y: Math.max(0, Math.min(rows - 1, y)),
  };
}

function formatGoal(value: string): string {
  return value.replace(/_/g, " ");
}

export function TravelScene(props: TravelSceneProps) {
  const details = props.scene.details as TravelSceneData;
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-cyan-200/30 bg-[linear-gradient(165deg,rgba(9,44,57,0.9),rgba(8,15,24,0.97))] p-3 text-cyan-50">
      <div>
        <div className="font-display text-xl text-cyan-100">{props.scene.title}</div>
        <div className="text-xs text-cyan-100/80">{props.scene.subtitle}</div>
      </div>

      <div
        className="relative min-h-[280px] flex-1 overflow-hidden rounded-lg border border-cyan-200/35 bg-[radial-gradient(circle_at_70%_15%,rgba(103,232,249,0.2),rgba(4,7,16,0.95))]"
        onClick={(event) => {
          const point = readGridPoint(event, cols, rows);
          props.onSelectMiss(point);
        }}
      >
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: `${100 / cols}% ${100 / rows}%`,
          }}
        />

        {props.scene.hotspots.map((hotspot) => (
          <button
            key={hotspot.id}
            type="button"
            className="absolute rounded-md border border-cyan-200/45 bg-cyan-100/10 px-2 py-1 text-left text-[11px] text-cyan-100 shadow-[0_0_0_1px_rgba(0,0,0,0.2)] transition hover:bg-cyan-100/20"
            style={{
              left: toPercent(hotspot.rect.x, cols),
              top: toPercent(hotspot.rect.y, rows),
              width: toPercent(hotspot.rect.w, cols),
              minHeight: "34px",
            }}
            onClick={(event) => {
              event.stopPropagation();
              const point = readGridPoint(event, cols, rows);
              props.onSelectHotspot(hotspot, point);
            }}
          >
            <div className="truncate font-semibold">{hotspot.title}</div>
            {hotspot.subtitle ? <div className="truncate text-[10px] text-cyan-100/75">{hotspot.subtitle}</div> : null}
          </button>
        ))}
      </div>

      <div className="grid gap-2 text-[11px] text-cyan-100/80 sm:grid-cols-2">
        <div className="rounded border border-cyan-200/30 bg-cyan-100/5 p-2">
          <div className="mb-1 font-semibold text-cyan-100">Route Goal</div>
          <div>{formatGoal(details.travelGoal)}</div>
          <div className="mt-1 text-cyan-100/70">Search target: {details.searchTarget ?? "none"}</div>
        </div>
        <div className="rounded border border-cyan-200/30 bg-cyan-100/5 p-2">
          <div className="mb-1 font-semibold text-cyan-100">Runtime Signals</div>
          <div>Encounter: {details.encounterTriggered ? "triggered" : "clear"}</div>
          <div>Dungeon traces: {details.dungeonTracesFound ? "found" : "none"}</div>
        </div>
      </div>
    </div>
  );
}
