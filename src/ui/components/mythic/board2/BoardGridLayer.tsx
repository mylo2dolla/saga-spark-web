import type { MouseEvent, ReactNode } from "react";

interface BoardGridLayerProps {
  cols: number;
  rows: number;
  blockedTiles?: Array<{ x: number; y: number }>;
  className?: string;
  gridLineColor?: string;
  blockedTileClassName?: string;
  onSelectMiss: (point: { x: number; y: number }) => void;
  children?: ReactNode;
}

export function readGridPointFromEvent(
  event: MouseEvent<HTMLElement>,
  cols: number,
  rows: number,
): { x: number; y: number } {
  const bounds = event.currentTarget.getBoundingClientRect();
  const x = Math.floor(((event.clientX - bounds.left) / Math.max(1, bounds.width)) * cols);
  const y = Math.floor(((event.clientY - bounds.top) / Math.max(1, bounds.height)) * rows);
  return {
    x: Math.max(0, Math.min(cols - 1, x)),
    y: Math.max(0, Math.min(rows - 1, y)),
  };
}

function toPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
}

export function BoardGridLayer(props: BoardGridLayerProps) {
  const cols = Math.max(1, Math.floor(props.cols));
  const rows = Math.max(1, Math.floor(props.rows));
  const gridLineColor = props.gridLineColor ?? "rgba(255,255,255,0.08)";
  const blockedTileClassName = props.blockedTileClassName ?? "border border-amber-200/40 bg-amber-300/20";

  return (
    <div
      className={`relative min-h-[280px] flex-1 overflow-hidden rounded-lg border ${props.className ?? ""}`.trim()}
      onClick={(event) => {
        props.onSelectMiss(readGridPointFromEvent(event, cols, rows));
      }}
    >
      <div
        className="absolute inset-0 opacity-35"
        style={{
          backgroundImage: `linear-gradient(to right, ${gridLineColor} 1px, transparent 1px), linear-gradient(to bottom, ${gridLineColor} 1px, transparent 1px)`,
          backgroundSize: `${100 / cols}% ${100 / rows}%`,
        }}
      />

      {(props.blockedTiles ?? []).map((tile) => (
        <div
          key={`blocked-${tile.x}-${tile.y}`}
          className={`absolute ${blockedTileClassName}`}
          style={{
            left: toPercent(tile.x, cols),
            top: toPercent(tile.y, rows),
            width: toPercent(1, cols),
            height: toPercent(1, rows),
          }}
        />
      ))}

      {props.children}
    </div>
  );
}
