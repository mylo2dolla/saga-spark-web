import * as PIXI from "pixi.js";
import type { RenderSnapshot } from "@/ui/components/mythic/board2/pixi/renderTypes";

function markerColor(type: string): number {
  if (type === "danger") return 0xfb7185;
  if (type === "quest" || type === "hook") return 0xfde68a;
  if (type === "merchant") return 0x86efac;
  if (type === "healer") return 0x67e8f9;
  if (type === "travel" || type === "gate") return 0xc4b5fd;
  if (type === "notice") return 0xfacc15;
  return 0xe2e8f0;
}

export function drawUiOverlayLayer(snapshot: RenderSnapshot): PIXI.Container {
  const layer = new PIXI.Container();
  layer.eventMode = "none";

  const tileSize = snapshot.board.tileSize;
  const markers = [...snapshot.overlays]
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 20);

  for (const marker of markers) {
    const x = marker.x * tileSize;
    const y = marker.y * tileSize;

    const badge = new PIXI.Graphics();
    badge.beginFill(markerColor(marker.type), 0.86);
    badge.drawRoundedRect(x + tileSize - 16, y + 2, 14, 14, 4);
    badge.endFill();
    layer.addChild(badge);

    const letter = new PIXI.Text({
      text: marker.label.slice(0, 1).toUpperCase(),
      style: {
        fontSize: 8,
        fill: 0x111827,
        fontWeight: "bold",
        fontFamily: "Verdana, sans-serif",
      },
    });
    letter.x = x + tileSize - 12;
    letter.y = y + 5;
    layer.addChild(letter);
  }

  return layer;
}
