import * as PIXI from "pixi.js";
import type { RenderSnapshot } from "@/ui/components/mythic/board2/render/types";

function entityCenter(snapshot: RenderSnapshot, id: string | undefined): { x: number; y: number } | null {
  if (!id) return null;
  const entity = snapshot.entities.find((entry) => entry.id === id);
  if (!entity) return null;
  const tile = snapshot.board.tileSize;
  return {
    x: (entity.x * tile) + (tile / 2),
    y: (entity.y * tile) + (tile / 2),
  };
}

function styleColor(style: "imminent" | "queued" | "preview"): { line: number; fill: number; alpha: number } {
  if (style === "imminent") return { line: 0xff8ea1, fill: 0xff718d, alpha: 0.26 };
  if (style === "queued") return { line: 0xffd789, fill: 0xffd389, alpha: 0.22 };
  return { line: 0x8fd9ff, fill: 0x8bcdf4, alpha: 0.18 };
}

export class TelegraphRenderer {
  readonly container = new PIXI.Container();

  constructor() {
    this.container.eventMode = "none";
  }

  render(snapshot: RenderSnapshot) {
    this.container.removeChildren();
    const tile = snapshot.board.tileSize;

    for (const telegraph of snapshot.telegraphs) {
      const style = styleColor(telegraph.style);
      if (telegraph.kind === "line") {
        const source = entityCenter(snapshot, telegraph.sourceEntityId);
        const target = telegraph.targetTile
          ? { x: (telegraph.targetTile.x * tile) + (tile / 2), y: (telegraph.targetTile.y * tile) + (tile / 2) }
          : entityCenter(snapshot, telegraph.targetEntityId);
        if (!source || !target) continue;

        const line = new PIXI.Graphics();
        line.moveTo(source.x, source.y);
        line.lineTo(target.x, target.y);
        line.stroke({ color: style.line, width: 2, alpha: 0.8 });
        this.container.addChild(line);

        const tip = new PIXI.Graphics();
        tip.circle(target.x, target.y, 3.5);
        tip.fill({ color: style.line, alpha: 0.9 });
        this.container.addChild(tip);
        continue;
      }

      const cells = telegraph.tiles ?? (telegraph.targetTile ? [telegraph.targetTile] : []);
      for (const cell of cells) {
        const shape = new PIXI.Graphics();
        shape.roundRect((cell.x * tile) + 3, (cell.y * tile) + 3, tile - 6, tile - 6, 7);
        shape.fill({ color: style.fill, alpha: style.alpha });
        shape.stroke({ color: style.line, width: 1.5, alpha: 0.84 });
        this.container.addChild(shape);
      }
    }
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
