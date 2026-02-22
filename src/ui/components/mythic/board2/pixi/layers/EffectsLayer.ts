import * as PIXI from "pixi.js";
import type { RenderSnapshot, VisualEvent } from "@/ui/components/mythic/board2/pixi/renderTypes";

const MAX_FLOATING = 8;
const MAX_TRAILS = 6;
const DELTA_MIN_MS = 650;
const DELTA_MAX_MS = 900;
const TRAIL_MS = 900;

function parseMs(value: string): number {
  const parsed = Number(new Date(value));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function durationForEvent(event: VisualEvent): number {
  if (event.type === "StatusApply" || event.type === "StatusTick" || event.type === "DeathBurst") return DELTA_MAX_MS;
  if (event.type === "MoveTrail") return TRAIL_MS;
  return DELTA_MIN_MS;
}

function entityCenter(snapshot: RenderSnapshot, entityId: string | null | undefined): { x: number; y: number } | null {
  if (!entityId) return null;
  const hit = snapshot.entities.find((entity) => entity.id === entityId);
  if (!hit) return null;
  const tileSize = snapshot.board.tileSize;
  return {
    x: hit.x * tileSize + (tileSize / 2),
    y: hit.y * tileSize + (tileSize / 2),
  };
}

function floatingColor(event: VisualEvent): number {
  if (event.type === "DamageNumber" || event.type === "HitImpact" || event.type === "StatusTick") return 0xff9db0;
  if (event.type === "HealNumber") return 0x9af0ac;
  if (event.type === "MissIndicator") return 0xf7e8bc;
  if (event.type === "BarrierGain") return 0x9ee9ff;
  if (event.type === "BarrierBreak") return 0xffcbb4;
  return 0xf9f3df;
}

function floatingLabel(event: VisualEvent): string | null {
  if (event.type === "DamageNumber") return `-${event.amount}`;
  if (event.type === "HealNumber") return `+${event.amount}`;
  if (event.type === "MissIndicator") return "MISS";
  if (event.type === "StatusApply") return event.label;
  if (event.type === "StatusTick") return event.amount !== null ? `${event.label} -${event.amount}` : event.label;
  if (event.type === "BarrierGain") return event.amount !== null ? `Barrier +${event.amount}` : event.label;
  if (event.type === "BarrierBreak") return "Barrier Break";
  if (event.type === "DeathBurst") return "DOWN";
  return null;
}

export function drawEffectsLayer(snapshot: RenderSnapshot, nowMs: number, reducedMotion: boolean): PIXI.Container {
  const layer = new PIXI.Container();
  layer.eventMode = "none";

  const events = Array.isArray(snapshot.effects.queue) ? snapshot.effects.queue : [];
  if (events.length === 0) return layer;

  const active = events
    .map((event) => {
      const createdAt = parseMs(event.createdAt);
      const age = nowMs - createdAt;
      const duration = durationForEvent(event);
      if (age < 0 || age > duration) return null;
      const alpha = reducedMotion ? 0.9 : Math.max(0, Math.min(1, 1 - (age / duration)));
      return {
        event,
        age,
        alpha,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  const trails = active.filter((entry) => entry.event.type === "MoveTrail").slice(-MAX_TRAILS);
  for (const item of trails) {
    const event = item.event;
    if (event.type !== "MoveTrail") continue;
    const tileSize = snapshot.board.tileSize;
    const x1 = event.from.x * tileSize + (tileSize / 2);
    const y1 = event.from.y * tileSize + (tileSize / 2);
    const x2 = event.to.x * tileSize + (tileSize / 2);
    const y2 = event.to.y * tileSize + (tileSize / 2);

    const line = new PIXI.Graphics();
    line.lineStyle(2, 0xa5ecff, item.alpha);
    line.moveTo(x1, y1);
    line.lineTo(x2, y2);
    layer.addChild(line);

    const tip = new PIXI.Graphics();
    tip.beginFill(0xe7fbff, item.alpha);
    tip.drawCircle(x2, y2, 2.5);
    tip.endFill();
    layer.addChild(tip);
  }

  const floating = active
    .filter((entry) => entry.event.type !== "MoveTrail")
    .slice(-MAX_FLOATING);

  for (const item of floating) {
    const event = item.event;
    const targetId = "targetId" in event ? event.targetId : "actorId" in event ? event.actorId : null;
    const center = entityCenter(snapshot, targetId);
    if (!center) continue;

    if (event.type === "HitImpact") {
      const impact = new PIXI.Graphics();
      impact.beginFill(0xffc3cf, 0.24 * item.alpha);
      impact.drawCircle(center.x, center.y, 10 + Math.floor(item.age / 110));
      impact.endFill();
      layer.addChild(impact);
    }

    const label = floatingLabel(event);
    if (!label) continue;
    const text = new PIXI.Text({
      text: label,
      style: {
        fontSize: event.type === "DamageNumber" ? 13 : 11,
        fill: floatingColor(event),
        fontFamily: "Verdana, sans-serif",
        fontWeight: event.type === "DamageNumber" ? "bold" : "normal",
      },
    });
    text.anchor.set(0.5, 1);
    text.x = center.x;
    text.y = center.y - 10 - (reducedMotion ? 0 : Math.round(item.age / 30));
    text.alpha = item.alpha;
    layer.addChild(text);
  }

  return layer;
}
