export type Metric = "manhattan" | "chebyshev" | "euclidean";

export function distanceTiles(
  metric: Metric,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  if (metric === "chebyshev") return Math.max(dx, dy);
  if (metric === "euclidean") return Math.sqrt(dx * dx + dy * dy);
  return dx + dy; // manhattan default
}

export function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  const v = Math.floor(n);
  return Math.min(Math.max(v, lo), hi);
}

export function bresenhamLine(ax: number, ay: number, bx: number, by: number): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  let x0 = Math.floor(ax);
  let y0 = Math.floor(ay);
  const x1 = Math.floor(bx);
  const y1 = Math.floor(by);
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  return points;
}

