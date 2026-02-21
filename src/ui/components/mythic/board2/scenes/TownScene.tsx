import { BoardGridLayer } from "@/ui/components/mythic/board2/BoardGridLayer";
import { HotspotOverlay } from "@/ui/components/mythic/board2/HotspotOverlay";
import type { NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface TownSceneProps {
  scene: NarrativeBoardSceneModel;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

export function TownScene(props: TownSceneProps) {
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;

  return (
    <BoardGridLayer
      cols={cols}
      rows={rows}
      className="h-full border-amber-200/35 bg-[radial-gradient(circle_at_18%_12%,rgba(252,211,77,0.24),rgba(16,11,8,0.95))]"
      gridLineColor="rgba(255,245,210,0.10)"
      onSelectMiss={props.onSelectMiss}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(245,158,11,0.12)_0%,transparent_30%,transparent_70%,rgba(245,158,11,0.12)_100%)]" />
      <div className="pointer-events-none absolute left-2 top-2 rounded border border-amber-200/30 bg-black/35 px-2 py-1 text-[10px] uppercase tracking-wide text-amber-100/80">
        Town
      </div>
      <HotspotOverlay
        hotspots={props.scene.hotspots}
        cols={cols}
        rows={rows}
        accent="town"
        onSelectHotspot={props.onSelectHotspot}
      />
    </BoardGridLayer>
  );
}
