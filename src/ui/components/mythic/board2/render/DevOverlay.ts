import * as PIXI from "pixi.js";
import type { RendererDebugState, RenderSnapshot } from "@/ui/components/mythic/board2/render/types";

export class DevOverlay {
  readonly container = new PIXI.Container();
  private hud = new PIXI.Text({
    text: "",
    style: {
      fontFamily: "Menlo, monospace",
      fontSize: 10,
      fill: 0xdff7ff,
    },
  });

  constructor() {
    this.container.eventMode = "none";
    this.hud.position.set(8, 8);
    this.container.addChild(this.hud);
  }

  render(snapshot: RenderSnapshot, debug: RendererDebugState, show: boolean) {
    this.container.visible = show;
    if (!show) return;

    this.container.removeChildren();
    this.container.addChild(this.hud);

    const tile = snapshot.board.tileSize;
    const width = snapshot.board.width * tile;
    const height = snapshot.board.height * tile;

    const grid = new PIXI.Graphics();
    for (let y = 0; y < snapshot.board.height; y += 1) {
      for (let x = 0; x < snapshot.board.width; x += 1) {
        const idx = y * snapshot.board.width + x;
        const tileState = snapshot.tiles[idx];
        if (!tileState) continue;
        grid.rect(x * tile, y * tile, tile, tile);
        grid.stroke({ color: tileState.isBlocked ? 0xff8c9b : 0x8be4ff, width: 0.6, alpha: 0.2 });

        if (x % 2 === 0 && y % 2 === 0) {
          const label = new PIXI.Text(
            `${x},${y}`,
            new PIXI.TextStyle({ fontFamily: "Menlo, monospace", fontSize: 8, fill: 0xc8d8ea }),
          );
          label.alpha = 0.75;
          label.position.set((x * tile) + 2, (y * tile) + 2);
          this.container.addChild(label);
        }
      }
    }
    this.container.addChild(grid);

    const occupied = new Set(snapshot.entities.map((entity) => `${entity.x},${entity.y}`));
    for (const key of occupied) {
      const [xText, yText] = key.split(",");
      const x = Number(xText);
      const y = Number(yText);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const marker = new PIXI.Graphics();
      marker.roundRect((x * tile) + tile - 10, (y * tile) + 2, 8, 8, 2);
      marker.fill({ color: 0xfff3b0, alpha: 0.7 });
      this.container.addChild(marker);
    }

    const queueLines = debug.eventTimeline.slice(-8).map((event) => `${event.sequence.toString().padStart(2, "0")} ${event.type}`);
    this.hud.text = [
      `fps ${debug.fps.toFixed(1)}  draw ${debug.drawCalls}`,
      `queue ${debug.queueDepth}  particles ${debug.activeParticles}  text ${debug.activeFloatingTexts}`,
      `board ${snapshot.board.type} ${snapshot.board.width}x${snapshot.board.height}`,
      ...queueLines,
    ].join("\n");

    const panel = new PIXI.Graphics();
    panel.roundRect(4, 4, 280, 16 + (queueLines.length * 12), 6);
    panel.fill({ color: 0x07121d, alpha: 0.58 });
    this.container.addChildAt(panel, 0);

    const timeline = new PIXI.Graphics();
    const timelineWidth = 220;
    const timelineX = width - timelineWidth - 12;
    const timelineY = 8;
    timeline.roundRect(timelineX, timelineY, timelineWidth, 72, 6);
    timeline.fill({ color: 0x091522, alpha: 0.6 });
    this.container.addChild(timeline);

    const total = Math.max(1, debug.eventTimeline.length);
    debug.eventTimeline.slice(-18).forEach((event, idx) => {
      const y = timelineY + 10 + idx * 3.2;
      const w = Math.max(8, (timelineWidth - 20) * ((idx + 1) / total));
      const line = new PIXI.Graphics();
      line.roundRect(timelineX + 10, y, w, 2, 1);
      line.fill({ color: 0x6dd1ff, alpha: 0.55 });
      this.container.addChild(line);
    });

    const legend = new PIXI.Text({
      text: "event timeline",
      style: { fontFamily: "Menlo, monospace", fontSize: 9, fill: 0xbad8f4 },
    });
    legend.position.set(timelineX + 10, timelineY + 2);
    this.container.addChild(legend);

    const border = new PIXI.Graphics();
    border.roundRect(0, 0, width, height, 8);
    border.stroke({ color: 0x89ccf0, width: 1.2, alpha: 0.3 });
    this.container.addChild(border);
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
