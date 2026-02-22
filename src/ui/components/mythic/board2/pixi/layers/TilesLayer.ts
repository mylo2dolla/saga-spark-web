import * as PIXI from "pixi.js";
import type { RenderSnapshot } from "@/ui/components/mythic/board2/pixi/renderTypes";
import { biomeSkinFor } from "@/ui/components/mythic/board2/pixi/skins/biomeSkins";

export function drawTilesLayer(snapshot: RenderSnapshot): PIXI.Container {
  const layer = new PIXI.Container();
  layer.eventMode = "none";

  const skin = biomeSkinFor(snapshot.board.biomeId);
  const tileSize = snapshot.board.tileSize;

  const background = new PIXI.Graphics();
  background.beginFill(skin.base, 1);
  background.drawRect(0, 0, snapshot.board.width * tileSize, snapshot.board.height * tileSize);
  background.endFill();
  layer.addChild(background);

  for (const tile of snapshot.tiles) {
    const x = tile.x * tileSize;
    const y = tile.y * tileSize;
    const tileGraphic = new PIXI.Graphics();
    const baseColor = (tile.x + tile.y) % 2 === 0 ? skin.base : skin.alt;
    tileGraphic.beginFill(baseColor, 0.94);
    tileGraphic.drawRect(x, y, tileSize, tileSize);
    tileGraphic.endFill();

    if (tile.road) {
      tileGraphic.beginFill(skin.road, 0.24);
      tileGraphic.drawRect(x + tileSize * 0.14, y + tileSize * 0.34, tileSize * 0.72, tileSize * 0.32);
      tileGraphic.endFill();
    }
    if (tile.water) {
      tileGraphic.beginFill(skin.water, 0.3);
      tileGraphic.drawRect(x + tileSize * 0.06, y + tileSize * 0.06, tileSize * 0.88, tileSize * 0.88);
      tileGraphic.endFill();
    }
    if (tile.hazard) {
      tileGraphic.beginFill(skin.hazard, 0.2);
      tileGraphic.drawRect(x + tileSize * 0.08, y + tileSize * 0.08, tileSize * 0.84, tileSize * 0.84);
      tileGraphic.endFill();
    }
    if (tile.fog) {
      tileGraphic.beginFill(skin.fog, 0.16);
      tileGraphic.drawRect(x, y, tileSize, tileSize);
      tileGraphic.endFill();
    }
    if (tile.blocked) {
      tileGraphic.lineStyle(2, skin.blocked, 0.68);
      tileGraphic.moveTo(x + 5, y + 5);
      tileGraphic.lineTo(x + tileSize - 5, y + tileSize - 5);
      tileGraphic.moveTo(x + tileSize - 5, y + 5);
      tileGraphic.lineTo(x + 5, y + tileSize - 5);
    }

    tileGraphic.lineStyle(1, skin.grid, 0.22);
    tileGraphic.drawRect(x, y, tileSize, tileSize);
    layer.addChild(tileGraphic);
  }

  return layer;
}
