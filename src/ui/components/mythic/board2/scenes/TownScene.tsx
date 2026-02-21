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
  const landmarks = props.scene.hotspots
    .filter((hotspot) => hotspot.kind === "vendor" || hotspot.kind === "notice_board" || hotspot.kind === "gate")
    .map((hotspot) => ({
      id: hotspot.id,
      title: hotspot.title,
      subtitle: hotspot.subtitle,
      rect: hotspot.rect,
      tone: hotspot.kind === "vendor"
        ? "border-amber-100/40 bg-amber-300/12 text-amber-50"
        : hotspot.kind === "notice_board"
          ? "border-yellow-100/35 bg-yellow-300/12 text-yellow-50"
          : "border-orange-100/35 bg-orange-400/14 text-orange-50",
    }));

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
      {landmarks.map((landmark) => (
        <div
          key={`town-landmark-${landmark.id}`}
          className={`pointer-events-none absolute rounded-md border px-1.5 py-1 text-[10px] ${landmark.tone}`}
          style={{
            left: `${(landmark.rect.x / cols) * 100}%`,
            top: `${(landmark.rect.y / rows) * 100}%`,
            width: `${(landmark.rect.w / cols) * 100}%`,
            minHeight: "34px",
          }}
        >
          <div className="truncate font-semibold">{landmark.title}</div>
          {landmark.subtitle ? <div className="truncate text-[9px] opacity-85">{landmark.subtitle}</div> : null}
        </div>
      ))}
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
