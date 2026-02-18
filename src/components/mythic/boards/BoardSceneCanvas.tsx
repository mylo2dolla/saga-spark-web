import { useEffect, useMemo, useState } from "react";
import { Container, Graphics } from "@pixi/react";
import type { Graphics as PixiGraphics } from "pixi.js";
import { MythicStage } from "@/rendering/mythic/MythicStage";
import { TileLayer } from "@/rendering/mythic/TileLayer";
import { EntityLayer } from "@/rendering/mythic/EntityLayer";
import { FxLayer } from "@/rendering/mythic/FxLayer";
import { UiOverlayLayer } from "@/rendering/mythic/UiOverlayLayer";
import { mythicSpriteAtlasRegistry } from "@/rendering/mythic/SpriteAtlasRegistry";
import type { MythicBoardStateV2 } from "@/types/mythicBoard";

interface BoardSceneCanvasProps {
  boardState: MythicBoardStateV2;
  player: { x: number; y: number };
  showFog?: boolean;
  className?: string;
}

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 180;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function BoardSceneCanvas({ boardState, player, showFog = false, className }: BoardSceneCanvasProps) {
  const [atlasReady, setAtlasReady] = useState(false);
  const tile = boardState.grid.tile_size;
  const worldWidth = boardState.grid.width * tile;
  const worldHeight = boardState.grid.height * tile;
  const atlasId = boardState.chunk.board_type === "town"
    ? "town"
    : boardState.chunk.board_type === "travel"
      ? "travel"
      : "dungeon";

  useEffect(() => {
    let cancelled = false;
    setAtlasReady(false);
    void mythicSpriteAtlasRegistry
      .ensureLoaded(atlasId)
      .then(() => {
        if (!cancelled) setAtlasReady(true);
      })
      .catch(() => {
        if (!cancelled) setAtlasReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [atlasId]);

  const camera = useMemo(() => {
    const px = player.x * tile + tile * 0.5;
    const py = player.y * tile + tile * 0.5;
    const minX = Math.min(0, VIEW_WIDTH - worldWidth);
    const minY = Math.min(0, VIEW_HEIGHT - worldHeight);

    const x = clamp(Math.round(VIEW_WIDTH * 0.5 - px), minX, 0);
    const y = clamp(Math.round(VIEW_HEIGHT * 0.5 - py), minY, 0);
    return { x, y };
  }, [player.x, player.y, tile, worldHeight, worldWidth]);

  const drawBackdrop = (graphics: PixiGraphics) => {
    graphics.clear();
    graphics.beginFill(0x0f1117, 1);
    graphics.drawRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
    graphics.endFill();
  };

  return (
    <MythicStage width={VIEW_WIDTH} height={VIEW_HEIGHT} className={className}>
      <Graphics draw={drawBackdrop} />
      <Container x={camera.x} y={camera.y}>
        <TileLayer boardState={boardState} atlasId={atlasId} />
        <EntityLayer boardState={boardState} player={player} atlasId={atlasId} />
        <FxLayer boardState={boardState} showFog={showFog} player={player} />
      </Container>
      {!atlasReady ? (
        <Graphics
          draw={(graphics) => {
            graphics.clear();
            graphics.beginFill(0x0a0a0a, 0.55);
            graphics.drawRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
            graphics.endFill();
          }}
        />
      ) : null}
      <UiOverlayLayer boardState={boardState} />
    </MythicStage>
  );
}
