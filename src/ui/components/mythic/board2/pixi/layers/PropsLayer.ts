import * as PIXI from "pixi.js";
import type { RenderSnapshot } from "@/ui/components/mythic/board2/pixi/renderTypes";

export function drawPropsLayer(snapshot: RenderSnapshot): PIXI.Container {
  const layer = new PIXI.Container();
  layer.eventMode = "none";

  const tileSize = snapshot.board.tileSize;

  for (const entity of snapshot.entities) {
    if (entity.type !== "building" && entity.type !== "prop") continue;
    const x = entity.x * tileSize;
    const y = entity.y * tileSize;

    const g = new PIXI.Graphics();
    const fill = entity.type === "building" ? 0x9a7b3b : 0x4b5a52;
    const border = entity.type === "building" ? 0xf7d17c : 0xb2c7bf;

    g.beginFill(fill, entity.type === "building" ? 0.3 : 0.24);
    g.lineStyle(2, border, 0.62);
    g.drawRoundedRect(x + 2, y + 2, tileSize - 4, tileSize - 4, 6);
    g.endFill();
    layer.addChild(g);

    const label = new PIXI.Text({
      text: entity.label,
      style: {
        fontSize: 10,
        fill: 0xf9f6ee,
        fontFamily: "Georgia, serif",
      },
    });
    label.x = x + 4;
    label.y = y + 4;
    label.alpha = 0.92;
    layer.addChild(label);
  }

  return layer;
}
