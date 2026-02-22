import * as PIXI from "pixi.js";
import { seededRange } from "@/ui/components/mythic/board2/render/deterministic";
import type { RendererSettings } from "@/ui/components/mythic/board2/render/types";

interface CameraState {
  centerX: number;
  centerY: number;
  targetX: number;
  targetY: number;
  zoomFactor: number;
  targetZoomFactor: number;
  shakeMs: number;
  shakePower: number;
  shakeSeed: string;
}

export class CameraDirector {
  private viewportW = 1;
  private viewportH = 1;
  private worldW = 1;
  private worldH = 1;
  private state: CameraState = {
    centerX: 0,
    centerY: 0,
    targetX: 0,
    targetY: 0,
    zoomFactor: 1,
    targetZoomFactor: 1,
    shakeMs: 0,
    shakePower: 0,
    shakeSeed: "camera",
  };

  setViewport(width: number, height: number) {
    this.viewportW = Math.max(1, width);
    this.viewportH = Math.max(1, height);
  }

  setWorld(width: number, height: number) {
    this.worldW = Math.max(1, width);
    this.worldH = Math.max(1, height);
    if (this.state.centerX === 0 && this.state.centerY === 0) {
      this.state.centerX = this.worldW / 2;
      this.state.centerY = this.worldH / 2;
      this.state.targetX = this.state.centerX;
      this.state.targetY = this.state.centerY;
    }
  }

  focus(worldX: number, worldY: number) {
    this.state.targetX = Math.max(0, Math.min(this.worldW, worldX));
    this.state.targetY = Math.max(0, Math.min(this.worldH, worldY));
  }

  onHitImpact(intensity: number, seed: string, settings: RendererSettings) {
    if (!settings.cinematicCamera || settings.fastMode || settings.reducedMotion) return;
    const clamped = Math.max(0, Math.min(1, intensity));
    const qualityScale = settings.qualityMode === "max" ? 1 : settings.qualityMode === "perf" ? 0.65 : 0.82;
    this.state.targetZoomFactor = 1 + (clamped * 0.08 * qualityScale);
    this.state.shakeMs = 140 + Math.round(clamped * 190 * qualityScale);
    this.state.shakePower = 1.5 + (clamped * 4.2 * qualityScale);
    this.state.shakeSeed = seed;
  }

  onHealImpact(intensity: number, settings: RendererSettings) {
    if (!settings.cinematicCamera || settings.fastMode || settings.reducedMotion) return;
    const clamped = Math.max(0, Math.min(1, intensity));
    const qualityScale = settings.qualityMode === "max" ? 1 : settings.qualityMode === "perf" ? 0.72 : 0.86;
    this.state.targetZoomFactor = 1 + (clamped * 0.04 * qualityScale);
  }

  update(deltaMs: number, settings: RendererSettings): { offsetX: number; offsetY: number; scale: number } {
    const dt = Math.max(0.001, deltaMs / 1000);
    const damping = settings.fastMode ? 18 : 12;

    this.state.centerX += (this.state.targetX - this.state.centerX) * Math.min(1, damping * dt);
    this.state.centerY += (this.state.targetY - this.state.centerY) * Math.min(1, damping * dt);

    const zoomDamping = settings.fastMode ? 16 : 9;
    this.state.zoomFactor += (this.state.targetZoomFactor - this.state.zoomFactor) * Math.min(1, zoomDamping * dt);
    this.state.targetZoomFactor += (1 - this.state.targetZoomFactor) * Math.min(1, 4 * dt);

    const safeTop = Math.max(0, Math.floor(settings.safeInsetTopPx));
    const safeBottom = Math.max(0, Math.floor(settings.safeInsetBottomPx));
    const edgePadding = Math.max(0, settings.edgePaddingPx);
    const availableW = Math.max(1, this.viewportW - (edgePadding * 2));
    const availableH = Math.max(1, this.viewportH - safeTop - safeBottom - (edgePadding * 2));

    const containScale = Math.min(availableW / this.worldW, availableH / this.worldH);
    const coverScale = Math.max(availableW / this.worldW, availableH / this.worldH);
    const baseScale = settings.fitMode === "cover"
      ? coverScale
      : containScale;
    const scale = Math.max(0.2, Math.min(3.5, baseScale * this.state.zoomFactor));

    let shakeX = 0;
    let shakeY = 0;
    if (!settings.fastMode && this.state.shakeMs > 0 && !settings.reducedMotion) {
      this.state.shakeMs = Math.max(0, this.state.shakeMs - deltaMs);
      const progress = this.state.shakeMs / 300;
      const amp = this.state.shakePower * progress;
      shakeX = seededRange(this.state.shakeSeed, -amp, amp, `${this.state.shakeMs}:x`);
      shakeY = seededRange(this.state.shakeSeed, -amp, amp, `${this.state.shakeMs}:y`);
    }

    const scaledW = this.worldW * scale;
    const scaledH = this.worldH * scale;
    const innerW = Math.max(1, this.viewportW - (edgePadding * 2));
    const innerH = Math.max(1, this.viewportH - safeTop - safeBottom - (edgePadding * 2));

    const viewportCenterX = edgePadding + (innerW / 2);
    const viewportCenterY = safeTop + edgePadding + (innerH / 2);
    const desiredX = viewportCenterX - (this.state.centerX * scale);
    const desiredY = viewportCenterY - (this.state.centerY * scale);

    const offsetX = (() => {
      if (scaledW <= innerW) {
        return edgePadding + ((innerW - scaledW) / 2) + shakeX;
      }
      const maxX = edgePadding;
      const minX = edgePadding + innerW - scaledW;
      return Math.min(maxX, Math.max(minX, desiredX + shakeX));
    })();
    const offsetY = (() => {
      if (scaledH <= innerH) {
        return safeTop + edgePadding + ((innerH - scaledH) / 2) + shakeY;
      }
      const maxY = safeTop + edgePadding;
      const minY = safeTop + edgePadding + innerH - scaledH;
      return Math.min(maxY, Math.max(minY, desiredY + shakeY));
    })();

    return {
      offsetX,
      offsetY,
      scale,
    };
  }

  applyTo(container: PIXI.Container, transform: { offsetX: number; offsetY: number; scale: number }) {
    container.scale.set(transform.scale, transform.scale);
    container.position.set(transform.offsetX, transform.offsetY);
  }

  debugState() {
    return {
      scale: this.state.zoomFactor,
      shakeMs: this.state.shakeMs,
    };
  }
}
