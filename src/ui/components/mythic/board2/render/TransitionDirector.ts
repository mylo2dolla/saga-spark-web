import * as PIXI from "pixi.js";
import type { RenderBoardType, RendererSettings } from "@/ui/components/mythic/board2/render/types";

interface ActiveTransition {
  from: RenderBoardType;
  to: RenderBoardType;
  elapsedMs: number;
  durationMs: number;
  style: "map_swipe" | "combat_flash" | "fog_dissolve" | "fade";
}

function transitionStyle(from: RenderBoardType, to: RenderBoardType): ActiveTransition["style"] {
  if (from === "town" && to === "travel") return "map_swipe";
  if (from === "travel" && to === "combat") return "combat_flash";
  if (from === "dungeon" && to === "town") return "fog_dissolve";
  return "fade";
}

export class TransitionDirector {
  private current: ActiveTransition | null = null;

  start(from: RenderBoardType, to: RenderBoardType, settings: RendererSettings) {
    if (settings.fastMode) {
      this.current = null;
      return;
    }
    this.current = {
      from,
      to,
      elapsedMs: 0,
      durationMs: 520,
      style: transitionStyle(from, to),
    };
  }

  update(deltaMs: number) {
    if (!this.current) return;
    this.current.elapsedMs += Math.max(0, deltaMs);
    if (this.current.elapsedMs >= this.current.durationMs) {
      this.current = null;
    }
  }

  drawOverlay(graphics: PIXI.Graphics, width: number, height: number) {
    if (!this.current) {
      graphics.clear();
      return;
    }

    const progress = Math.max(0, Math.min(1, this.current.elapsedMs / this.current.durationMs));
    graphics.clear();

    if (this.current.style === "map_swipe") {
      const x = Math.floor((1 - progress) * width);
      graphics.rect(x, 0, width, height).fill({ color: 0x22150d, alpha: 0.45 * (1 - progress) });
      return;
    }

    if (this.current.style === "combat_flash") {
      const alpha = progress < 0.25 ? (0.75 * (1 - (progress / 0.25))) : (0.2 * (1 - progress));
      graphics.rect(0, 0, width, height).fill({ color: 0xfff3d0, alpha });
      return;
    }

    if (this.current.style === "fog_dissolve") {
      graphics.rect(0, 0, width, height).fill({ color: 0xcad7e8, alpha: 0.36 * (1 - progress) });
      return;
    }

    graphics.rect(0, 0, width, height).fill({ color: 0x0f1115, alpha: 0.28 * (1 - progress) });
  }

  isActive(): boolean {
    return this.current !== null;
  }
}
