import * as PIXI from "pixi.js";
import { seededRange } from "@/ui/components/mythic/board2/render/deterministic";
import type { RendererSettings, VisualEvent } from "@/ui/components/mythic/board2/render/types";

interface Particle {
  sprite: PIXI.Sprite;
  ageMs: number;
  lifeMs: number;
  vx: number;
  vy: number;
  fade: number;
}

const MAX_PARTICLES = 220;

const EVENT_PARTICLE_STYLE: Partial<Record<VisualEvent["type"], { color: number; count: number; speed: number; lifeMs: number }>> = {
  HitImpact: { color: 0xffb29a, count: 9, speed: 65, lifeMs: 500 },
  MissIndicator: { color: 0xd7e2f2, count: 5, speed: 42, lifeMs: 420 },
  HealImpact: { color: 0x7df5a0, count: 8, speed: 35, lifeMs: 560 },
  StatusApply: { color: 0xd9b6ff, count: 7, speed: 30, lifeMs: 620 },
  StatusApplyMulti: { color: 0xe8c8ff, count: 10, speed: 30, lifeMs: 720 },
  StatusTick: { color: 0x9bd879, count: 6, speed: 26, lifeMs: 500 },
  BarrierGain: { color: 0x90ecff, count: 7, speed: 24, lifeMs: 520 },
  BarrierBreak: { color: 0xffcc8e, count: 8, speed: 36, lifeMs: 580 },
  DeathBurst: { color: 0xff7f95, count: 12, speed: 80, lifeMs: 840 },
  MoveTrail: { color: 0x8fd8ff, count: 4, speed: 22, lifeMs: 360 },
};

export class ParticleSystem {
  readonly container = new PIXI.Container();
  private active: Particle[] = [];
  private pool: PIXI.Sprite[] = [];

  constructor() {
    this.container.eventMode = "none";
  }

  private getParticleSprite(): PIXI.Sprite {
    const cached = this.pool.pop();
    if (cached) return cached;
    const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    sprite.anchor.set(0.5, 0.5);
    return sprite;
  }

  private releaseParticle(particle: Particle) {
    this.container.removeChild(particle.sprite);
    particle.sprite.alpha = 1;
    particle.sprite.scale.set(1, 1);
    this.pool.push(particle.sprite);
  }

  emitFromEvent(event: VisualEvent, anchor: { x: number; y: number }, settings: RendererSettings) {
    if (settings.fastMode) return;
    const style = EVENT_PARTICLE_STYLE[event.type];
    if (!style) return;

    const intensity = settings.reducedMotion ? 0.35 : 1;
    const count = Math.max(1, Math.round(style.count * intensity));
    for (let i = 0; i < count; i += 1) {
      if (this.active.length >= MAX_PARTICLES) {
        const old = this.active.shift();
        if (old) this.releaseParticle(old);
      }

      const angle = seededRange(event.seedKey, 0, Math.PI * 2, `${i}:a`);
      const speed = seededRange(event.seedKey, style.speed * 0.45, style.speed * 1.2, `${i}:s`);
      const lifeMs = seededRange(event.seedKey, style.lifeMs * 0.65, style.lifeMs * 1.15, `${i}:l`);

      const sprite = this.getParticleSprite();
      sprite.tint = style.color;
      sprite.alpha = 0.94;
      sprite.position.set(
        anchor.x + seededRange(event.seedKey, -5, 5, `${i}:x`),
        anchor.y + seededRange(event.seedKey, -5, 5, `${i}:y`),
      );
      sprite.scale.set(
        seededRange(event.seedKey, 1.8, 4.8, `${i}:sx`) / 4,
        seededRange(event.seedKey, 1.8, 4.8, `${i}:sy`) / 4,
      );
      this.container.addChild(sprite);

      this.active.push({
        sprite,
        ageMs: 0,
        lifeMs,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        fade: seededRange(event.seedKey, 0.8, 1.2, `${i}:fade`),
      });
    }
  }

  update(deltaMs: number) {
    if (this.active.length === 0) return;
    const dt = deltaMs / 1000;

    const keep: Particle[] = [];
    for (const particle of this.active) {
      particle.ageMs += deltaMs;
      if (particle.ageMs >= particle.lifeMs) {
        this.releaseParticle(particle);
        continue;
      }

      particle.sprite.x += particle.vx * dt;
      particle.sprite.y += particle.vy * dt;
      particle.vx *= 0.97;
      particle.vy *= 0.97;

      const t = particle.ageMs / particle.lifeMs;
      particle.sprite.alpha = Math.max(0, 1 - (t * particle.fade));
      keep.push(particle);
    }

    this.active = keep;
  }

  activeCount(): number {
    return this.active.length;
  }

  destroy() {
    for (const particle of this.active) {
      this.releaseParticle(particle);
    }
    this.active = [];
    for (const sprite of this.pool) {
      sprite.destroy();
    }
    this.pool = [];
    this.container.destroy({ children: true });
  }
}
