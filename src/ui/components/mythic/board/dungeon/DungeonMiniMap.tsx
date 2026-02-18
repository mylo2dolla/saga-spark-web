import { useMemo } from "react";
import { PixelBoardCanvas } from "@/ui/components/mythic/board/pixel/PixelBoardCanvas";
import { pixelPalette } from "@/ui/components/mythic/board/pixel/pixelPalette";
import { drawOutlineRect, drawPixelRect } from "@/ui/components/mythic/board/pixel/pixelSprites";
import type { DungeonLayout } from "@/ui/components/mythic/board/dungeon/dungeonLayout";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

type RoomPixel = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
};

export function DungeonMiniMap(props: {
  layout: DungeonLayout;
  revealed: Set<string>;
  activeRoomId: string | null;
  onSelectRoom: (roomId: string) => void;
}) {
  const roomPixels = useMemo<RoomPixel[]>(() => {
    const canvasW = 64;
    const canvasH = 48;
    const pad = 4;
    const bounds = props.layout.bounds;
    const spanX = Math.max(1, bounds.maxX - bounds.minX + 1);
    const spanY = Math.max(1, bounds.maxY - bounds.minY + 1);
    const cellX = Math.floor((canvasW - pad * 2) / spanX);
    const cellY = Math.floor((canvasH - pad * 2) / spanY);
    const cell = clamp(Math.min(cellX, cellY), 5, 9);
    const w = clamp(cell - 2, 3, 7);
    const h = clamp(cell - 3, 3, 6);

    return props.layout.rooms.map((room) => {
      const pos = props.layout.positions[room.id] ?? { gx: 0, gy: 0 };
      const cx = pad + (pos.gx - bounds.minX) * cell + Math.floor(cell / 2);
      const cy = pad + (pos.gy - bounds.minY) * cell + Math.floor(cell / 2);
      return {
        id: room.id,
        cx,
        cy,
        x: cx - Math.floor(w / 2),
        y: cy - Math.floor(h / 2),
        w,
        h,
      };
    });
  }, [props.layout]);

  const revealedIsEmpty = props.revealed.size === 0;

  return (
    <div className="absolute right-3 top-3 w-[180px] rounded-lg border border-violet-200/25 bg-black/40 p-2 backdrop-blur-sm">
      <div className="mb-1 flex items-center justify-between text-[10px] text-violet-100/80">
        <div className="font-semibold">Minimap</div>
        <div className="text-violet-100/60">{roomPixels.length} rooms</div>
      </div>

      <div className="relative h-[120px] overflow-hidden rounded border border-violet-200/25 bg-black/30">
        <PixelBoardCanvas
          width={64}
          height={48}
          className="cursor-pointer"
          onDraw={(ctx, frame) => {
            // Background.
            for (let y = 0; y < frame.height; y += 2) {
              for (let x = 0; x < frame.width; x += 2) {
                const checker = (x + y) % 4 === 0;
                drawPixelRect(ctx, x, y, 2, 2, checker ? pixelPalette.stoneA : pixelPalette.stoneB);
              }
            }

            // Corridors (drawn behind rooms).
            for (const edge of props.layout.edges) {
              const a = roomPixels.find((r) => r.id === edge.from);
              const b = roomPixels.find((r) => r.id === edge.to);
              if (!a || !b) continue;
              const dx = b.cx - a.cx;
              const dy = b.cy - a.cy;
              const steps = Math.max(1, Math.max(Math.abs(dx), Math.abs(dy)));
              for (let s = 0; s <= steps; s += 1) {
                const t = s / steps;
                const x = Math.floor(a.cx + dx * t);
                const y = Math.floor(a.cy + dy * t);
                drawPixelRect(ctx, x, y, 1, 1, "rgba(176,135,255,0.38)");
              }
            }

            for (const room of roomPixels) {
              const isRevealed = revealedIsEmpty || props.revealed.has(room.id);
              const isActive = props.activeRoomId === room.id;
              const pulse = 0.35 + 0.25 * (1 + Math.sin(frame.t * 3 + room.cx * 0.1));

              drawOutlineRect(
                ctx,
                room.x,
                room.y,
                room.w,
                room.h,
                isRevealed ? `rgba(176,135,255,${0.15 + pulse * 0.12})` : "rgba(12,12,18,0.75)",
                isActive ? `rgba(242,197,107,${0.75 + pulse * 0.25})` : isRevealed ? "rgba(176,135,255,0.65)" : "rgba(111,116,132,0.35)",
              );

              if (!isRevealed) {
                drawPixelRect(ctx, room.x, room.y, room.w, room.h, "rgba(8,8,14,0.6)");
              }
            }
          }}
          onClickPixel={(x, y) => {
            const hit = roomPixels.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) ?? null;
            if (!hit) return;
            props.onSelectRoom(hit.id);
          }}
        />
      </div>
    </div>
  );
}

