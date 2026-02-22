import type { BiomeSkinId, RenderLighting, RenderSnapshot } from "@/ui/components/mythic/board2/render/types";
import { seededFloat } from "@/ui/components/mythic/board2/render/deterministic";

export interface BiomePropTemplate {
  id: string;
  spriteId?: string;
  chance: number;
  minSpacing: number;
  tileTag?: "road" | "water" | "hazard" | "edge" | "base";
  tint: number;
}

export interface AmbientEmitterPreset {
  id: "fireflies" | "snow" | "dust" | "embers" | "mist" | "heat";
  density: number;
  tint: number;
}

export interface BiomeSkin {
  id: BiomeSkinId;
  label: string;
  styleProfile: "gba_tactics_v1";
  tilePatternAlpha: number;
  propDensityScale: number;
  ambientIntensity: number;
  tileBase: number;
  tileAlt: number;
  road: number;
  water: number;
  cliff: number;
  hazard: number;
  fog: number;
  grid: number;
  allyRing: number;
  enemyRing: number;
  neutralRing: number;
  lighting: RenderLighting;
  props: BiomePropTemplate[];
  ambient: AmbientEmitterPreset[];
  sfxPalette: string[];
}

const SKINS: Record<BiomeSkinId, BiomeSkin> = {
  town_cobble_lantern: {
    id: "town_cobble_lantern",
    label: "Town",
    styleProfile: "gba_tactics_v1",
    tilePatternAlpha: 0.16,
    propDensityScale: 1.1,
    ambientIntensity: 0.45,
    tileBase: 0x5b4630,
    tileAlt: 0x694f35,
    road: 0x8f7a5d,
    water: 0x305f7d,
    cliff: 0x4e3b2b,
    hazard: 0x9c3f31,
    fog: 0x2c1d12,
    grid: 0xcaa772,
    allyRing: 0x64f4d6,
    enemyRing: 0xff7f87,
    neutralRing: 0xc6d8ef,
    lighting: { tint: 0xffc88a, vignetteAlpha: 0.2, fogAlpha: 0.08, saturation: 1.02 },
    props: [
      { id: "lantern", chance: 0.11, minSpacing: 2, tint: 0xffde9e, tileTag: "edge" },
      { id: "banner", chance: 0.06, minSpacing: 3, tint: 0xcc8a46, tileTag: "road" },
      { id: "crate", chance: 0.08, minSpacing: 2, tint: 0x8b623d },
    ],
    ambient: [{ id: "dust", density: 0.2, tint: 0xffcc88 }],
    sfxPalette: ["town_bustle", "lantern_flame", "footstep_cobble"],
  },
  forest_green_fireflies: {
    id: "forest_green_fireflies",
    label: "Forest",
    styleProfile: "gba_tactics_v1",
    tilePatternAlpha: 0.14,
    propDensityScale: 1.22,
    ambientIntensity: 0.72,
    tileBase: 0x1f4630,
    tileAlt: 0x28563a,
    road: 0x6d5a3a,
    water: 0x2a5f72,
    cliff: 0x213f2c,
    hazard: 0x7f352f,
    fog: 0x0f2018,
    grid: 0x8ac78f,
    allyRing: 0x65f0d0,
    enemyRing: 0xf4748f,
    neutralRing: 0xa5d7cf,
    lighting: { tint: 0xb4ffc2, vignetteAlpha: 0.24, fogAlpha: 0.12, saturation: 1.08 },
    props: [
      { id: "tree", chance: 0.14, minSpacing: 2, tint: 0x2f7a48 },
      { id: "stump", chance: 0.06, minSpacing: 2, tint: 0x6b5a3d },
      { id: "mushroom", chance: 0.03, minSpacing: 2, tint: 0xf3b9d4 },
    ],
    ambient: [{ id: "fireflies", density: 0.45, tint: 0xd5ff8f }],
    sfxPalette: ["forest_wind", "leaf_rustle", "night_insects"],
  },
  dungeon_stone_torch: {
    id: "dungeon_stone_torch",
    label: "Dungeon",
    styleProfile: "gba_tactics_v1",
    tilePatternAlpha: 0.1,
    propDensityScale: 0.95,
    ambientIntensity: 0.5,
    tileBase: 0x2c313a,
    tileAlt: 0x353b45,
    road: 0x4b4f59,
    water: 0x1f3e4f,
    cliff: 0x1f222b,
    hazard: 0x6f2632,
    fog: 0x12141c,
    grid: 0x8ea2b8,
    allyRing: 0x63d4ff,
    enemyRing: 0xff7a8f,
    neutralRing: 0xc3cad4,
    lighting: { tint: 0xffba70, vignetteAlpha: 0.3, fogAlpha: 0.18, saturation: 0.92 },
    props: [
      { id: "torch", chance: 0.09, minSpacing: 2, tint: 0xffc26f, tileTag: "edge" },
      { id: "rock", chance: 0.08, minSpacing: 2, tint: 0x556070 },
      { id: "bone", chance: 0.04, minSpacing: 2, tint: 0xd3c6ab },
    ],
    ambient: [{ id: "dust", density: 0.35, tint: 0xc8d0dc }],
    sfxPalette: ["torch_crackle", "cavern_drip", "chain_rattle"],
  },
  plains_road_dust: {
    id: "plains_road_dust",
    label: "Plains",
    styleProfile: "gba_tactics_v1",
    tilePatternAlpha: 0.12,
    propDensityScale: 1,
    ambientIntensity: 0.4,
    tileBase: 0x59613a,
    tileAlt: 0x646e42,
    road: 0x85754d,
    water: 0x35657d,
    cliff: 0x4f4e35,
    hazard: 0x8e4a31,
    fog: 0x1e1f17,
    grid: 0xc8c18a,
    allyRing: 0x74f6da,
    enemyRing: 0xff8d85,
    neutralRing: 0xd8e0b8,
    lighting: { tint: 0xffde9c, vignetteAlpha: 0.16, fogAlpha: 0.05, saturation: 1.01 },
    props: [
      { id: "grass_tuft", chance: 0.12, minSpacing: 1, tint: 0x82a155 },
      { id: "stone", chance: 0.06, minSpacing: 2, tint: 0x787260 },
      { id: "signpost", chance: 0.02, minSpacing: 4, tint: 0x9b7540, tileTag: "road" },
    ],
    ambient: [{ id: "dust", density: 0.22, tint: 0xffdfb2 }],
    sfxPalette: ["open_wind", "distant_birds", "footstep_dirt"],
  },
  snow_frost_mist: {
    id: "snow_frost_mist",
    label: "Snow",
    styleProfile: "gba_tactics_v1",
    tilePatternAlpha: 0.09,
    propDensityScale: 0.92,
    ambientIntensity: 0.66,
    tileBase: 0x9eb2c2,
    tileAlt: 0xafc1cf,
    road: 0x9f9d9a,
    water: 0x5b86a8,
    cliff: 0x7c8795,
    hazard: 0x8b5563,
    fog: 0x4d5965,
    grid: 0xe3f1ff,
    allyRing: 0x93f7ff,
    enemyRing: 0xff9ca8,
    neutralRing: 0xe3f0ff,
    lighting: { tint: 0xdff2ff, vignetteAlpha: 0.2, fogAlpha: 0.17, saturation: 0.9 },
    props: [
      { id: "frost_rock", chance: 0.07, minSpacing: 2, tint: 0xb6cadb },
      { id: "pine", chance: 0.1, minSpacing: 2, tint: 0x5f8f7f },
      { id: "icicle", chance: 0.05, minSpacing: 2, tint: 0xd6f1ff },
    ],
    ambient: [
      { id: "snow", density: 0.34, tint: 0xffffff },
      { id: "mist", density: 0.2, tint: 0xe5f1ff },
    ],
    sfxPalette: ["cold_wind", "snow_step", "ice_chime"],
  },
  desert_heat_shimmer: {
    id: "desert_heat_shimmer",
    label: "Desert",
    styleProfile: "gba_tactics_v1",
    tilePatternAlpha: 0.11,
    propDensityScale: 1.08,
    ambientIntensity: 0.58,
    tileBase: 0x8c6a34,
    tileAlt: 0x9a763d,
    road: 0xb18e51,
    water: 0x3e7da3,
    cliff: 0x6f4d21,
    hazard: 0xba522d,
    fog: 0x4b2f17,
    grid: 0xe7c17f,
    allyRing: 0x73f3d0,
    enemyRing: 0xff8a78,
    neutralRing: 0xdfc79c,
    lighting: { tint: 0xffd38c, vignetteAlpha: 0.18, fogAlpha: 0.08, saturation: 1.06 },
    props: [
      { id: "cactus", chance: 0.07, minSpacing: 2, tint: 0x5e8b49 },
      { id: "dune", chance: 0.11, minSpacing: 1, tint: 0xc59e59 },
      { id: "bone", chance: 0.03, minSpacing: 3, tint: 0xe4d2ad },
    ],
    ambient: [{ id: "heat", density: 0.18, tint: 0xfff1cf }],
    sfxPalette: ["desert_wind", "sand_step", "heat_hum"],
  },
};

