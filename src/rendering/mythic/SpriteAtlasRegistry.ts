import { Rectangle, SCALE_MODES, Texture } from "pixi.js";

export interface MythicAtlasFrame {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MythicAtlasAnimation {
  key: string;
  frames: string[];
  fps: number;
  loop: boolean;
}

export interface MythicAtlasManifest {
  id: string;
  image: string;
  tileSize: number;
  frames: MythicAtlasFrame[];
  animations: MythicAtlasAnimation[];
}

type AtlasId = "town" | "travel" | "dungeon" | "combat";

const ATLAS_MANIFEST_URLS: Record<AtlasId, string> = {
  town: new URL("./assets/atlasTown.json", import.meta.url).toString(),
  travel: new URL("./assets/atlasTravel.json", import.meta.url).toString(),
  dungeon: new URL("./assets/atlasDungeon.json", import.meta.url).toString(),
  combat: new URL("./assets/atlasCombat.json", import.meta.url).toString(),
};

export class SpriteAtlasRegistry {
  private manifests = new Map<string, MythicAtlasManifest>();
  private textures = new Map<string, Texture>();
  private loads = new Map<string, Promise<MythicAtlasManifest>>();

  async loadFromUrl(id: string, url: string): Promise<MythicAtlasManifest> {
    if (this.manifests.has(id)) return this.manifests.get(id)!;

    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Failed to load atlas manifest ${id}: ${response.status}`);
    }

    const data = (await response.json()) as MythicAtlasManifest;
    this.manifests.set(id, data);
    return data;
  }

  async ensureLoaded(id: AtlasId): Promise<MythicAtlasManifest> {
    const existing = this.manifests.get(id);
    if (existing) return existing;

    const pending = this.loads.get(id);
    if (pending) return pending;

    const url = ATLAS_MANIFEST_URLS[id];
    const load = this.loadFromUrl(id, url).finally(() => {
      this.loads.delete(id);
    });
    this.loads.set(id, load);
    return load;
  }

  register(manifest: MythicAtlasManifest) {
    this.manifests.set(manifest.id, manifest);
  }

  getManifest(id: string): MythicAtlasManifest | null {
    return this.manifests.get(id) ?? null;
  }

  getFrame(id: string, key: string): MythicAtlasFrame | null {
    const manifest = this.manifests.get(id);
    if (!manifest) return null;
    return manifest.frames.find((frame) => frame.key === key) ?? null;
  }

  getAnimation(id: string, key: string): MythicAtlasAnimation | null {
    const manifest = this.manifests.get(id);
    if (!manifest) return null;
    return manifest.animations.find((animation) => animation.key === key) ?? null;
  }

  getTexture(id: string, key: string): Texture | null {
    const manifest = this.manifests.get(id);
    if (!manifest) return null;
    const frame = manifest.frames.find((entry) => entry.key === key);
    if (!frame) return null;
    const cacheKey = `${id}:${key}`;
    const cached = this.textures.get(cacheKey);
    if (cached) return cached;
    const base = Texture.from(manifest.image).baseTexture;
    base.scaleMode = SCALE_MODES.NEAREST;
    const texture = new Texture(base, new Rectangle(frame.x, frame.y, frame.w, frame.h));
    this.textures.set(cacheKey, texture);
    return texture;
  }

  getFirstTexture(atlasIds: string[], frameKeys: string[]): Texture | null {
    for (const atlasId of atlasIds) {
      for (const frameKey of frameKeys) {
        const texture = this.getTexture(atlasId, frameKey);
        if (texture) return texture;
      }
    }
    return null;
  }
}

export const mythicSpriteAtlasRegistry = new SpriteAtlasRegistry();
