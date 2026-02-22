import * as PIXI from "pixi.js";
import { seededRange } from "@/ui/components/mythic/board2/render/deterministic";
import type { RenderFxImportance, RendererSettings, VisualEvent } from "@/ui/components/mythic/board2/render/types";

interface Particle {
  sprite: PIXI.Sprite;
  ageMs: number;
  lifeMs: number;
  vx: number;
  vy: number;
  fade: number;
}

type ParticleShape = "spark" | "slash" | "bubble" | "ember" | "shard" | "fork";

interface ParticleStyle {
  color: number;
  count: number;
  speed: number;
  lifeMs: number;
  shape: ParticleShape;
  importance: RenderFxImportance;
}

const MAX_PARTICLES_BY_QUALITY: Record<RendererSettings["qualityMode"], number> = {
  max: 340,
  balanced60: 250,
  perf: 140,
};

const EVENT_PARTICLE_STYLE: Partial<Record<VisualEvent["type"], ParticleStyle>> = {
  HitImpact: { color: 0xffb29a, count: 10, speed: 66, lifeMs: 520, shape: "slash", importance: "high" },
  MissIndicator: { color: 0xd7e2f2, count: 5, speed: 42, lifeMs: 430, shape: "shard", importance: "normal" },
  HealImpact: { color: 0x7df5a0, count: 8, speed: 34, lifeMs: 560, shape: "bubble", importance: "normal" },
  StatusApply: { color: 0xd9b6ff, count: 7, speed: 30, lifeMs: 620, shape: "ember", importance: "normal" },
  StatusApplyMulti: { color: 0xe8c8ff, count: 11, speed: 31, lifeMs: 760, shape: "ember", importance: "high" },
  StatusTick: { color: 0x9bd879, count: 6, speed: 24, lifeMs: 500, shape: "bubble", importance: "low" },
  BarrierGain: { color: 0x90ecff, count: 7, speed: 23, lifeMs: 520, shape: "fork", importance: "normal" },
  BarrierBreak: { color: 0xffcc8e, count: 9, speed: 38, lifeMs: 600, shape: "shard", importance: "high" },
  DeathBurst: { color: 0xff7f95, count: 13, speed: 82, lifeMs: 860, shape: "spark", importance: "critical" },
  MoveTrail: { color: 0x8fd8ff, count: 4, speed: 22, lifeMs: 360, shape: "ember", importance: "low" },
};

function importanceScale(level: RenderFxImportance | undefined): number {
  if (level === "critical") return 1.45;
  if (level === "high") return 1.2;
  if (level === "low") return 0.7;
  return 1;
}

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

    const styleImportance = event.fxImportance ?? style.importance;
    const qualityScale = settings.qualityMode === "max" ? 1.12 : settings.qualityMode === "perf" ? 0.65 : 0.9;
    const motionScale = settings.reducedMotion ? 0.38 : 1;
    const importanceBoost = importanceScale(styleImportance);
    const count = Math.max(1, Math.round(style.count * qualityScale * motionScale * importanceBoost));
    const maxParticles = MAX_PARTICLES_BY_QUALITY[settings.qualityMode];

    for (let i = 0; i < count; i += 1) {
      if (this.active.length >= maxParticles) {
        const old = this.active.shift();
        if (old) this.releaseParticle(old);
      }

      const angle = seededRange(event.seedKey, 0, Math.PI * 2, `${i}:a`);
      const speed = seededRange(event.seedKey, style.speed * 0.45, style.speed * 1.2, `${i}:s`);
      const lifeMs = seededRange(event.seedKey, style.lifeMs * 0.65, style.lifeMs * 1.15, `${i}:l`);

      const sprite = this.getParticleSprite();
      sprite.texture = PIXI.Texture.WHITE;
      sprite.tint = style.color;
      sprite.alpha = 0.94;
      sprite.position.set(
        anchor.x + seededRange(event.seedKey, -5, 5, `${i}:x`),
        anchor.y + seededRange(event.seedKey, -5, 5, `${i}:y`),
      );
      const baseScale = seededRange(event.seedKey, 0.6, 1.6, `${i}:scale`);
      if (style.shape === "slash") {
        sprite.scale.set(baseScale * 1.8, baseScale * 0.34);
      } else if (style.shape === "bubble") {
        sprite.scale.set(baseScale * 0.72, baseScale * 0.72);
      } else if (style.shape === "fork") {
        sprite.scale.set(baseScale * 0.4, baseScale * 1.3);
      } else if (style.shape === "shard") {
        sprite.scale.set(baseScale * 0.8, baseScale * 0.5);
      } else {
        sprite.scale.set(baseScale * 0.58, baseScale * 0.58);
      }
      sprite.rotation = seededRange(event.seedKey, -Math.PI, Math.PI, `${i}:rot`);
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
      particle.vx *= 0.965;
      particle.vy *= 0.965;

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