export function biomeSkinFor(id: BiomeSkinId): BiomeSkin {
  return SKINS[id] ?? SKINS.plains_road_dust;
}

export function pickBiomeProps(snapshot: RenderSnapshot): Array<{ id: string; x: number; y: number; tint: number }> {
  const skin = biomeSkinFor(snapshot.board.biomeId);
  const out: Array<{ id: string; x: number; y: number; tint: number }> = [];
  const taken = new Set<string>();

  const width = snapshot.board.width;
  const height = snapshot.board.height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const tile = snapshot.tiles[y * width + x];
      if (!tile || tile.isBlocked || tile.overlays?.includes("water")) continue;
      const nearEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      for (const prop of skin.props) {
        const passTag = !prop.tileTag
          || (prop.tileTag === "road" && tile.overlays?.includes("road"))
          || (prop.tileTag === "water" && tile.overlays?.includes("water"))
          || (prop.tileTag === "hazard" && tile.overlays?.includes("hazard"))
          || (prop.tileTag === "edge" && nearEdge)
          || (prop.tileTag === "base" && !tile.overlays?.length);
        if (!passTag) continue;

        const chance = seededFloat(snapshot.board.seed, `${prop.id}:${x}:${y}`);
        if (chance > (prop.chance * skin.propDensityScale)) continue;

        let blockedBySpacing = false;
        for (let oy = -prop.minSpacing; oy <= prop.minSpacing && !blockedBySpacing; oy += 1) {
          for (let ox = -prop.minSpacing; ox <= prop.minSpacing; ox += 1) {
            if (taken.has(`${x + ox}:${y + oy}`)) {
              blockedBySpacing = true;
              break;
            }
          }
        }
        if (blockedBySpacing) continue;

        out.push({ id: prop.id, x, y, tint: prop.tint });
        taken.add(`${x}:${y}`);
        break;
      }
    }
  }

  return out;
}
