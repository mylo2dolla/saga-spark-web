import { BoardGridLayer } from "@/ui/components/mythic/board2/BoardGridLayer";
import { BoardLegend } from "@/ui/components/mythic/board2/BoardLegend";
import { HotspotOverlay } from "@/ui/components/mythic/board2/HotspotOverlay";
import type { NarrativeBoardSceneModel, NarrativeHotspot, TravelSceneData } from "@/ui/components/mythic/board2/types";

interface TravelSceneProps {
  scene: NarrativeBoardSceneModel;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

function formatGoal(value: string): string {
  return value.replace(/_/g, " ");
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
  const details = props.scene.details as TravelSceneData;
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const routePath = buildRoutePath(props.scene);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-cyan-200/30 bg-[linear-gradient(165deg,rgba(9,44,57,0.9),rgba(8,15,24,0.97))] p-3 text-cyan-50">
      <div>
        <div className="font-display text-xl text-cyan-100">{props.scene.title}</div>
        <div className="text-xs text-cyan-100/80">{props.scene.subtitle}</div>
      </div>

      <BoardGridLayer
        cols={cols}
        rows={rows}
        className="border-cyan-200/35 bg-[radial-gradient(circle_at_70%_15%,rgba(103,232,249,0.22),rgba(4,7,16,0.95))]"
        gridLineColor="rgba(207,250,254,0.10)"
        onSelectMiss={props.onSelectMiss}
      >
        {routePath ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-70" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline
              points={routePath}
              fill="none"
              stroke="rgba(56,189,248,0.65)"
              strokeWidth="0.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        <HotspotOverlay
          hotspots={props.scene.hotspots}
          cols={cols}
          rows={rows}
          accent="travel"
          onSelectHotspot={props.onSelectHotspot}
        />
      </BoardGridLayer>

      <BoardLegend items={props.scene.legend} />

      <div className="grid gap-2 text-[11px] text-cyan-100/80 sm:grid-cols-3">
        <div className="rounded border border-cyan-200/30 bg-cyan-100/5 p-2">
          <div className="mb-1 font-semibold text-cyan-100">Route Goal</div>
          <div>{formatGoal(details.travelGoal)}</div>
          <div className="mt-1 text-cyan-100/70">Search target: {details.searchTarget ?? "none"}</div>
        </div>
        <div className="rounded border border-cyan-200/30 bg-cyan-100/5 p-2">
          <div className="mb-1 font-semibold text-cyan-100">Route Segments</div>
          <div>{details.routeSegments.length} mapped</div>
          <div className="mt-1 text-cyan-100/70">
            Avg danger: {details.routeSegments.length === 0
              ? "0"
              : Math.round(details.routeSegments.reduce((sum, row) => sum + row.danger, 0) / details.routeSegments.length)}
          </div>
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
