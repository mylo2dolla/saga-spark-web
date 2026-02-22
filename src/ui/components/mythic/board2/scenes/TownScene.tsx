import { BoardGridLayer } from "@/ui/components/mythic/board2/BoardGridLayer";
import { HotspotOverlay } from "@/ui/components/mythic/board2/HotspotOverlay";
import { readGridPointFromEvent } from "@/ui/components/mythic/board2/BoardGridLayer";
import type { NarrativeBoardSceneModel, NarrativeHotspot, TownSceneData } from "@/ui/components/mythic/board2/types";

interface TownSceneProps {
  scene: NarrativeBoardSceneModel;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
}

export function TownScene(props: TownSceneProps) {
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const details = props.scene.details as TownSceneData;
  const buildingHotspots = props.scene.hotspots.filter(
    (hotspot) => hotspot.kind === "vendor" || hotspot.kind === "notice_board" || hotspot.kind === "gate",
  );
  const overlayHotspots = props.scene.hotspots.filter(
    (hotspot) => hotspot.kind !== "vendor" && hotspot.kind !== "notice_board" && hotspot.kind !== "gate" && !hotspot.id.startsWith("town-npc-"),
  );

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
      {buildingHotspots.map((hotspot) => {
        const styleClass = hotspot.kind === "vendor"
          ? "border-amber-100/60 bg-amber-300/18 text-amber-50"
          : hotspot.kind === "notice_board"
            ? "border-yellow-100/55 bg-yellow-300/18 text-yellow-50"
            : "border-orange-100/55 bg-orange-400/20 text-orange-50";
        const shortLabel = hotspot.title.trim().length > 22
          ? `${hotspot.title.trim().slice(0, 22)}...`
          : hotspot.title.trim();
        return (
          <button
            key={`town-building-${hotspot.id}`}
            type="button"
            data-testid={`town-building-${hotspot.id}`}
            className={`absolute z-[2] rounded-md border px-2 py-1 text-left text-[10px] shadow-[0_0_0_1px_rgba(0,0,0,0.22)] ${styleClass}`}
            style={{
              left: `${(hotspot.rect.x / cols) * 100}%`,
              top: `${(hotspot.rect.y / rows) * 100}%`,
              width: `${(hotspot.rect.w / cols) * 100}%`,
              minHeight: "34px",
            }}
            onClick={(event) => {
              event.stopPropagation();
              props.onSelectHotspot(hotspot, readGridPointFromEvent(event, cols, rows));
            }}
          >
            <div className="truncate font-semibold leading-tight">
              {hotspot.visual?.icon ? `${hotspot.visual.icon} ` : ""}{shortLabel}
            </div>
          </button>
        );
      })}
      {details.npcs.map((npc) => {
        const hotspot = props.scene.hotspots.find((entry) => entry.id === `town-npc-${npc.id}`) ?? null;
        const danger = npc.grudge >= 35;
        const shortName = npc.name.trim().length > 11 ? `${npc.name.trim().slice(0, 11)}...` : npc.name.trim();
        return (
          <button
            key={`town-npc-token-${npc.id}`}
            type="button"
            data-testid={`town-npc-token-${npc.id}`}
            className={`absolute z-[3] rounded-md border px-1 py-0.5 text-[9px] text-left shadow-[0_0_0_1px_rgba(0,0,0,0.3)] ${
              danger
                ? "border-rose-200/75 bg-rose-400/25 text-rose-50"
                : "border-sky-200/70 bg-sky-300/20 text-sky-50"
            }`}
            style={{
              left: `${((npc.locationTile.x + 0.05) / cols) * 100}%`,
              top: `${((npc.locationTile.y + 0.12) / rows) * 100}%`,
              minWidth: "52px",
            }}
            onClick={(event) => {
              event.stopPropagation();
              if (!hotspot) return;
              props.onSelectHotspot(hotspot, readGridPointFromEvent(event, cols, rows));
            }}
          >
            <div className="truncate font-semibold leading-tight">{shortName}</div>
          </button>
        );
      })}
      <HotspotOverlay
        hotspots={overlayHotspots}
        cols={cols}
        rows={rows}
        accent="town"
        onSelectHotspot={props.onSelectHotspot}
      />
    </BoardGridLayer>
  );
}
