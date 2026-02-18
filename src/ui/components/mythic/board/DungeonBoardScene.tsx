import { useEffect, useMemo, useState } from "react";
import type { BoardInspectTarget } from "@/ui/components/mythic/board/inspectTypes";
import { DungeonMiniMap } from "@/ui/components/mythic/board/dungeon/DungeonMiniMap";
import { DungeonRoomScene } from "@/ui/components/mythic/board/dungeon/DungeonRoomScene";
import { computeDungeonLayout, neighborDirections, type DungeonEdgeLite, type DungeonRoomLite } from "@/ui/components/mythic/board/dungeon/dungeonLayout";

interface DungeonBoardSceneProps {
  boardState: Record<string, unknown>;
  scene: Record<string, unknown> | null;
  onInspect: (target: BoardInspectTarget) => void;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function extractRoomGraph(state: Record<string, unknown>): { rooms: DungeonRoomLite[]; edges: DungeonEdgeLite[] } {
  const graph = state.room_graph && typeof state.room_graph === "object" ? (state.room_graph as Record<string, unknown>) : null;
  const roomsRaw = Array.isArray(graph?.rooms) ? graph?.rooms : [];
  const edgesRaw = Array.isArray(graph?.edges) ? graph?.edges : [];

  const rooms: DungeonRoomLite[] = roomsRaw
    .map((entry, idx) => {
      const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const id = asString(raw.id, `room_${idx + 1}`);
      const name = asString(raw.name, `Room ${idx + 1}`);
      const tags = Array.isArray(raw.tags)
        ? raw.tags.map((t) => String(t)).filter((t) => t.trim().length > 0).slice(0, 6)
        : [];
      const danger = Number.isFinite(Number(raw.danger)) ? Number(raw.danger) : undefined;
      return { id, name, tags, danger };
    })
    .filter((room) => room.id.length > 0);

  const edges: DungeonEdgeLite[] = edgesRaw
    .map((entry) => {
      const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const from = asString(raw.from, "");
      const to = asString(raw.to, "");
      if (!from || !to) return null;
      return { from, to };
    })
    .filter((edge): edge is DungeonEdgeLite => Boolean(edge));

  return { rooms, edges };
}

export function DungeonBoardScene(props: DungeonBoardSceneProps) {
  const seed = useMemo(() => Math.floor(asNumber(props.boardState.seed, 9191)), [props.boardState.seed]);
  const title = typeof props.scene?.title === "string" ? props.scene.title : "Dungeon Depths";
  const mood = typeof props.scene?.mood === "string" ? props.scene.mood : "Cold stone, shifting fog, and old blood signatures.";

  const graph = useMemo(() => extractRoomGraph(props.boardState), [props.boardState]);
  const layout = useMemo(() => computeDungeonLayout({ rooms: graph.rooms, edges: graph.edges, seed }), [graph.edges, graph.rooms, seed]);

  const revealed = useMemo(() => {
    const fog = props.boardState.fog_of_war && typeof props.boardState.fog_of_war === "object"
      ? (props.boardState.fog_of_war as Record<string, unknown>)
      : null;
    const list = Array.isArray(fog?.revealed) ? fog?.revealed : [];
    return new Set(list.filter((entry): entry is string => typeof entry === "string"));
  }, [props.boardState.fog_of_war]);

  const [activeRoomId, setActiveRoomId] = useState<string | null>(layout.rooms[0]?.id ?? null);

  useEffect(() => {
    const first = layout.rooms[0]?.id ?? null;
    setActiveRoomId((prev) => {
      if (!first) return null;
      if (prev && layout.positions[prev]) return prev;
      return first;
    });
  }, [layout.positions, layout.rooms]);

  const activeRoom = useMemo(() => {
    if (!activeRoomId) return null;
    return layout.rooms.find((room) => room.id === activeRoomId) ?? null;
  }, [activeRoomId, layout.rooms]);

  const neighborDoors = useMemo(() => {
    if (!activeRoomId) return [];
    const dirs = neighborDirections(layout, activeRoomId);
    return dirs
      .map((entry) => {
        const room = layout.rooms.find((r) => r.id === entry.toRoomId) ?? null;
        if (!room) return null;
        return { toRoomId: entry.toRoomId, toRoomName: room.name, dir: entry.dir };
      })
      .filter((entry): entry is { toRoomId: string; toRoomName: string; dir: "n" | "s" | "e" | "w" } => Boolean(entry));
  }, [activeRoomId, layout]);

  const trapSignals = Math.max(0, Math.floor(asNumber(props.boardState.trap_signals, 0)));
  const lootNodes = Math.max(0, Math.floor(asNumber(props.boardState.loot_nodes, 0)));
  const factionPresence = Array.isArray(props.boardState.faction_presence) ? props.boardState.faction_presence : [];

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-xl border border-violet-200/20 bg-[linear-gradient(180deg,rgba(16,12,22,0.95),rgba(8,8,14,0.98))] p-3">
      <div className="mb-2">
        <div className="font-display text-xl text-violet-100">{title}</div>
        <div className="text-xs text-violet-100/75">{mood}</div>
      </div>

      {activeRoom ? (
        <div className="relative">
          <DungeonRoomScene
            room={activeRoom}
            neighbors={neighborDoors}
            seed={seed}
            revealed={revealed}
            scene={props.scene}
            onInspect={props.onInspect}
          />

          <DungeonMiniMap
            layout={layout}
            revealed={revealed}
            activeRoomId={activeRoomId}
            onSelectRoom={(roomId) => setActiveRoomId(roomId)}
          />
        </div>
      ) : (
        <div className="flex h-[360px] items-center justify-center rounded-lg border border-violet-200/25 bg-black/35 text-sm text-violet-100/70">
          Dungeon state is missing rooms.
        </div>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-violet-100/75 sm:grid-cols-4">
        <div className="rounded border border-violet-200/25 bg-violet-100/10 px-2 py-1">Rooms: {layout.rooms.length}</div>
        <div className="rounded border border-violet-200/25 bg-violet-100/10 px-2 py-1">Trap Signals: {trapSignals}</div>
        <div className="rounded border border-violet-200/25 bg-violet-100/10 px-2 py-1">Loot Nodes: {lootNodes}</div>
        <div className="rounded border border-violet-200/25 bg-violet-100/10 px-2 py-1">
          Factions: {Array.isArray(factionPresence) ? factionPresence.length : 0}
        </div>
      </div>
    </div>
  );
}

