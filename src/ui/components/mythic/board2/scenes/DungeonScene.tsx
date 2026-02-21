import { BoardGridLayer } from "@/ui/components/mythic/board2/BoardGridLayer";
import { HotspotOverlay } from "@/ui/components/mythic/board2/HotspotOverlay";
import type { NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

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
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const centers = buildRoomCenterMap(props.scene);
  const edges = props.scene.hotspots
    .filter((hotspot) => hotspot.kind === "door")
    .map((hotspot) => {
      const from = typeof hotspot.meta?.from_room_id === "string" ? hotspot.meta.from_room_id : null;
      const to = typeof hotspot.meta?.to_room_id === "string" ? hotspot.meta.to_room_id : null;
      if (!from || !to) return null;
      return { from, to };
    })
    .filter((entry): entry is { from: string; to: string } => Boolean(entry));

  return (
    <BoardGridLayer
      cols={cols}
      rows={rows}
      className="h-full border-emerald-200/35 bg-[radial-gradient(circle_at_50%_10%,rgba(74,222,128,0.18),rgba(2,8,14,0.95))]"
      gridLineColor="rgba(209,250,229,0.10)"
      onSelectMiss={props.onSelectMiss}
    >
      <div className="pointer-events-none absolute left-2 top-2 rounded border border-emerald-200/35 bg-black/35 px-2 py-1 text-[10px] uppercase tracking-wide text-emerald-100/80">
        Dungeon
      </div>
      {edges.length > 0 ? (
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-75" viewBox="0 0 100 100" preserveAspectRatio="none">
          {edges.map((edge, index) => {
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
  );
}
