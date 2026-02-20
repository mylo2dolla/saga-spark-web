import { Button } from "@/components/ui/button";
import { BoardGridLayer, readGridPointFromEvent } from "@/ui/components/mythic/board2/BoardGridLayer";
import { BoardLegend } from "@/ui/components/mythic/board2/BoardLegend";
import type { CombatSceneData, NarrativeBoardSceneModel, NarrativeHotspot } from "@/ui/components/mythic/board2/types";

interface CombatSceneProps {
  scene: NarrativeBoardSceneModel;
  isActing: boolean;
  onSelectHotspot: (hotspot: NarrativeHotspot, point: { x: number; y: number }) => void;
  onSelectMiss: (point: { x: number; y: number }) => void;
  onQuickCast: (skillId: string, targeting: string) => void;
}

function toPercent(value: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (value / total) * 100))}%`;
}

function hpPercent(current: number, max: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((current / max) * 100)));
}

export function CombatScene(props: CombatSceneProps) {
  const details = props.scene.details as CombatSceneData;
  const cols = props.scene.grid.cols;
  const rows = props.scene.grid.rows;
  const quickCast = details.quickCast.slice(0, 6);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 rounded-xl border border-red-200/35 bg-[linear-gradient(165deg,rgba(68,18,20,0.93),rgba(7,8,14,0.98))] p-3 text-red-50">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="font-display text-xl text-red-100">{props.scene.title}</div>
          <div className="text-xs text-red-100/80">{props.scene.subtitle}</div>
        </div>
        <div className="rounded border border-red-200/45 bg-red-100/10 px-2 py-1 text-[11px] uppercase tracking-wide text-red-100/85">
          {details.status}
        </div>
      </div>

      <BoardGridLayer
        cols={cols}
        rows={rows}
        blockedTiles={props.scene.grid.blockedTiles}
        className="border-red-200/35 bg-[radial-gradient(circle_at_50%_14%,rgba(248,113,113,0.2),rgba(8,8,16,0.95))]"
        gridLineColor="rgba(254,205,211,0.12)"
        blockedTileClassName="border border-amber-200/35 bg-amber-400/20"
        onSelectMiss={props.onSelectMiss}
      >
        {details.combatants.map((combatant) => {
          const x = Math.max(0, Math.min(cols - 1, Math.floor(combatant.x)));
          const y = Math.max(0, Math.min(rows - 1, Math.floor(combatant.y)));
          const hp = hpPercent(combatant.hp, combatant.hp_max);
          const focused = details.focusedCombatantId === combatant.id;
          const active = details.activeTurnCombatantId === combatant.id;
          const tone = combatant.entity_type === "player" ? "bg-emerald-300/50 border-emerald-200/70" : "bg-red-300/45 border-red-200/70";
          const hotspot = props.scene.hotspots.find((entry) => entry.id === `combatant-${combatant.id}`);

          return (
            <button
              key={combatant.id}
              type="button"
              className={`absolute rounded-md border px-1 py-1 text-left text-[10px] text-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)] ${tone} ${focused ? "ring-2 ring-amber-300" : ""} ${active ? "ring-2 ring-white/80" : ""}`}
              style={{
                left: toPercent(x, cols),
                top: toPercent(y, rows),
                width: toPercent(1, cols),
                minHeight: "30px",
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (!hotspot) return;
                props.onSelectHotspot(hotspot, readGridPointFromEvent(event, cols, rows));
              }}
            >
              <div className="truncate font-semibold">{combatant.name}</div>
              <div className="mt-1 h-1.5 w-full rounded bg-black/35">
                <div className="h-full rounded bg-emerald-300" style={{ width: `${hp}%` }} />
              </div>
            </button>
          );
        })}
      </BoardGridLayer>

      <BoardLegend items={props.scene.legend} />

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-red-200/30 bg-red-100/5 p-2 text-[11px] text-red-100/80">
          <div className="mb-1 font-semibold text-red-100">Quick Cast</div>
          {quickCast.length === 0 ? (
            <div>No combat skills available.</div>
          ) : (
            <div className="space-y-1">
              {quickCast.map((entry) => (
                <Button
                  key={`quick-cast-${entry.skillId}`}
                  size="sm"
                  variant={entry.usableNow ? "default" : "secondary"}
                  disabled={!entry.usableNow || props.isActing}
                  className="h-7 w-full justify-between"
                  onClick={() => props.onQuickCast(entry.skillId, entry.targeting)}
                >
                  <span className="truncate">{entry.name}</span>
                  <span className="ml-2 text-[10px] uppercase tracking-wide">{entry.usableNow ? "Cast" : (entry.reason ?? "Locked")}</span>
                </Button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded border border-red-200/30 bg-red-100/5 p-2 text-[11px] text-red-100/80">
          <div className="mb-1 font-semibold text-red-100">Recent Events</div>
          {details.recentEvents.length === 0 ? (
            <div>No combat events yet.</div>
          ) : (
            details.recentEvents.slice(-5).map((event) => (
              <div key={event.id} className="truncate">
                {event.event_type.replace(/_/g, " ")} · t{event.turn_index}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
