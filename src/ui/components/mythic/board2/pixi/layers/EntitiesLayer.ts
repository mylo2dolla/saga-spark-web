import * as PIXI from "pixi.js";
import type { RenderEntity, RenderSnapshot } from "@/ui/components/mythic/board2/pixi/renderTypes";
import { biomeSkinFor } from "@/ui/components/mythic/board2/pixi/skins/biomeSkins";

function clampPercent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

function entityBodyColor(entity: RenderEntity): number {
  if (entity.type === "player") return 0x54d8d2;
  if (entity.type === "ally") return 0x57b4e6;
  if (entity.type === "enemy") return 0xd25a70;
  if (entity.type === "npc") return 0x7d99b4;
  if (entity.type === "building") return 0x9f7f3b;
  return 0x6a7a73;
}

function entityRingColor(entity: RenderEntity, skin: ReturnType<typeof biomeSkinFor>): number {
  if (entity.type === "player" || entity.type === "ally") return skin.allyRing;
  if (entity.type === "enemy") return skin.enemyRing;
  return skin.neutralRing;
}

function tileStackOffsets(entities: RenderEntity[], tileSize: number): Map<string, { dx: number; dy: number }> {
  const grouped = new Map<string, string[]>();
  for (const entity of entities) {
    const key = `${entity.x}:${entity.y}`;
    const list = grouped.get(key) ?? [];
    list.push(entity.id);
    grouped.set(key, list);
  }
  const presets = [
    { dx: 0, dy: 0 },
    { dx: tileSize * 0.1, dy: -tileSize * 0.1 },
    { dx: -tileSize * 0.1, dy: tileSize * 0.1 },
    { dx: tileSize * 0.12, dy: tileSize * 0.08 },
    { dx: -tileSize * 0.12, dy: -tileSize * 0.08 },
  ];
  const offsets = new Map<string, { dx: number; dy: number }>();
  for (const ids of grouped.values()) {
    ids.forEach((id, index) => {
      offsets.set(id, presets[Math.min(index, presets.length - 1)] ?? { dx: 0, dy: 0 });
    });
  }
  return offsets;
}

function statusChipText(entity: RenderEntity): string | null {
  if (!Array.isArray(entity.statusIcons) || entity.statusIcons.length === 0) return null;
  if (entity.statusIcons.length <= 3) {
    return entity.statusIcons.map((status) => status.label).join(" ");
  }
  const first = entity.statusIcons.slice(0, 3).map((status) => status.label).join(" ");
  return `${first} +${entity.statusIcons.length - 3}`;
}

export function drawEntitiesLayer(snapshot: RenderSnapshot): PIXI.Container {
  const layer = new PIXI.Container();
  layer.eventMode = "none";

  const tileSize = snapshot.board.tileSize;
  const skin = biomeSkinFor(snapshot.board.biomeId);
  const livingEntities = snapshot.entities.filter((entity) => entity.isAlive && entity.type !== "building" && entity.type !== "prop");
  const offsets = tileStackOffsets(livingEntities, tileSize);

  for (const entity of livingEntities) {
    const cx = entity.x * tileSize + (tileSize / 2);
    const cy = entity.y * tileSize + (tileSize / 2);
    const offset = offsets.get(entity.id) ?? { dx: 0, dy: 0 };

    const token = new PIXI.Container();
    token.x = cx + offset.dx;
    token.y = cy + offset.dy;

    const ring = new PIXI.Graphics();
    ring.lineStyle(entity.isFocused ? 3 : 2, entityRingColor(entity, skin), entity.isFocused ? 0.98 : 0.78);
    ring.beginFill(entityBodyColor(entity), 0.58);
    ring.drawCircle(0, 0, Math.max(10, tileSize * 0.26));
    ring.endFill();
    if (entity.isActiveTurn) {
      ring.lineStyle(2, 0xe2f4ff, 0.94);
      ring.drawCircle(0, 0, Math.max(12, tileSize * 0.31));
    }
    token.addChild(ring);

    const hpPct = clampPercent(entity.hp, entity.hpMax);
    const mpPct = clampPercent(entity.mp, entity.mpMax);

    const hpBar = new PIXI.Graphics();
    hpBar.beginFill(0x0f1115, 0.8);
    hpBar.drawRoundedRect(-16, 13, 32, 3, 2);
    hpBar.endFill();
    hpBar.beginFill(0x7de295, 0.92);
    hpBar.drawRoundedRect(-16, 13, Math.max(1, 32 * hpPct), 3, 2);
    hpBar.endFill();
    token.addChild(hpBar);

    const mpBar = new PIXI.Graphics();
    mpBar.beginFill(0x0f1115, 0.8);
    mpBar.drawRoundedRect(-16, 17, 32, 3, 2);
    mpBar.endFill();
    mpBar.beginFill(0x67d6ff, 0.92);
    mpBar.drawRoundedRect(-16, 17, Math.max(1, 32 * mpPct), 3, 2);
    mpBar.endFill();
    token.addChild(mpBar);

    const label = new PIXI.Text({
      text: entity.label,
      style: {
        fontSize: 9,
        fill: 0xf8fafc,
        fontFamily: "Verdana, sans-serif",
      },
    });
    label.anchor.set(0.5, 1);
    label.y = -12;
    token.addChild(label);

    const stats = new PIXI.Text({
      text: `${Math.max(0, Math.floor(entity.hp))}/${Math.max(1, Math.floor(entity.hpMax))}  ${Math.max(0, Math.floor(entity.mp))}MP`,
      style: {
        fontSize: 7,
        fill: 0xe5ecf4,
        fontFamily: "Verdana, sans-serif",
      },
    });
    stats.anchor.set(0.5, 0);
    stats.y = 21;
    token.addChild(stats);

    const statusText = statusChipText(entity);
    if (statusText) {
      const status = new PIXI.Text({
        text: statusText,
        style: {
          fontSize: 7,
          fill: 0xfde68a,
          fontFamily: "Verdana, sans-serif",
        },
      });
      status.anchor.set(0.5, 0);
      status.y = 30;
      token.addChild(status);
    }

    layer.addChild(token);
  }

  return layer;
}
