import { useCallback } from "react";
import { Graphics } from "@pixi/react";
import type { Graphics as PixiGraphics } from "pixi.js";
import type { MythicBoardStateV2 } from "@/types/mythicBoard";

interface FxLayerProps {
  boardState: MythicBoardStateV2;
  transitionProgress?: number;
  showFog?: boolean;
  player?: { x: number; y: number };
}

export function FxLayer({ boardState, transitionProgress = 0, showFog = false, player }: FxLayerProps) {
  const draw = useCallback(
    (graphics: PixiGraphics) => {
      graphics.clear();
      const widthPx = boardState.grid.width * boardState.grid.tile_size;
      const heightPx = boardState.grid.height * boardState.grid.tile_size;

      if (showFog && player) {
        graphics.beginFill(0x0f1216, 0.55);
        graphics.drawRect(0, 0, widthPx, heightPx);
        graphics.endFill();

        const revealRadius = boardState.grid.tile_size * 3;
        graphics.beginHole();
        graphics.drawCircle(
          player.x * boardState.grid.tile_size + boardState.grid.tile_size * 0.5,
          player.y * boardState.grid.tile_size + boardState.grid.tile_size * 0.5,
          revealRadius,
        );
        graphics.endHole();
      }

      if (transitionProgress > 0) {
        const alpha = Math.max(0, Math.min(0.85, transitionProgress));
        graphics.beginFill(0x0c0b10, alpha);
        graphics.drawRect(0, 0, widthPx, heightPx);
        graphics.endFill();
      }
    },
    [boardState, player, showFog, transitionProgress],
  );

  return <Graphics draw={draw} />;
}
