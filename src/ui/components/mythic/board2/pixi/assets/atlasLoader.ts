import * as PIXI from "pixi.js";

const fallbackTextureCache = new Map<string, PIXI.Texture>();

export function getFallbackTexture(args: {
  renderer: PIXI.Renderer;
  key: string;
  color: number;
  alpha?: number;
  size?: number;
}): PIXI.Texture {
  const cacheKey = `${args.key}:${args.color}:${args.alpha ?? 1}:${args.size ?? 32}`;
  const cached = fallbackTextureCache.get(cacheKey);
  if (cached) return cached;

  const size = Math.max(8, Math.floor(args.size ?? 32));
  const graphics = new PIXI.Graphics();
  graphics.beginFill(args.color, args.alpha ?? 1);
  graphics.drawRoundedRect(0, 0, size, size, Math.max(2, Math.floor(size * 0.12)));
  graphics.endFill();

  const texture = args.renderer.generateTexture({
    target: graphics,
    frame: new PIXI.Rectangle(0, 0, size, size),
    resolution: 1,
    antialias: false,
  });
  graphics.destroy();
  fallbackTextureCache.set(cacheKey, texture);
  return texture;
}

export function clearFallbackTextures() {
  for (const texture of fallbackTextureCache.values()) {
    texture.destroy(true);
  }
  fallbackTextureCache.clear();
}
