import type { BiomeSkinId } from "@/ui/components/mythic/board2/pixi/renderTypes";

export interface BiomeSkinPalette {
  id: BiomeSkinId;
  base: number;
  alt: number;
  grid: number;
  blocked: number;
  hazard: number;
  water: number;
  road: number;
  fog: number;
  ambient: number;
  allyRing: number;
  enemyRing: number;
  neutralRing: number;
}

export const BIOME_SKINS: Record<BiomeSkinId, BiomeSkinPalette> = {
  town: {
    id: "town",
    base: 0x2b2117,
    alt: 0x32281c,
    grid: 0x5a431f,
    blocked: 0x8c6e2b,
    hazard: 0xa24a3f,
    water: 0x254b63,
    road: 0x7f6433,
    fog: 0x121112,
    ambient: 0xe9c46a,
    allyRing: 0x7dd3fc,
    enemyRing: 0xfda4af,
    neutralRing: 0xfde68a,
  },
  forest: {
    id: "forest",
    base: 0x15231a,
    alt: 0x1a2b1f,
    grid: 0x305740,
    blocked: 0x547c38,
    hazard: 0xb45f3d,
    water: 0x2a6f7d,
    road: 0x6b5c31,
    fog: 0x0d1611,
    ambient: 0x8fd694,
    allyRing: 0x67e8f9,
    enemyRing: 0xfb7185,
    neutralRing: 0xa7f3d0,
  },
  dungeon: {
    id: "dungeon",
    base: 0x17151d,
    alt: 0x1f1b28,
    grid: 0x3b3248,
    blocked: 0x6f5a3a,
    hazard: 0xae3f55,
    water: 0x304e79,
    road: 0x57506a,
    fog: 0x09090f,
    ambient: 0xb794f4,
    allyRing: 0x7dd3fc,
    enemyRing: 0xfb7185,
    neutralRing: 0xc4b5fd,
  },
  plains: {
    id: "plains",
    base: 0x1b2a1a,
    alt: 0x213523,
    grid: 0x3f6544,
    blocked: 0x8a7a3a,
    hazard: 0xbf5f40,
    water: 0x2f6a8c,
    road: 0x7c6a36,
    fog: 0x101214,
    ambient: 0x86efac,
    allyRing: 0x67e8f9,
    enemyRing: 0xfda4af,
    neutralRing: 0xa3e635,
  },
  snow: {
    id: "snow",
    base: 0x1b2433,
    alt: 0x202d3e,
    grid: 0x39516f,
    blocked: 0x7e8aa2,
    hazard: 0xc0776f,
    water: 0x3d7ba8,
    road: 0x8b97ad,
    fog: 0x121821,
    ambient: 0xcde8ff,
    allyRing: 0x7dd3fc,
    enemyRing: 0xfca5a5,
    neutralRing: 0xe2e8f0,
  },
  desert: {
    id: "desert",
    base: 0x3a2b1c,
    alt: 0x473520,
    grid: 0x7a6038,
    blocked: 0xa4823f,
    hazard: 0xd26b3e,
    water: 0x3e7494,
    road: 0xc49f52,
    fog: 0x1c140c,
    ambient: 0xf5d07a,
    allyRing: 0x67e8f9,
    enemyRing: 0xfb7185,
    neutralRing: 0xfef08a,
  },
  combat: {
    id: "combat",
    base: 0x24141a,
    alt: 0x2e1a22,
    grid: 0x5c2f3e,
    blocked: 0x8a6a3a,
    hazard: 0xd94666,
    water: 0x2d5672,
    road: 0x7f525a,
    fog: 0x11090d,
    ambient: 0xfb7185,
    allyRing: 0x67e8f9,
    enemyRing: 0xfb7185,
    neutralRing: 0xfde68a,
  },
};

export function biomeSkinFor(id: BiomeSkinId): BiomeSkinPalette {
  return BIOME_SKINS[id] ?? BIOME_SKINS.town;
}
