import { BoardGridLayer } from "@/ui/components/mythic/board2/BoardGridLayer";
import { BoardLegend } from "@/ui/components/mythic/board2/BoardLegend";
import { HotspotOverlay } from "@/ui/components/mythic/board2/HotspotOverlay";
import type { DungeonSceneData, NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface DungeonSceneProps {
  scene: NarrativeBoardSceneModel;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

function toView(value: number, total: number): number {
  if (total <= 0) return 0;
  return Number((((value / total) * 100)).toFixed(2));
}

function buildRoomCenterMap(scene: NarrativeBoardSceneModel): Map<string, { x: number; y: number }> {
  const map = new Map<string, { x: number; y: number }>();
  scene.hotspots
    .filter((hotspot) => hotspot.kind === "room")
    .forEach((hotspot) => {
      const roomId = typeof hotspot.meta?.room_id === "string" ? hotspot.meta.room_id : null;
      if (!roomId) return;
      map.set(roomId, {
        x: hotspot.rect.x + hotspot.rect.w / 2,
        y: hotspot.rect.y + hotspot.rect.h / 2,
      });
    });
  return map;
}

export function DungeonScene(props: DungeonSceneProps) {
  const details = props.scene.details as DungeonSceneData;
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const centers = buildRoomCenterMap(props.scene);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-emerald-200/30 bg-[linear-gradient(165deg,rgba(22,40,33,0.95),rgba(7,11,17,0.98))] p-3 text-emerald-50">
      <div>
        <div className="font-display text-xl text-emerald-100">{props.scene.title}</div>
        <div className="text-xs text-emerald-100/80">{props.scene.subtitle}</div>
      </div>

      <BoardGridLayer
        cols={cols}
        rows={rows}
        className="border-emerald-200/35 bg-[radial-gradient(circle_at_50%_10%,rgba(74,222,128,0.18),rgba(2,8,14,0.95))]"
        gridLineColor="rgba(209,250,229,0.10)"
        onSelectMiss={props.onSelectMiss}
      >
        {details.edges.length > 0 ? (
          <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-75" viewBox="0 0 100 100" preserveAspectRatio="none">
            {details.edges.map((edge, index) => {
              const from = centers.get(edge.from);
              const to = centers.get(edge.to);
              if (!from || !to) return null;
              return (
                <line
                  key={`edge-${edge.from}-${edge.to}-${index + 1}`}
                  x1={toView(from.x, cols)}
                  y1={toView(from.y, rows)}
                  x2={toView(to.x, cols)}
                  y2={toView(to.y, rows)}
                  stroke="rgba(52,211,153,0.55)"
                  strokeWidth="0.8"
                />
              );
            })}
          </svg>
        ) : null}

        <HotspotOverlay
          hotspots={props.scene.hotspots}
          cols={cols}
          rows={rows}
          accent="dungeon"
          onSelectHotspot={props.onSelectHotspot}
        />
      </BoardGridLayer>

      <BoardLegend items={props.scene.legend} />

      <div className="grid gap-2 text-[11px] text-emerald-100/80 sm:grid-cols-3">
        <div className="rounded border border-emerald-200/30 bg-emerald-100/5 p-2">
          <div className="mb-1 font-semibold text-emerald-100">Room Graph</div>
          <div>Rooms: {details.rooms.length}</div>
          <div>Edges: {details.edges.length}</div>
        </div>
        <div className="rounded border border-emerald-200/30 bg-emerald-100/5 p-2">
          <div className="mb-1 font-semibold text-emerald-100">Hazards</div>
          <div>Trap signals: {details.trapSignals}</div>
          <div>Loot nodes: {details.lootNodes}</div>
        </div>
        <div className="rounded border border-emerald-200/30 bg-emerald-100/5 p-2">
          <div className="mb-1 font-semibold text-emerald-100">Factions</div>
          {details.factionPresence.length === 0 ? (
            <div>No active faction footprint.</div>
          ) : (
            details.factionPresence.slice(0, 3).map((entry, index) => (
              <div key={`faction-${index + 1}`} className="truncate">{entry}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
