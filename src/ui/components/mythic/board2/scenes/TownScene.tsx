import type { MouseEvent } from "react";
import type { NarrativeBoardSceneModel, NarrativeHotspot, TownSceneData } from "@/ui/components/mythic/board2/types";

interface TownSceneProps {
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

export function TownScene(props: TownSceneProps) {
  const details = props.scene.details as TownSceneData;
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const rumors = details.rumors.slice(0, 3);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-amber-200/30 bg-[linear-gradient(165deg,rgba(59,35,18,0.92),rgba(18,17,14,0.96))] p-3 text-amber-50">
      <div>
        <div className="font-display text-xl text-amber-100">{props.scene.title}</div>
        <div className="text-xs text-amber-100/80">{props.scene.subtitle}</div>
      </div>

      <div
        className="relative min-h-[280px] flex-1 overflow-hidden rounded-lg border border-amber-200/35 bg-[radial-gradient(circle_at_18%_12%,rgba(252,211,77,0.2),rgba(16,11,8,0.95))]"
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
            className="absolute rounded-md border border-amber-200/45 bg-amber-100/10 px-2 py-1 text-left text-[11px] text-amber-100 shadow-[0_0_0_1px_rgba(0,0,0,0.2)] transition hover:bg-amber-100/20"
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
            {hotspot.subtitle ? <div className="truncate text-[10px] text-amber-100/75">{hotspot.subtitle}</div> : null}
          </button>
        ))}
      </div>

      <div className="grid gap-2 text-[11px] text-amber-100/80 sm:grid-cols-2">
        <div className="rounded border border-amber-200/30 bg-amber-100/5 p-2">
          <div className="mb-1 font-semibold text-amber-100">Vendors</div>
          {details.vendors.length === 0 ? (
            <div>No vendors in current runtime state.</div>
          ) : (
            details.vendors.slice(0, 3).map((vendor) => (
              <div key={vendor.id} className="truncate">{vendor.name}</div>
            ))
          )}
        </div>
        <div className="rounded border border-amber-200/30 bg-amber-100/5 p-2">
          <div className="mb-1 font-semibold text-amber-100">Rumors</div>
          {rumors.length === 0 ? <div>No active rumors.</div> : rumors.map((rumor, index) => (
            <div key={`rumor-${index + 1}`} className="line-clamp-1">{rumor}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
