export function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function stableInt(seedKey: string, salt = ""): number {
  return hash32(`${seedKey}::${salt}`);
}

export function stableFloat(seedKey: string, salt = ""): number {
  const value = stableInt(seedKey, salt);
  return (value % 1_000_000) / 1_000_000;
}

export function pickDeterministic<T>(pool: readonly T[], seedKey: string, salt = ""): T {
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error("pickDeterministic requires a non-empty pool");
  }
  const index = stableInt(seedKey, salt) % pool.length;
  return pool[index]!;
}

export function pickDeterministicWithoutImmediateRepeat<T>(
  pool: readonly T[],
  seedKey: string,
  lastValue: T | null | undefined,
  salt = "",
): T {
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new Error("pickDeterministicWithoutImmediateRepeat requires a non-empty pool");
  }
  if (pool.length === 1) return pool[0]!;
  const filtered = lastValue === undefined || lastValue === null
    ? [...pool]
    : pool.filter((entry) => entry !== lastValue);
  if (filtered.length === 0) return pool[0]!;
  const index = stableInt(seedKey, salt) % filtered.length;
  return filtered[index]!;
}

export function weightedPickWithoutImmediateRepeat<T extends string>(
  weights: Record<T, number>,
  seedKey: string,
  lastValue: T | null,
  salt = "",
): T {
  const keys = Object.keys(weights) as T[];
  if (keys.length === 0) {
    throw new Error("weightedPickWithoutImmediateRepeat requires at least one key");
  }
  let candidates = keys.filter((key) => (weights[key] ?? 0) > 0);
  if (candidates.length === 0) candidates = [...keys];
  if (lastValue && candidates.length > 1) {
    const withoutLast = candidates.filter((key) => key !== lastValue);
    if (withoutLast.length > 0) candidates = withoutLast;
  }

  const total = candidates.reduce((acc, key) => acc + Math.max(0.001, weights[key] ?? 0), 0);
  const roll = stableFloat(seedKey, salt) * total;
  let cursor = 0;
  for (const key of candidates) {
    cursor += Math.max(0.001, weights[key] ?? 0);
    if (roll <= cursor) return key;
  }
  return candidates[candidates.length - 1]!;
}

export function hashLine(text: string): string {
  const clean = text.trim().toLowerCase().replace(/\s+/g, " ");
  return `${hash32(clean).toString(16)}`;
}

export function dedupeKeepOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}
