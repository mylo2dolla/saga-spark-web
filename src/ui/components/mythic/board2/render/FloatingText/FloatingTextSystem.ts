import * as PIXI from "pixi.js";
import { seededRange } from "@/ui/components/mythic/board2/render/deterministic";
import type { RendererSettings, VisualEvent } from "@/ui/components/mythic/board2/render/types";

interface FloatingTextNode {
  text: PIXI.Text;
  ageMs: number;
  lifeMs: number;
  vy: number;
  pulse: boolean;
  bounce: boolean;
}

const MAX_FLOATING_TEXT = 48;

function styleForEvent(event: VisualEvent): { text: string; fill: number; size: number; lifeMs: number; weight: "normal" | "bold"; pulse: boolean; bounce: boolean } | null {
  if (event.type === "DamageNumber") {
    const compact = (event.compressed || (event.hitCount ?? 1) > 1)
      ? `x${Math.max(2, event.hitCount ?? 2)} -${Math.max(0, Math.floor(event.totalDamage ?? event.amount))}`
      : `-${Math.max(0, Math.floor(event.amount))}`;
    return {
      text: compact,
      fill: event.isCrit ? 0xfff39a : 0xffb4a4,
      size: event.isCrit ? 18 : 14,
      lifeMs: event.isCrit ? 920 : 760,
      weight: "bold",
      pulse: false,
      bounce: event.isCrit === true,
    };
  }
  if (event.type === "HealNumber") {
    return {
      text: `+${Math.max(0, Math.floor(event.amount))}`,
      fill: 0x8ff3a7,
      size: 14,
      lifeMs: 920,
      weight: "bold",
      pulse: true,
      bounce: false,
    };
  }
  if (event.type === "MissIndicator") {
    return {
      text: "MISS",
      fill: 0xe8edf8,
      size: 13,
      lifeMs: 760,
      weight: "bold",
      pulse: false,
      bounce: false,
    };
  }
  if (event.type === "BarrierBreak") {
    return {
      text: "BLOCK",
      fill: 0xffcf94,
      size: 12,
      lifeMs: 700,
      weight: "bold",
      pulse: false,
      bounce: false,
    };
  }
  if (event.type === "StatusTick") {
    const tick = typeof event.amount === "number" && event.amount > 0 ? `-${event.amount}` : event.statusId.toUpperCase();
    return {
      text: tick,
      fill: 0xbee98b,
      size: 11,
      lifeMs: 680,
      weight: "normal",
      pulse: false,
      bounce: false,
    };
  }
  return null;
}

export class FloatingTextSystem {
  readonly container = new PIXI.Container();
  private active: FloatingTextNode[] = [];
  private pool: PIXI.Text[] = [];

  constructor() {
    this.container.eventMode = "none";
  }

  private getTextNode(): PIXI.Text {
    const cached = this.pool.pop();
    if (cached) return cached;
    const node = new PIXI.Text({ text: "", style: { fontFamily: "Verdana, sans-serif", fontSize: 12, fill: 0xffffff } });
    node.anchor.set(0.5, 1);
    return node;
  }

  private release(node: FloatingTextNode) {
    this.container.removeChild(node.text);
    node.text.alpha = 1;
    node.text.scale.set(1, 1);
    this.pool.push(node.text);
  }

  emit(event: VisualEvent, anchor: { x: number; y: number }, settings: RendererSettings) {
    const style = styleForEvent(event);
    if (!style) return;

    if (this.active.length >= MAX_FLOATING_TEXT) {
      const oldest = this.active.shift();
      if (oldest) this.release(oldest);
    }

    const text = this.getTextNode();
    text.text = style.text;
    text.style = new PIXI.TextStyle({
      fontFamily: "Verdana, sans-serif",
      fontSize: style.size,
      fill: style.fill,
      fontWeight: style.weight,
      stroke: { color: 0x0f1115, width: 2 },
    });

    text.position.set(
      anchor.x + seededRange(event.seedKey, -8, 8, "tx"),
      anchor.y - seededRange(event.seedKey, 8, 22, "ty"),
    );

    if (event.type === "DamageNumber" && event.isCrit && !settings.fastMode) {
      text.scale.set(1.15, 1.15);
    }

    this.container.addChild(text);

    this.active.push({
      text,
      ageMs: 0,
      lifeMs: settings.fastMode ? Math.min(style.lifeMs, 500) : style.lifeMs,
      vy: event.type === "HealNumber" ? 18 : event.type === "MissIndicator" ? 14 : 28,
      pulse: style.pulse,
      bounce: style.bounce,
    });
  }

  update(deltaMs: number) {
    const dt = deltaMs / 1000;
    const keep: FloatingTextNode[] = [];

    for (const node of this.active) {
      node.ageMs += deltaMs;
      if (node.ageMs >= node.lifeMs) {
        this.release(node);
        continue;
      }

      node.text.y -= node.vy * dt;
      if (node.ageMs < 140 && node.bounce) {
        node.text.y -= 12 * dt;
      } else if (node.ageMs < 140) {
        node.text.y -= 6 * dt;
      }
      const t = node.ageMs / node.lifeMs;
      if (node.pulse && t < 0.25) {
        const scale = 1 + (0.14 * (1 - (t / 0.25)));
        node.text.scale.set(scale, scale);
      } else if (!node.bounce || t > 0.25) {
        node.text.scale.set(Math.max(1, 1.06 - (t * 0.08)));
      }
      node.text.alpha = Math.max(0, 1 - t);
      keep.push(node);
    }

    this.active = keep;
  }

  activeCount(): number {
    return this.active.length;
  }

  destroy() {
    for (const node of this.active) this.release(node);
    this.active = [];
    for (const node of this.pool) node.destroy();
    this.pool = [];
    this.container.destroy({ children: true });
  }
}
