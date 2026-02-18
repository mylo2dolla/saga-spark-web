import { useMemo } from "react";
import { Text } from "@pixi/react";
import { TextStyle } from "pixi.js";
import type { MythicBoardStateV2 } from "@/types/mythicBoard";

interface UiOverlayLayerProps {
  boardState: MythicBoardStateV2;
}

export function UiOverlayLayer({ boardState }: UiOverlayLayerProps) {
  const style = useMemo(
    () =>
      new TextStyle({
        fill: 0xf4f2da,
        fontFamily: "monospace",
        fontSize: 9,
        align: "left",
      }),
    [],
  );
  const helperStyle = useMemo(
    () =>
      new TextStyle({
        fill: 0xc8d6cc,
        fontFamily: "monospace",
        fontSize: 9,
        align: "left",
      }),
    [],
  );

  const controlText = "WASD move · E interact · edge = page turn";

  return (
    <>
      <Text
        x={6}
        y={4}
        text={`BIOME ${boardState.chunk.biome.toUpperCase()}  CHUNK ${boardState.chunk.coord_x},${boardState.chunk.coord_y}`}
        style={style}
      />
      <Text
        x={6}
        y={16}
        text={controlText}
        style={helperStyle}
      />
    </>
  );
}
