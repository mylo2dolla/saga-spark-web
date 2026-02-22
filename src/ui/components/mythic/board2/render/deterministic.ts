export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededFloat(seed: string, salt = ""): number {
  const n = hashString(`${seed}|${salt}`);
  return (n % 1_000_000) / 1_000_000;
}

export function seededChoice<T>(seed: string, options: T[], salt = ""): T {
  if (options.length === 0) {
    throw new Error("seededChoice requires at least one option");
  }
  const idx = Math.floor(seededFloat(seed, salt) * options.length) % options.length;
  return options[idx] as T;
}

export function seededRange(seed: string, min: number, max: number, salt = ""): number {
  if (max <= min) return min;
  const value = seededFloat(seed, salt);
  return min + ((max - min) * value);
}
