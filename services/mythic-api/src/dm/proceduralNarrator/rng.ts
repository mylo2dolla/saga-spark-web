function hash32(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ProceduralRng {
  next01: () => number;
  pick: <T>(pool: readonly T[]) => T;
  weightedPick: <T extends { weight: number }>(pool: readonly T[]) => T;
}

export function createProceduralRng(seedInput: string): ProceduralRng {
  const rand = mulberry32(hash32(seedInput));
  return {
    next01: () => rand(),
    pick: <T>(pool: readonly T[]): T => {
      if (!Array.isArray(pool) || pool.length === 0) {
        throw new Error("Cannot pick from an empty pool.");
      }
      const idx = Math.floor(rand() * pool.length);
      return pool[idx]!;
    },
    weightedPick: <T extends { weight: number }>(pool: readonly T[]): T => {
      if (!Array.isArray(pool) || pool.length === 0) {
        throw new Error("Cannot weighted-pick from an empty pool.");
      }
      const total = pool.reduce((sum, entry) => sum + Math.max(0.0001, Number(entry.weight) || 0), 0);
      const roll = rand() * total;
      let cursor = 0;
      for (const entry of pool) {
        cursor += Math.max(0.0001, Number(entry.weight) || 0);
        if (roll <= cursor) return entry;
      }
      return pool[pool.length - 1]!;
    },
  };
}

export function buildNarrationSeed(args: {
  campaignSeed: string;
  sessionId: string;
  eventId: string;
}): string {
  return `${args.campaignSeed}::${args.sessionId}::${args.eventId}`;
}

