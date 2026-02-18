import { useMemo } from "react";
import { Container, Sprite } from "@pixi/react";
import { Texture } from "pixi.js";
import type { MythicBoardStateV2, MythicTileLayer } from "@/types/mythicBoard";
import { mythicSpriteAtlasRegistry } from "@/rendering/mythic/SpriteAtlasRegistry";

type AtlasId = "town" | "travel" | "dungeon";

interface TileLayerProps {
  boardState: MythicBoardStateV2;
  atlasId: AtlasId;
}

function atlasOrder(atlasId: AtlasId): string[] {
  if (atlasId === "town") return ["town", "travel", "dungeon"];
  if (atlasId === "travel") return ["travel", "town", "dungeon"];
  return ["dungeon", "travel", "town"];
}

function tileTint(tile: string, biome: string): number {
  if (tile.includes("wall")) return 0x4f4a4f;
  if (tile.includes("tree")) return 0x3d6f3e;
  if (tile.includes("pillar")) return 0x6b6769;
  if (tile.includes("cobble")) return 0x8c8479;
  if (tile.includes("sand")) return 0xc9aa6b;
  if (tile.includes("mud")) return 0x6f5a40;
  if (tile.includes("dry_rock")) return 0x8a725d;
  if (tile.includes("stone")) return 0x868f9f;
  if (tile.includes("ruin")) return 0x6a6670;
  if (tile.includes("cave") || tile.includes("crypt")) return 0x5a5664;
  if (biome === "town") return 0x6a7b63;
  if (biome === "dungeon" || biome === "cavern" || biome === "crypt") return 0x545062;
  return 0x5f7f46;
}

function biomeBaseFrame(biome: string): string {
  if (biome === "town") return "cobble";
  if (biome === "forest") return "grass_forest";
  if (biome === "wetlands") return "mud";
  if (biome === "desert") return "sand";
  if (biome === "badlands") return "dry_rock";
  if (biome === "mountain") return "stone";
  if (biome === "ruins") return "ruin_floor";
  if (biome === "crypt") return "crypt_floor";
  if (biome === "cavern") return "cave_floor";
  return "grass";
}

function frameCandidates(tile: string, biome: string): string[] {
  const candidates: string[] = [];
  const add = (value: string) => {
    if (!value || candidates.includes(value)) return;
    candidates.push(value);
  };

  add(tile);
  if (tile.endsWith("_variant")) add(tile.slice(0, -8));
  if (tile.endsWith("_edge")) add(tile.slice(0, -5));

  if (tile.includes("wall")) add("wall");
  if (tile.includes("tree")) add("tree");
  if (tile.includes("pillar")) add("pillar");
  if (tile.includes("crate")) add("crate");

  add(biomeBaseFrame(biome));
  add("grass");
  add("cobble");
  add("cave_floor");
  return candidates;
}

function layerAlpha(layer: MythicTileLayer): number {
  if (layer.kind === "obstacle") return 0.97;
  if (layer.kind === "overlay") return 0.8;
  return 1;
}

export function TileLayer({ boardState, atlasId }: TileLayerProps) {
  const sprites = useMemo(() => {
    const order = atlasOrder(atlasId);
    const entries: Array<{
      key: string;
      texture: Texture;
      x: number;
      y: number;
      width: number;
      height: number;
      alpha: number;
      tint?: number;
    }> = [];
    const tileSize = boardState.grid.tile_size;
    const layers = boardState.grid.layers;

    for (const layer of layers) {
      const alpha = layerAlpha(layer);
      for (let y = 0; y < layer.tiles.length; y += 1) {
        const row = layer.tiles[y] ?? [];
        for (let x = 0; x < row.length; x += 1) {
          const tile = row[x] ?? "void";
          if (tile === "void") continue;
          const texture = mythicSpriteAtlasRegistry.getFirstTexture(order, frameCandidates(tile, boardState.chunk.biome));
          entries.push({
            key: `${layer.id}:${x}:${y}:${tile}`,
            texture: texture ?? Texture.WHITE,
            x: x * tileSize,
            y: y * tileSize,
            width: tileSize,
            height: tileSize,
            alpha,
            tint: texture ? undefined : tileTint(tile, boardState.chunk.biome),
          });
        }
      }
    }

    return entries;
  }, [atlasId, boardState]);

  return (
    <Container>
      {sprites.map((sprite) => (
        <Sprite
          key={sprite.key}
          texture={sprite.texture}
          x={sprite.x}
          y={sprite.y}
          width={sprite.width}
          height={sprite.height}
          alpha={sprite.alpha}
          tint={sprite.tint}
          roundPixels
        />
      ))}
    </Container>
  );
}
