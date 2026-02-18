import { useMemo } from "react";
import { Container, Sprite } from "@pixi/react";
import { Texture } from "pixi.js";
import type { MythicBoardEntity, MythicBoardStateV2 } from "@/types/mythicBoard";
import { mythicSpriteAtlasRegistry } from "@/rendering/mythic/SpriteAtlasRegistry";

type AtlasId = "town" | "travel" | "dungeon";

interface EntityLayerProps {
  boardState: MythicBoardStateV2;
  player: { x: number; y: number };
  atlasId: AtlasId;
}

function atlasOrder(atlasId: AtlasId): string[] {
  if (atlasId === "town") return ["town", "travel", "dungeon"];
  if (atlasId === "travel") return ["travel", "town", "dungeon"];
  return ["dungeon", "travel", "town"];
}

function entityTint(entity: MythicBoardEntity): number {
  if (entity.kind === "npc") return 0xa5d9ff;
  if (entity.kind === "mob") return 0xff9a9a;
  if (entity.kind === "loot") return 0xf5d987;
  if (entity.kind === "interactable") return 0xcbb7ff;
  return 0xffffff;
}

function entityFrameCandidates(entity: MythicBoardEntity): string[] {
  const frames: string[] = [];
  const add = (frame: string) => {
    if (!frame || frames.includes(frame)) return;
    frames.push(frame);
  };

  add(entity.sprite ?? "");
  if ((entity.tags ?? []).includes("poi")) add("poi");
  if ((entity.tags ?? []).includes("gate")) add("gate");

  if (entity.kind === "npc") add("npc_default");
  if (entity.kind === "mob") add("mob_default");
  if (entity.kind === "loot") add("loot_default");
  if (entity.kind === "interactable") add("interactable_default");

  add("interactable_default");
  return frames;
}

interface RenderEntity {
  key: string;
  texture: Texture;
  x: number;
  y: number;
  size: number;
  tint?: number;
  alpha: number;
  criticalPath: boolean;
}

function collectRenderableEntities(boardState: MythicBoardStateV2): MythicBoardEntity[] {
  return [
    ...boardState.entities.npcs,
    ...boardState.entities.mobs,
    ...boardState.entities.loot,
    ...boardState.entities.interactables,
  ];
}

export function EntityLayer({ boardState, player, atlasId }: EntityLayerProps) {
  const renderEntities = useMemo(() => {
    const hidden = new Set([
      ...boardState.runtime.destroyed_ids,
      ...boardState.runtime.opened_ids,
    ]);
    const order = atlasOrder(atlasId);
    const tileSize = boardState.grid.tile_size;
    const entries: RenderEntity[] = [];

    for (const entity of collectRenderableEntities(boardState)) {
      if (hidden.has(entity.id)) continue;
      const texture = mythicSpriteAtlasRegistry.getFirstTexture(order, entityFrameCandidates(entity));
      entries.push({
        key: entity.id,
        texture: texture ?? Texture.WHITE,
        x: entity.x * tileSize,
        y: entity.y * tileSize - Math.floor(tileSize * 0.1),
        size: tileSize,
        tint: texture ? undefined : entityTint(entity),
        alpha: entity.kind === "loot" ? 0.95 : 1,
        criticalPath: Boolean(entity.critical_path),
      });
    }

    const playerTexture = mythicSpriteAtlasRegistry.getFirstTexture(order, ["player_default"]);
    entries.push({
      key: "player-token",
      texture: playerTexture ?? Texture.WHITE,
      x: player.x * tileSize,
      y: player.y * tileSize - Math.floor(tileSize * 0.1),
      size: tileSize,
      tint: playerTexture ? undefined : 0x9fff84,
      alpha: 1,
      criticalPath: false,
    });

    return entries;
  }, [atlasId, boardState, player.x, player.y]);

  return (
    <Container sortableChildren>
      {renderEntities.map((entity) => (
        <Container key={entity.key} x={entity.x} y={entity.y} zIndex={entity.y}>
          <Sprite
            texture={entity.texture}
            width={entity.size}
            height={entity.size}
            alpha={entity.alpha}
            tint={entity.tint}
            roundPixels
          />
          {entity.criticalPath ? (
            <Sprite
              texture={Texture.WHITE}
              x={Math.floor(entity.size * 0.25)}
              y={0}
              width={Math.max(4, Math.floor(entity.size * 0.5))}
              height={2}
              tint={0xf5d76e}
              alpha={0.95}
              roundPixels
            />
          ) : null}
        </Container>
      ))}
    </Container>
  );
}
