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

