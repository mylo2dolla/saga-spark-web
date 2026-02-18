import type { RollLogEntry } from "./turn_contract.ts";

// Deterministic sequential PRNG for turn resolution.
// Based on a 32-bit "mulberry32"-style generator.
export function createTurnPrng(turnSeed: bigint) {
  let state = Number(turnSeed & 0xffff_ffffn) >>> 0;
  let i = 0;
  const rollLog: RollLogEntry[] = [];

  const next01 = (label: string, meta?: Record<string, unknown>): number => {
    // mulberry32 step
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    rollLog.push({
      i,
      label,
      value01: value,
      meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
    });
    i += 1;
    return value;
  };

  return { next01, rollLog };
}

