import { BoardGridLayer } from "@/ui/components/mythic/board2/BoardGridLayer";
import { HotspotOverlay } from "@/ui/components/mythic/board2/HotspotOverlay";
import type { NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface TravelSceneProps {
  scene: NarrativeBoardSceneModel;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

function formatPercent(value: number, total: number): string {
  if (total <= 0) return "0";
  return ((value / total) * 100).toFixed(2);
}

function buildRoutePath(scene: NarrativeBoardSceneModel): string | null {
  const routeHotspots = scene.hotspots.filter((entry) => entry.kind === "route_segment");
  if (routeHotspots.length < 2) return null;
  const points = routeHotspots
    .slice()
    .sort((a, b) => {
      const ay = a.rect.y * 100 + a.rect.x;
      const by = b.rect.y * 100 + b.rect.x;
      return ay - by;
    })
    .map((hotspot) => {
      const cx = hotspot.rect.x + hotspot.rect.w / 2;
      const cy = hotspot.rect.y + hotspot.rect.h / 2;
      return `${formatPercent(cx, scene.grid.cols)},${formatPercent(cy, scene.grid.rows)}`;
    });
  return points.join(" ");
}

export function TravelScene(props: TravelSceneProps) {
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const routePath = buildRoutePath(props.scene);
  const routeHotspots = props.scene.hotspots.filter((entry) => entry.kind === "route_segment");
  const probeHotspots = props.scene.hotspots.filter((entry) => entry.kind === "dungeon_entry" || entry.kind === "return_town");

  return (
    <BoardGridLayer
      cols={cols}
      rows={rows}
      className="h-full border-cyan-200/35 bg-[radial-gradient(circle_at_70%_15%,rgba(103,232,249,0.22),rgba(4,7,16,0.95))]"
      gridLineColor="rgba(207,250,254,0.10)"
      onSelectMiss={props.onSelectMiss}
    >
      <div className="pointer-events-none absolute left-2 top-2 rounded border border-cyan-200/35 bg-black/35 px-2 py-1 text-[10px] uppercase tracking-wide text-cyan-100/80">
        Travel
      </div>
      {routePath ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-70" viewBox="0 0 100 100" preserveAspectRatio="none">
          <polyline
            points={routePath}
            fill="none"
            stroke="rgba(56,189,248,0.88)"
            strokeWidth="1.15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {probeHotspots.map((hotspot) => {
            const cx = ((hotspot.rect.x + hotspot.rect.w / 2) / cols) * 100;
            const cy = ((hotspot.rect.y + hotspot.rect.h / 2) / rows) * 100;
            const anchor = routeHotspots[routeHotspots.length - 1] ?? routeHotspots[0];
            if (!anchor) return null;
            const ax = ((anchor.rect.x + anchor.rect.w / 2) / cols) * 100;
            const ay = ((anchor.rect.y + anchor.rect.h / 2) / rows) * 100;
            return (
              <line
                key={`probe-link-${hotspot.id}`}
                x1={ax}
                y1={ay}
                x2={cx}
                y2={cy}
                stroke="rgba(125,211,252,0.42)"
                strokeWidth="0.7"
                strokeDasharray="2.2 1.6"
              />
            );
          })}
        </svg>
      ) : null}
      {routeHotspots.map((hotspot) => {
        const danger = typeof hotspot.meta?.danger === "number" ? Math.max(0, Math.floor(hotspot.meta.danger)) : null;
        if (danger === null) return null;
        return (
          <div
            key={`travel-danger-${hotspot.id}`}
            className="pointer-events-none absolute rounded border border-cyan-100/35 bg-black/50 px-1 py-0.5 text-[9px] text-cyan-100/85"
            style={{
              left: `${((hotspot.rect.x + hotspot.rect.w - 0.6) / cols) * 100}%`,
              top: `${((hotspot.rect.y - 0.35) / rows) * 100}%`,
            }}
          >
            D{danger}
          </div>
        );
      })}
      <HotspotOverlay
        hotspots={props.scene.hotspots}
        cols={cols}
        rows={rows}
        accent="travel"
        onSelectHotspot={props.onSelectHotspot}
      />
    </BoardGridLayer>
  );
}
