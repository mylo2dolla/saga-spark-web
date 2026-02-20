import { BoardGridLayer } from "@/ui/components/mythic/board2/BoardGridLayer";
import { BoardLegend } from "@/ui/components/mythic/board2/BoardLegend";
import { HotspotOverlay } from "@/ui/components/mythic/board2/HotspotOverlay";
import type { NarrativeBoardSceneModel, NarrativeHotspot, TownSceneData } from "@/ui/components/mythic/board2/types";

interface TownSceneProps {
  scene: NarrativeBoardSceneModel;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

export function TownScene(props: TownSceneProps) {
  const details = props.scene.details as TownSceneData;
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const rumors = details.rumors.slice(0, 3);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-amber-200/30 bg-[linear-gradient(165deg,rgba(59,35,18,0.92),rgba(18,17,14,0.96))] p-3 text-amber-50">
      <div>
        <div className="font-display text-xl text-amber-100">{props.scene.title}</div>
        <div className="text-xs text-amber-100/80">{props.scene.subtitle}</div>
      </div>

      <BoardGridLayer
        cols={cols}
        rows={rows}
        className="border-amber-200/35 bg-[radial-gradient(circle_at_18%_12%,rgba(252,211,77,0.24),rgba(16,11,8,0.95))]"
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

      <BoardLegend items={props.scene.legend} />

      <div className="grid gap-2 text-[11px] text-amber-100/80 sm:grid-cols-3">
        <div className="rounded border border-amber-200/30 bg-amber-100/5 p-2">
          <div className="mb-1 font-semibold text-amber-100">Vendors</div>
          {details.vendors.length === 0 ? (
            <div>No vendors in current runtime state.</div>
          ) : (
            details.vendors.slice(0, 3).map((vendor) => (
              <div key={vendor.id} className="truncate">{vendor.name}</div>
            ))
          )}
        </div>
        <div className="rounded border border-amber-200/30 bg-amber-100/5 p-2">
          <div className="mb-1 font-semibold text-amber-100">Rumors</div>
          {rumors.length === 0 ? <div>No active rumors.</div> : rumors.map((rumor, index) => (
            <div key={`rumor-${index + 1}`} className="line-clamp-1">{rumor}</div>
          ))}
        </div>
        <div className="rounded border border-amber-200/30 bg-amber-100/5 p-2">
          <div className="mb-1 font-semibold text-amber-100">Factions</div>
          {details.factionsPresent.length === 0 ? (
            <div>No major faction pressure.</div>
          ) : (
            details.factionsPresent.slice(0, 3).map((faction, index) => (
              <div key={`faction-${index + 1}`} className="truncate">{faction}</div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
