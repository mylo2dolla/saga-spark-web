import { Md5 } from "https://deno.land/std@0.168.0/hash/md5.ts";

export function md5Hex(input: string): string {
  const md5 = new Md5();
  md5.update(input);
  return md5.toString();
}

// Mirrors mythic.rng01(seed,label) in Postgres.
export function rng01(seed: number, label: string): number {
  const h = md5Hex(`${seed}:${label ?? ""}`).slice(0, 16);
  const n = BigInt(`0x${h}`);
  const mod = Number(n % 1000000000n);
  return mod / 1_000_000_000;
}

export function rngInt(seed: number, label: string, lo: number, hi: number): number {
  const a = Math.min(lo, hi);
  const b = Math.max(lo, hi);
  const span = (b - a) + 1;
  if (span <= 1) return a;
  return a + Math.floor(rng01(seed, label) * span);
}

export function rngPick<T>(seed: number, label: string, arr: readonly T[]): T {
  if (!arr.length) throw new Error("rngPick: empty array");
  const idx = rngInt(seed, label, 0, arr.length - 1);
  return arr[idx]!;
}

export function clampInt(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(x)));
}

export function clampNumber(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function weightedPick<T>(seed: number, label: string, items: Array<{ item: T; weight: number }>): T {
  if (!items.length) throw new Error("weightedPick: empty");
  const total = items.reduce((acc, it) => acc + Math.max(0, it.weight), 0);
  if (total <= 0) return items[0]!.item;
  const r = rng01(seed, label) * total;
  let acc = 0;
  for (const it of items) {
    acc += Math.max(0, it.weight);
    if (r <= acc) return it.item;
  }
  return items[items.length - 1]!.item;
}
