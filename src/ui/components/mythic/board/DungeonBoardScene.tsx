import { useMemo } from "react";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import { PixelBoardCanvas } from "@/ui/components/mythic/board/pixel/PixelBoardCanvas";
import { pixelPalette } from "@/ui/components/mythic/board/pixel/pixelPalette";
import { drawChest, drawOutlineRect, drawPixelRect, drawTrap } from "@/ui/components/mythic/board/pixel/pixelSprites";

interface DungeonBoardSceneProps {
  boardState: Record<string, unknown>;
  scene: Record<string, unknown> | null;
  onAction: (action: MythicUiAction) => void;
}

interface RoomNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

function hashNumber(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function extractRooms(boardState: Record<string, unknown>): RoomNode[] {
  const roomGraph = boardState.room_graph && typeof boardState.room_graph === "object"
    ? (boardState.room_graph as Record<string, unknown>)
    : null;
  const roomsRaw = Array.isArray(roomGraph?.rooms) ? roomGraph.rooms : [];
  return roomsRaw.slice(0, 10).map((entry, idx) => {
    const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const id = typeof raw.id === "string" ? raw.id : `room-${idx + 1}`;
    const name = typeof raw.name === "string" ? raw.name : `Room ${idx + 1}`;
    const hash = hashNumber(`${id}:${idx}`);
    return {
      id,
      name,
      x: 10 + (hash % 76),
      y: 9 + (Math.floor(hash / 97) % 52),
    };
  });
}

export function DungeonBoardScene(props: DungeonBoardSceneProps) {
  const rooms = extractRooms(props.boardState);
  const title = typeof props.scene?.title === "string" ? props.scene.title : "Dungeon Depths";
  const mood = typeof props.scene?.mood === "string" ? props.scene.mood : "Cold stone, shifting fog, and old blood signatures.";
  const trapSignals = Math.max(0, Number(props.boardState.trap_signals ?? 0));
  const lootNodes = Math.max(0, Number(props.boardState.loot_nodes ?? 0));
  const revealed = useMemo(() => {
    const fog = props.boardState.fog_of_war && typeof props.boardState.fog_of_war === "object"
      ? (props.boardState.fog_of_war as Record<string, unknown>)
      : null;
    const list = Array.isArray(fog?.revealed) ? fog.revealed : [];
    return new Set(list.filter((entry): entry is string => typeof entry === "string"));
  }, [props.boardState]);

  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-xl border border-violet-200/20 bg-[linear-gradient(180deg,rgba(16,12,22,0.95),rgba(8,8,14,0.98))] p-3">
      <div className="mb-2">
        <div className="font-display text-xl text-violet-100">{title}</div>
        <div className="text-xs text-violet-100/75">{mood}</div>
      </div>

      <div className="relative h-[360px] overflow-hidden rounded-lg border border-violet-200/25 bg-black/35">
        <PixelBoardCanvas
          width={96}
          height={72}
          className="cursor-pointer"
          onDraw={(ctx, frame) => {
            for (let y = 0; y < frame.height; y += 2) {
              for (let x = 0; x < frame.width; x += 2) {
                const checker = ((x + y) % 4) === 0;
                drawPixelRect(ctx, x, y, 2, 2, checker ? pixelPalette.stoneA : pixelPalette.stoneB);
              }
            }

            for (let i = 0; i < rooms.length - 1; i += 1) {
              const a = rooms[i]!;
              const b = rooms[i + 1]!;
              const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
              for (let s = 0; s <= steps; s += 1) {
                const t = steps === 0 ? 0 : s / steps;
                const x = Math.floor(a.x + (b.x - a.x) * t);
                const y = Math.floor(a.y + (b.y - a.y) * t);
                drawPixelRect(ctx, x, y, 1, 1, "rgba(176,135,255,0.45)");
              }
            }

            for (let i = 0; i < rooms.length; i += 1) {
              const room = rooms[i]!;
              const isRevealed = revealed.size === 0 || revealed.has(room.id);
              drawOutlineRect(
                ctx,
                room.x - 3,
                room.y - 3,
                8,
                8,
                isRevealed ? "rgba(176,135,255,0.25)" : "rgba(31,35,48,0.65)",
                isRevealed ? "rgba(176,135,255,0.7)" : "rgba(111,116,132,0.45)",
              );

              if (!isRevealed) {
                drawPixelRect(ctx, room.x - 3, room.y - 3, 8, 8, "rgba(8,8,14,0.65)");
              }
            }

            for (let i = 0; i < trapSignals; i += 1) {
              const room = rooms[i % Math.max(1, rooms.length)];
              if (!room) break;
              drawTrap(ctx, room.x - 4, room.y - 12, Math.sin(frame.t * 4 + i));
            }

            for (let i = 0; i < lootNodes; i += 1) {
              const room = rooms[(rooms.length - 1 - i + rooms.length) % Math.max(1, rooms.length)];
              if (!room) break;
              drawChest(ctx, room.x - 4, room.y + 4, Math.sin(frame.t * 6 + i));
            }

            const fogPulse = 0.18 + 0.12 * (1 + Math.sin(frame.t * 1.8));
            drawPixelRect(ctx, 0, 0, frame.width, frame.height, `rgba(178,154,232,${fogPulse})`);
          }}
          onClickPixel={(x, y) => {
            const room = rooms.find((entry) => x >= entry.x - 4 && x <= entry.x + 4 && y >= entry.y - 4 && y <= entry.y + 4);
            if (room) {
              props.onAction({
                id: `dungeon-room-${room.id}`,
                label: `Probe ${room.name}`,
                intent: "dm_prompt",
                prompt: `I investigate ${room.name} and secure tactical control before proceeding.`,
                payload: { room_id: room.id },
              });
              return;
            }
            if (x <= 12 && y >= 56) {
              props.onAction({ id: "dungeon-town", label: "Fall Back", intent: "town", boardTarget: "town" });
              return;
            }
            props.onAction({
              id: "dungeon-traps",
              label: "Scan Traps",
              intent: "dm_prompt",
              prompt: "I scan the current lane for trap signatures and safe traversal vectors.",
              payload: { tile_x: x, tile_y: y },
            });
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(176,135,255,0.16),transparent_45%),radial-gradient(circle_at_20%_80%,rgba(106,200,232,0.09),transparent_40%)]" />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-violet-100/75 sm:grid-cols-4">
        <div className="rounded border border-violet-200/25 bg-violet-100/10 px-2 py-1">Rooms: {rooms.length}</div>
        <div className="rounded border border-violet-200/25 bg-violet-100/10 px-2 py-1">Trap Signals: {trapSignals}</div>
        <div className="rounded border border-violet-200/25 bg-violet-100/10 px-2 py-1">Loot Nodes: {lootNodes}</div>
        <div className="rounded border border-violet-200/25 bg-violet-100/10 px-2 py-1">Revealed: {revealed.size || rooms.length}</div>
      </div>
    </div>
  );
}

