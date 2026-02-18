import { pixelPalette } from "@/ui/components/mythic/board/pixel/pixelPalette";

export function drawPixelRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
}

export function drawOutlineRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string,
  stroke: string,
) {
  drawPixelRect(ctx, x, y, w, h, fill);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.floor(x) + 0.5, Math.floor(y) + 0.5, Math.floor(w), Math.floor(h));
}

export function drawHumanoid(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tone: string,
  headingPulse: number,
) {
  drawPixelRect(ctx, x + 2, y + 1, 3, 2, pixelPalette.white);
  drawPixelRect(ctx, x + 1, y + 3, 5, 4, tone);
  drawPixelRect(ctx, x + 2, y + 7, 1, 2, pixelPalette.black);
  drawPixelRect(ctx, x + 4, y + 7, 1, 2, pixelPalette.black);
  if (headingPulse > 0.4) {
    drawPixelRect(ctx, x + 6, y + 3, 1, 1, pixelPalette.amber);
  }
}

export function drawHouse(ctx: CanvasRenderingContext2D, x: number, y: number, lit: boolean) {
  drawPixelRect(ctx, x + 1, y + 2, 8, 6, pixelPalette.parchment);
  drawPixelRect(ctx, x, y + 1, 10, 2, pixelPalette.road);
  drawPixelRect(ctx, x + 4, y + 5, 2, 3, pixelPalette.black);
  if (lit) {
    drawPixelRect(ctx, x + 2, y + 4, 2, 2, pixelPalette.amber);
    drawPixelRect(ctx, x + 6, y + 4, 2, 2, pixelPalette.amber);
  } else {
    drawPixelRect(ctx, x + 2, y + 4, 2, 2, pixelPalette.gray);
    drawPixelRect(ctx, x + 6, y + 4, 2, 2, pixelPalette.gray);
  }
}

export function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, pulse: number) {
  drawPixelRect(ctx, x + 3, y + 6, 2, 3, pixelPalette.road);
  drawPixelRect(ctx, x + 1, y + 2, 6, 5, pulse > 0.5 ? pixelPalette.green : pixelPalette.grassA);
}

export function drawChest(ctx: CanvasRenderingContext2D, x: number, y: number, flicker: number) {
  drawPixelRect(ctx, x + 1, y + 3, 6, 4, pixelPalette.road);
  drawPixelRect(ctx, x + 1, y + 2, 6, 2, pixelPalette.amberDim);
  drawPixelRect(ctx, x + 3, y + 4, 2, 2, flicker > 0.5 ? pixelPalette.amber : pixelPalette.white);
}

export function drawTrap(ctx: CanvasRenderingContext2D, x: number, y: number, pulse: number) {
  const color = pulse > 0.5 ? pixelPalette.red : pixelPalette.violet;
  drawPixelRect(ctx, x + 1, y + 1, 6, 1, color);
  drawPixelRect(ctx, x + 1, y + 3, 6, 1, color);
  drawPixelRect(ctx, x + 1, y + 5, 6, 1, color);
}

export function drawDamageText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.font = "6px monospace";
  ctx.fillText(text, Math.floor(x), Math.floor(y));
}

export function drawRuin(ctx: CanvasRenderingContext2D, x: number, y: number, pulse: number) {
  const wall = pulse > 0.5 ? pixelPalette.gray : pixelPalette.road;
  drawPixelRect(ctx, x + 1, y + 5, 10, 5, wall);
  drawPixelRect(ctx, x + 2, y + 3, 8, 2, wall);
  drawPixelRect(ctx, x + 4, y + 1, 3, 2, wall);
  drawPixelRect(ctx, x + 5, y + 6, 2, 3, pixelPalette.black);
}

export function drawMonolith(ctx: CanvasRenderingContext2D, x: number, y: number, glow: number) {
  drawPixelRect(ctx, x + 3, y + 1, 4, 9, pixelPalette.stoneB);
  drawPixelRect(ctx, x + 4, y + 2, 2, 7, glow > 0.5 ? pixelPalette.cyan : pixelPalette.amberDim);
  drawPixelRect(ctx, x + 2, y + 10, 6, 2, pixelPalette.road);
}

export function drawCaveMouth(ctx: CanvasRenderingContext2D, x: number, y: number, flicker: number) {
  drawOutlineRect(ctx, x, y, 12, 9, "rgba(14,14,20,0.85)", "rgba(176,135,255,0.55)");
  drawPixelRect(ctx, x + 2, y + 3, 8, 4, "rgba(8,8,14,0.9)");
  if (flicker > 0.5) {
    drawPixelRect(ctx, x + 5, y + 2, 2, 1, pixelPalette.amber);
  }
}
