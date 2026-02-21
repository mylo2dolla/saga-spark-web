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
    <div className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-amber-200/30 bg-[linear-gradient(165deg,rgba(59,35,18,0.92),rgba(18,17,14,0.96))] p-3 text-amber-50">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-display text-lg text-amber-100">{props.scene.title}</div>
          <div className="text-xs text-amber-100/75">{props.scene.subtitle}</div>
        </div>
        <div className="rounded border border-amber-200/35 bg-amber-100/10 px-2 py-1 text-[11px] text-amber-100/80">
          Town Board
        </div>
      </div>

      <BoardGridLayer
        cols={cols}
        rows={rows}
        className="flex-1 border-amber-200/35 bg-[radial-gradient(circle_at_18%_12%,rgba(252,211,77,0.24),rgba(16,11,8,0.95))]"
        gridLineColor="rgba(255,245,210,0.10)"
        onSelectMiss={props.onSelectMiss}
      >
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(245,158,11,0.12)_0%,transparent_30%,transparent_70%,rgba(245,158,11,0.12)_100%)]" />
        <HotspotOverlay
          hotspots={props.scene.hotspots}
          cols={cols}
          rows={rows}
          accent="town"
          onSelectHotspot={props.onSelectHotspot}
        />
      </BoardGridLayer>

      <div className="text-[11px] text-amber-100/70">Tap any marker to inspect first, then confirm an action.</div>
    </div>
  );
}
