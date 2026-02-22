import * as PIXI from "pixi.js";

export interface SpriteAtlasEntry {
  alias: string;
  url: string;
}

export class AssetManager {
  private renderer: PIXI.Renderer;
  private textures = new Map<string, PIXI.Texture>();
  private fallbackTextures = new Map<string, PIXI.Texture>();

  constructor(renderer: PIXI.Renderer) {
    this.renderer = renderer;
  }

  async loadAtlas(entries: SpriteAtlasEntry[]): Promise<void> {
    if (!Array.isArray(entries) || entries.length === 0) return;
    for (const entry of entries) {
      try {
        const loaded = await PIXI.Assets.load(entry.url);
        if (loaded instanceof PIXI.Texture) {
          this.textures.set(entry.alias, loaded);
          continue;
        }
        if (loaded && typeof loaded === "object") {
          const record = loaded as Record<string, unknown>;
          for (const [key, value] of Object.entries(record)) {
            if (value instanceof PIXI.Texture) {
              this.textures.set(`${entry.alias}:${key}`, value);
            }
          }
        }
      } catch {
        // non-fatal: renderer uses deterministic fallback shapes if assets are missing
      }
    }
  }

  getTextureOrFallback(spriteId: string | undefined, fallbackKind: string, tint: number): PIXI.Texture {
    if (spriteId) {
      const texture = this.textures.get(spriteId);
      if (texture) return texture;
    }
    const key = `${fallbackKind}:${tint.toString(16)}`;
    const cached = this.fallbackTextures.get(key);
    if (cached) return cached;

    const size = 48;
    const g = new PIXI.Graphics();
    g.roundRect(0, 0, size, size, 10);
    g.fill({ color: tint, alpha: 0.85 });
    g.roundRect(4, 4, size - 8, size - 8, 8);
    g.stroke({ color: 0xfef3c7, alpha: 0.55, width: 1.5 });

    const icon = new PIXI.Text({
      text: fallbackKind.slice(0, 1).toUpperCase(),
      style: {
        fontFamily: "Verdana, sans-serif",
        fontSize: 20,
        fill: 0xf8fafc,
        fontWeight: "bold",
      },
    });
    icon.anchor.set(0.5, 0.5);
    icon.x = size / 2;
    icon.y = size / 2;
    g.addChild(icon);

    const texture = this.renderer.generateTexture({
      target: g,
      frame: new PIXI.Rectangle(0, 0, size, size),
      resolution: 1,
      antialias: true,
    });
    g.destroy({ children: true });
    this.fallbackTextures.set(key, texture);
    return texture;
  }

  destroy() {
    for (const texture of this.fallbackTextures.values()) {
      texture.destroy(true);
    }
    this.fallbackTextures.clear();
    this.textures.clear();
  }
}
