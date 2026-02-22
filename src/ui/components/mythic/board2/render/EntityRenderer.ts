import * as PIXI from "pixi.js";
import type { RenderEntity, RenderSnapshot, RendererSettings } from "@/ui/components/mythic/board2/render/types";
import { biomeSkinFor } from "@/ui/components/mythic/board2/render/BiomeSkinRegistry";
import { AssetManager } from "@/ui/components/mythic/board2/render/AssetManager";

function clampPercent(value: number | undefined, max: number | undefined): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || (max ?? 0) <= 0) return 0;
  return Math.max(0, Math.min(1, (value as number) / (max as number)));
}

function bodyTint(entity: RenderEntity): number {
  if (entity.kind === "player") return 0x5ce2d8;
  if (entity.team === "ally") return 0x63b7ff;
  if (entity.team === "enemy") return 0xe66b81;
  if (entity.kind === "npc") return 0x93abc7;
  if (entity.kind === "building") return 0xa67b47;
  return 0x708183;
}

function teamRingColor(entity: RenderEntity, snapshot: RenderSnapshot): number {
  const skin = biomeSkinFor(snapshot.board.biomeId);
  if (entity.team === "ally") return skin.allyRing;
  if (entity.team === "enemy") return skin.enemyRing;
  return skin.neutralRing;
}

function statusColor(family: string): number {
  const key = family.toLowerCase();
  if (key === "bleed") return 0xff8da1;
  if (key === "poison") return 0xa9e97a;
  if (key === "burn") return 0xffbd79;
  if (key === "guard") return 0xa5d8ff;
  if (key === "barrier") return 0x8de9ff;
  if (key === "vulnerable") return 0xf4c9ff;
  if (key === "stunned") return 0xfff09a;
  if (key === "buff") return 0x8ff3b7;
  return 0xe6d3ff;
}

function statusShort(family: string): string {
  const clean = family.trim().toLowerCase();
  if (!clean) return "?";
  return clean.slice(0, 1).toUpperCase();
}

function markerLabel(role: RenderEntity["markerRole"]): string {
  if (role === "merchant") return "$";
  if (role === "healer") return "+";
  if (role === "danger") return "!";
  if (role === "quest") return "?";
  return "";
}

function intentSymbol(intent: RenderEntity["intent"] | undefined): string {
  if (!intent) return "";
  if (intent.type === "attack") return "ATK";
  if (intent.type === "defend") return "DEF";
  if (intent.type === "cast") return "CAST";
  if (intent.type === "charge") return "CHG";
  if (intent.type === "support") return "SUP";
  return "IDLE";
}

function compactTokenLabel(value: string, fallback: string): string {
  const raw = (value.trim().length > 0 ? value : fallback).replace(/[^a-z0-9]/gi, "");
  if (!raw) return "UNIT";
  return raw.slice(0, 4).toUpperCase();
}

function tileOffsets(entities: RenderEntity[], tileSize: number): Map<string, { dx: number; dy: number }> {
  const grouped = new Map<string, string[]>();
  for (const entity of entities) {
    const key = `${entity.x}:${entity.y}`;
    const list = grouped.get(key) ?? [];
    list.push(entity.id);
    grouped.set(key, list);
  }

  const offsets = new Map<string, { dx: number; dy: number }>();
  for (const idsRaw of grouped.values()) {
    const ids = idsRaw.slice().sort((left, right) => left.localeCompare(right));
    if (ids.length <= 1) {
      const single = ids[0];
      if (single) offsets.set(single, { dx: 0, dy: 0 });
      continue;
    }

    let cursor = 0;
    let ringIndex = 0;
    let ringCap = 6;
    while (cursor < ids.length) {
      const countInRing = Math.min(ringCap, ids.length - cursor);
      const radius = tileSize * (0.11 + (ringIndex * 0.09));
      for (let i = 0; i < countInRing; i += 1) {
        const id = ids[cursor + i];
        const angle = ((Math.PI * 2 * i) / countInRing) - (Math.PI / 2);
        offsets.set(id, {
          dx: Math.cos(angle) * radius,
          dy: Math.sin(angle) * radius * 0.82,
        });
      }
      cursor += countInRing;
      ringIndex += 1;
      ringCap += 4;
    }
  }

  return offsets;
}

