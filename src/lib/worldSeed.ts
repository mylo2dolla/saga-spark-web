export const toKebab = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const hashStringToUint32 = (value: string): number => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
};

export const createDeterministicPosition = (seed: string): { x: number; y: number } => {
  const hashed = hashStringToUint32(seed);
  return {
    x: 50 + (hashed % 400),
    y: 50 + ((hashed >>> 16) % 400),
  };
};
