import type { MouseEvent } from "react";
import { readGridPointFromEvent } from "@/ui/components/mythic/board2/BoardGridLayer";
import type { NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface HotspotOverlayProps {
  hotspots: NarrativeHotspot[];
  cols: number;
  rows: number;
  accent: "town" | "travel" | "dungeon" | "combat";
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
}

function toPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
}

function accentClass(accent: HotspotOverlayProps["accent"], tier: "primary" | "secondary" | "tertiary"): string {
  if (accent === "town") {
    if (tier === "primary") return "border-amber-100/75 bg-amber-200/25 text-amber-50";
    if (tier === "secondary") return "border-amber-200/55 bg-amber-100/15 text-amber-100";
    return "border-amber-200/35 bg-amber-100/10 text-amber-100/85";
  }
  if (accent === "travel") {
    if (tier === "primary") return "border-cyan-100/75 bg-cyan-200/20 text-cyan-50";
    if (tier === "secondary") return "border-cyan-200/55 bg-cyan-100/14 text-cyan-100";
    return "border-cyan-200/35 bg-cyan-100/10 text-cyan-100/85";
  }
  if (accent === "dungeon") {
    if (tier === "primary") return "border-emerald-100/75 bg-emerald-200/20 text-emerald-50";
    if (tier === "secondary") return "border-emerald-200/55 bg-emerald-100/14 text-emerald-100";
    return "border-emerald-200/35 bg-emerald-100/10 text-emerald-100/85";
  }
  if (tier === "primary") return "border-red-100/75 bg-red-200/22 text-red-50";
  if (tier === "secondary") return "border-red-200/55 bg-red-100/14 text-red-100";
  return "border-red-200/35 bg-red-100/10 text-red-100/85";
}

function readClickPoint(event: MouseEvent<HTMLElement>, cols: number, rows: number): { x: number; y: number } {
  return readGridPointFromEvent(event, cols, rows);
}

export function HotspotOverlay(props: HotspotOverlayProps) {
  return (
    <>
      {props.hotspots
        .filter((hotspot) => !(props.accent === "town" && hotspot.id.startsWith("town-npc-")))
        .map((hotspot) => {
        const tier = hotspot.visual?.tier ?? "secondary";
        const emphasis = hotspot.visual?.emphasis ?? "normal";
        const emphasisClass = emphasis === "pulse"
          ? "animate-pulse"
          : emphasis === "muted"
            ? "opacity-80"
            : "";
        return (
          <button
            key={hotspot.id}
            type="button"
            data-testid={`board-hotspot-${hotspot.id}`}
            className={`absolute rounded-md border px-2 py-1 text-left text-[11px] shadow-[0_0_0_1px_rgba(0,0,0,0.2)] transition hover:brightness-110 ${accentClass(props.accent, tier)} ${emphasisClass}`.trim()}
            style={{
              left: toPercent(hotspot.rect.x, props.cols),
              top: toPercent(hotspot.rect.y, props.rows),
              width: toPercent(hotspot.rect.w, props.cols),
              minHeight: "34px",
            }}
            onClick={(event) => {
              event.stopPropagation();
              props.onSelectHotspot(hotspot, readClickPoint(event, props.cols, props.rows));
            }}
          >
            <div className="truncate font-semibold">
              {hotspot.visual?.icon ? `${hotspot.visual.icon} ` : ""}{hotspot.title}
            </div>
            {hotspot.subtitle ? <div className="truncate text-[10px] opacity-85">{hotspot.subtitle}</div> : null}
          </button>
        );
      })}
    </>
  );
}
