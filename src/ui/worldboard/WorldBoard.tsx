import { useMemo, useRef } from "react";
import type { WorldBoardModel } from "./types";

const DEV_DEBUG = import.meta.env.DEV;

interface WorldBoardProps {
  model: WorldBoardModel;
  currentLocationId?: string | null;
}

const BOARD_WIDTH = 520;
const BOARD_HEIGHT = 360;
const PAD = 24;

const normalizePositions = (model: WorldBoardModel) => {
  const nodesWithPos = model.nodes.filter(node => typeof node.x === "number" && typeof node.y === "number");
  if (nodesWithPos.length === 0) return model.nodes;

  const xs = nodesWithPos.map(node => node.x as number);
  const ys = nodesWithPos.map(node => node.y as number);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);

  return model.nodes.map(node => {
    if (typeof node.x !== "number" || typeof node.y !== "number") {
      return node;
    }
    const nx = PAD + ((node.x - minX) / spanX) * (BOARD_WIDTH - PAD * 2);
    const ny = PAD + ((node.y - minY) / spanY) * (BOARD_HEIGHT - PAD * 2);
    return {
      ...node,
      x: nx,
      y: ny,
    };
  });
};

export default function WorldBoard({ model, currentLocationId }: WorldBoardProps) {
  const lastUpdatedRef = useRef<number | null>(null);
  const normalizedNodes = useMemo(() => normalizePositions(model), [model]);
  lastUpdatedRef.current = Date.now();

  const nodeLookup = useMemo(() => {
    const map = new Map<string, { x?: number; y?: number; name: string }>();
    for (const node of normalizedNodes) {
      map.set(node.id, { x: node.x, y: node.y, name: node.name });
    }
    return map;
  }, [normalizedNodes]);

  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <div>World Board</div>
        <div>Nodes: {model.nodes.length} · Edges: {model.edges.length}</div>
      </div>

      <div className="relative overflow-hidden rounded-md border border-border bg-background">
        <svg width={BOARD_WIDTH} height={BOARD_HEIGHT} className="block">
          <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="transparent" />
          {model.edges.map(edge => {
            const from = nodeLookup.get(edge.fromId);
            const to = nodeLookup.get(edge.toId);
            if (!from || !to || from.x == null || from.y == null || to.x == null || to.y == null) return null;
            return (
              <line
                key={edge.id}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="hsl(var(--border))"
                strokeWidth={1}
              />
            );
          })}
          {normalizedNodes.map(node => {
            const isCurrent = node.id === currentLocationId;
            return (
              <g key={node.id}>
                {typeof node.x === "number" && typeof node.y === "number" ? (
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={isCurrent ? 8 : 6}
                    fill={isCurrent ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))"}
                    opacity={isCurrent ? 0.9 : 0.7}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
        {normalizedNodes.map(node => (
          <div
            key={node.id}
            className={`rounded-md border border-border px-2 py-1 ${node.id === currentLocationId ? "bg-primary/10 text-primary" : "bg-background"}`}
          >
            <div className="text-[11px] font-semibold text-foreground">{node.name}</div>
            <div className="text-[10px] text-muted-foreground">{node.id}</div>
          </div>
        ))}
      </div>

      {DEV_DEBUG ? (
        <div className="mt-3 rounded-md border border-border bg-background px-2 py-1 text-[10px] text-muted-foreground">
          <div>Entities: {model.entities.length}</div>
          <div>Factions: {model.factions.length}</div>
          <div>Events: {model.events.length}</div>
          <div>Current: {currentLocationId ?? "none"}</div>
          <div>Updated: {lastUpdatedRef.current ? new Date(lastUpdatedRef.current).toLocaleTimeString() : "-"}</div>
        </div>
      ) : null}
    </div>
  );
}