function drawMarkerChip(text: string, fill: number, y: number): PIXI.Container {
  const container = new PIXI.Container();
  const bg = new PIXI.Graphics();
  bg.roundRect(-8, y, 16, 11, 4);
  bg.fill({ color: fill, alpha: 0.8 });
  container.addChild(bg);

  const label = new PIXI.Text({
    text,
    style: {
      fontFamily: "Verdana, sans-serif",
      fontSize: 8,
      fill: 0x111318,
      fontWeight: "bold",
    },
  });
  label.anchor.set(0.5, 0);
  label.y = y + 1;
  container.addChild(label);
  return container;
}

export class EntityRenderer {
  readonly container = new PIXI.Container();
  private renderMeta: {
    uiDensity: "minimal" | "balanced";
    tokenLabelMode: "compact" | "full";
    statusChipMode: "none" | "single" | "stack";
    intentChipMode: "none" | "single" | "stack";
  } = {
    uiDensity: "minimal",
    tokenLabelMode: "compact",
    statusChipMode: "none",
    intentChipMode: "none",
  };

  constructor() {
    this.container.eventMode = "none";
  }

  render(snapshot: RenderSnapshot, assets: AssetManager, settings: RendererSettings) {
    this.container.removeChildren();
    const tileSize = snapshot.board.tileSize;
    const live = snapshot.entities.filter((entity) => entity.kind === "building" || entity.kind === "prop" || (entity.hp ?? 1) > 0);
    const offsets = tileOffsets(live, tileSize);
    const compactCombatLabels = snapshot.board.type === "combat" && settings.tokenLabelMode === "compact";
    const minimalCombatLabels = snapshot.board.type === "combat" && settings.uiDensity === "minimal";
    const showStatusChips = settings.uiDensity === "balanced";
    const showIntentChip = settings.uiDensity === "balanced";
    this.renderMeta = {
      uiDensity: settings.uiDensity,
      tokenLabelMode: (minimalCombatLabels || compactCombatLabels) ? "compact" : "full",
      statusChipMode: showStatusChips ? "single" : "none",
      intentChipMode: showIntentChip ? "single" : "none",
    };

    for (const entity of live) {
      const root = new PIXI.Container();
      const offset = offsets.get(entity.id) ?? { dx: 0, dy: 0 };
      root.position.set(
        (entity.x * tileSize) + (tileSize / 2) + offset.dx,
        (entity.y * tileSize) + (tileSize / 2) + offset.dy,
      );

      const texture = assets.getTextureOrFallback(entity.spriteId, entity.kind, bodyTint(entity));
      const sprite = new PIXI.Sprite(texture);
      sprite.anchor.set(0.5, 0.5);
      sprite.width = Math.round(tileSize * 0.55);
      sprite.height = Math.round(tileSize * 0.55);
      sprite.tint = bodyTint(entity);
      sprite.alpha = entity.kind === "building" ? 0.9 : 0.98;
      root.addChild(sprite);

      const ring = new PIXI.Graphics();
      ring.circle(0, 0, Math.round(tileSize * 0.29));
      ring.stroke({
        color: teamRingColor(entity, snapshot),
        width: entity.isFocused ? 3 : 2,
        alpha: entity.kind === "building" ? 0.36 : 0.82,
      });
      if (entity.isActive) {
        ring.circle(0, 0, Math.round(tileSize * 0.35));
        ring.stroke({ color: 0xf6fdff, width: 2, alpha: 0.95 });
      }
      root.addChild(ring);

      if (entity.kind === "building") {
        const glow = new PIXI.Graphics();
        glow.roundRect(-Math.round(tileSize * 0.24), -Math.round(tileSize * 0.24), Math.round(tileSize * 0.48), Math.round(tileSize * 0.48), 8);
        glow.fill({ color: 0xffdf95, alpha: 0.13 });
        root.addChild(glow);
      }

      const hpPct = clampPercent(entity.hp, entity.hpMax);
      const barrierPct = clampPercent(entity.barrier, entity.hpMax);

      if (entity.hpMax && entity.hpMax > 0) {
        const hpBg = new PIXI.Graphics();
        hpBg.roundRect(-17, 14, 34, 4, 2);
        hpBg.fill({ color: 0x0f1115, alpha: 0.9 });
        root.addChild(hpBg);

        const hpFill = new PIXI.Graphics();
        hpFill.roundRect(-17, 14, Math.max(1, 34 * hpPct), 4, 2);
        hpFill.fill({ color: 0x7ef19b, alpha: 0.95 });
        root.addChild(hpFill);

        if ((entity.barrier ?? 0) > 0) {
          const barrierFill = new PIXI.Graphics();
          barrierFill.roundRect(-17, 19, Math.max(1, 34 * barrierPct), 3, 2);
          barrierFill.fill({ color: 0x89e8ff, alpha: 0.9 });
          root.addChild(barrierFill);
        }
      }

      if ((entity.mpMax ?? 0) > 0 && entity.kind !== "building") {
        const mpPct = clampPercent(entity.mp, entity.mpMax);
        const mpBg = new PIXI.Graphics();
        mpBg.roundRect(-17, 23, 34, 3, 2);
        mpBg.fill({ color: 0x0f1115, alpha: 0.82 });
        root.addChild(mpBg);

        const mpFill = new PIXI.Graphics();
        mpFill.roundRect(-17, 23, Math.max(1, 34 * mpPct), 3, 2);
        mpFill.fill({ color: 0x6fd4ff, alpha: 0.9 });
        root.addChild(mpFill);
      }

      const name = new PIXI.Text({
        text: (minimalCombatLabels || compactCombatLabels)
          ? compactTokenLabel(entity.displayName ?? "", entity.id)
          : (entity.displayName ?? entity.id),
        style: {
          fontFamily: "Verdana, sans-serif",
          fontSize: minimalCombatLabels ? 8 : 9,
          fill: 0xf8fafc,
          fontWeight: "bold",
        },
      });
      name.anchor.set(0.5, 1);
      name.y = -14;
      root.addChild(name);

      const statuses = entity.statuses ?? [];
      if (showStatusChips) {
        const first = statuses[0];
        if (first) {
          const chip = drawMarkerChip(statusShort(first.family), statusColor(first.family), -30);
          chip.x = 16;
          root.addChild(chip);
          if (statuses.length > 1) {
            const overflow = drawMarkerChip(`+${statuses.length - 1}`, 0xcad3de, -18);
            overflow.x = 16;
            root.addChild(overflow);
          }
        }
      }

      const roleText = markerLabel(entity.markerRole);
      if (roleText) {
        const role = drawMarkerChip(roleText, 0xfff3c4, -42);
        role.x = -16;
        root.addChild(role);
      }

      const intentText = intentSymbol(entity.intent);
      if (showIntentChip && intentText && entity.kind !== "building") {
        const intent = drawMarkerChip(intentText, 0xd4d8ff, -42);
        intent.x = 0;
        root.addChild(intent);
      }

      if (!settings.fastMode && entity.kind === "building") {
        const pulse = new PIXI.Graphics();
        const radius = Math.round(tileSize * 0.34);
        pulse.circle(0, 0, radius);
        pulse.stroke({ color: 0xffd991, width: 1.25, alpha: 0.28 });
        root.addChild(pulse);
      }

      this.container.addChild(root);
    }
  }

  getRenderMeta() {
    return this.renderMeta;
  }

  destroy() {
    this.container.destroy({ children: true });
  }
}
