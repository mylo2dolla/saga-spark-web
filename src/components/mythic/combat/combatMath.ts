export type Metric = "manhattan" | "chebyshev" | "euclidean";

export function distanceTiles(metric: Metric, ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  if (metric === "chebyshev") return Math.max(dx, dy);
  if (metric === "euclidean") return Math.sqrt(dx * dx + dy * dy);
  return dx + dy;
}

export type Point = { x: number; y: number };

// Same algorithm as server-side mythic_grid.ts, but kept local to the client for preview UX only.
export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  let x = Math.floor(x0);
  let y = Math.floor(y0);
  const dx = Math.abs(Math.floor(x1) - x);
  const dy = Math.abs(Math.floor(y1) - y);
  const sx = x < x1 ? 1 : -1;
  const sy = y < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    points.push({ x, y });
    if (x === Math.floor(x1) && y === Math.floor(y1)) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

export function hasLineOfSight(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  blocked: Set<string>,
): boolean {
  const points = bresenhamLine(ax, ay, bx, by);
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!;
    if (blocked.has(`${p.x},${p.y}`)) return false;
  }
  return true;
}

