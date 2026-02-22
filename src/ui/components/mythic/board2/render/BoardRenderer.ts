import * as PIXI from "pixi.js";
import type {
  RendererSettings,
  RenderSnapshot,
  RendererDebugState,
  VisualEvent,
} from "@/ui/components/mythic/board2/render/types";
import { AssetManager } from "@/ui/components/mythic/board2/render/AssetManager";
import { biomeSkinFor, pickBiomeProps } from "@/ui/components/mythic/board2/render/BiomeSkinRegistry";
import { EntityRenderer } from "@/ui/components/mythic/board2/render/EntityRenderer";
import { TelegraphRenderer } from "@/ui/components/mythic/board2/render/TelegraphRenderer";
import { ParticleSystem } from "@/ui/components/mythic/board2/render/Particles/ParticleSystem";
import { FloatingTextSystem } from "@/ui/components/mythic/board2/render/FloatingText/FloatingTextSystem";
import { CameraDirector } from "@/ui/components/mythic/board2/render/CameraDirector";
import { TransitionDirector } from "@/ui/components/mythic/board2/render/TransitionDirector";
import { DevOverlay } from "@/ui/components/mythic/board2/render/DevOverlay";

interface TimedDisplay {
  display: PIXI.Container;
  ageMs: number;
  lifeMs: number;
}

function defaultSettings(): RendererSettings {
  return {
    fastMode: false,
    cinematicCamera: true,
    showDevOverlay: false,
    reducedMotion: false,
  };
}

function tileCenter(snapshot: RenderSnapshot, tile: { x: number; y: number }): { x: number; y: number } {
  const size = snapshot.board.tileSize;
  return {
    x: (tile.x * size) + (size / 2),
    y: (tile.y * size) + (size / 2),
  };
}

function entityCenter(snapshot: RenderSnapshot, entityId: string | undefined): { x: number; y: number } | null {
  if (!entityId) return null;
  const entity = snapshot.entities.find((entry) => entry.id === entityId);
  if (!entity) return null;
  return tileCenter(snapshot, { x: entity.x, y: entity.y });
}

export class BoardRenderer {
  readonly app: PIXI.Application;
  readonly canvas: HTMLCanvasElement;

  private root = new PIXI.Container();
  private world = new PIXI.Container();

  private tilesLayer = new PIXI.Container();
  private terrainLayer = new PIXI.Container();
  private propsLayer = new PIXI.Container();
  private vfxLayer = new PIXI.Container();
  private uiLayer = new PIXI.Container();
  private transitionLayer = new PIXI.Graphics();

  private assetManager: AssetManager;
  private entityRenderer = new EntityRenderer();
  private telegraphRenderer = new TelegraphRenderer();
  private particles = new ParticleSystem();
  private floatingText = new FloatingTextSystem();
  private camera = new CameraDirector();
  private transitions = new TransitionDirector();
  private devOverlay = new DevOverlay();

  private settings: RendererSettings;
  private snapshot: RenderSnapshot | null = null;
  private pendingEvents: VisualEvent[] = [];
  private consumedEventIds = new Set<string>();
  private activeTimed: TimedDisplay[] = [];

  private needsStaticRedraw = true;
  private fpsWindow: number[] = [];
  private debugState: RendererDebugState = {
    fps: 0,
    drawCalls: 0,
    eventTimeline: [],
    queueDepth: 0,
    activeParticles: 0,
    activeFloatingTexts: 0,
    cameraScale: 1,
    cameraShakeMs: 0,
  };

  private eventAccumulatorMs = 0;

  private constructor(app: PIXI.Application, canvas: HTMLCanvasElement, settings?: Partial<RendererSettings>) {
    this.app = app;
    this.canvas = canvas;
    this.settings = { ...defaultSettings(), ...(settings ?? {}) };
    this.assetManager = new AssetManager(app.renderer);

    this.root.eventMode = "none";
    this.world.eventMode = "none";
    this.tilesLayer.eventMode = "none";
    this.terrainLayer.eventMode = "none";
    this.propsLayer.eventMode = "none";
    this.vfxLayer.eventMode = "none";
    this.uiLayer.eventMode = "none";

    this.world.addChild(this.tilesLayer);
    this.world.addChild(this.terrainLayer);
    this.world.addChild(this.propsLayer);
    this.world.addChild(this.entityRenderer.container);
    this.world.addChild(this.telegraphRenderer.container);
    this.world.addChild(this.vfxLayer);
    this.world.addChild(this.particles.container);
    this.world.addChild(this.floatingText.container);
    this.world.addChild(this.uiLayer);

    this.root.addChild(this.world);
    this.root.addChild(this.transitionLayer);
    this.root.addChild(this.devOverlay.container);

    this.app.stage.addChild(this.root);
  }

  static async mount(host: HTMLElement, settings?: Partial<RendererSettings>): Promise<BoardRenderer> {
    const app = new PIXI.Application();
    await app.init({
      width: Math.max(300, Math.floor(host.clientWidth || 320)),
      height: Math.max(260, Math.floor(host.clientHeight || 300)),
      antialias: true,
      backgroundAlpha: 0,
      autoDensity: true,
      resolution: window.devicePixelRatio || 1,
      autoStart: false,
      sharedTicker: false,
    });
    host.appendChild(app.canvas);
    return new BoardRenderer(app, app.canvas as HTMLCanvasElement, settings);
  }

  setSettings(next: Partial<RendererSettings>) {
    this.settings = { ...this.settings, ...next };
  }

  setSnapshot(snapshot: RenderSnapshot) {
    const previousType = this.snapshot?.board.type;
    this.snapshot = snapshot;
    this.needsStaticRedraw = true;

    const worldW = snapshot.board.width * snapshot.board.tileSize;
    const worldH = snapshot.board.height * snapshot.board.tileSize;
    this.camera.setWorld(worldW, worldH);

    if (previousType && previousType !== snapshot.board.type) {
      this.transitions.start(previousType, snapshot.board.type, this.settings);
      this.consumedEventIds.clear();
    }

    const active = snapshot.entities.find((entity) => entity.isActive);
    if (active) {
      const center = tileCenter(snapshot, { x: active.x, y: active.y });
      this.camera.focus(center.x, center.y);
    }
  }

  enqueueEvents(events: VisualEvent[]) {
    if (!Array.isArray(events) || events.length === 0) return;
    for (const event of events) {
      if (this.consumedEventIds.has(event.id)) continue;
      this.pendingEvents.push(event);
    }
    this.pendingEvents.sort((a, b) => {
      if (a.tick !== b.tick) return a.tick - b.tick;
      if (a.sequence !== b.sequence) return a.sequence - b.sequence;
      if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
      return a.id.localeCompare(b.id);
    });
  }

  resize(width: number, height: number) {
    this.app.renderer.resize(Math.max(300, Math.floor(width)), Math.max(260, Math.floor(height)));
    this.camera.setViewport(this.app.renderer.width, this.app.renderer.height);
    this.needsStaticRedraw = true;
  }

  screenToTile(screenX: number, screenY: number): { x: number; y: number } | null {
    if (!this.snapshot) return null;
    const scale = this.world.scale.x || 1;
    const localX = (screenX - this.world.x) / scale;
    const localY = (screenY - this.world.y) / scale;
    if (localX < 0 || localY < 0) return null;
    const x = Math.floor(localX / this.snapshot.board.tileSize);
    const y = Math.floor(localY / this.snapshot.board.tileSize);
    if (x < 0 || y < 0 || x >= this.snapshot.board.width || y >= this.snapshot.board.height) return null;
    return { x, y };
  }

  private drawTilesAndTerrain(snapshot: RenderSnapshot) {
    this.tilesLayer.removeChildren();
    this.terrainLayer.removeChildren();

    const tileSize = snapshot.board.tileSize;
    const skin = biomeSkinFor(snapshot.board.biomeId);

    const backdrop = new PIXI.Graphics();
    backdrop.rect(0, 0, snapshot.board.width * tileSize, snapshot.board.height * tileSize);
    backdrop.fill({ color: skin.tileBase, alpha: 1 });
    this.tilesLayer.addChild(backdrop);

    for (const tile of snapshot.tiles) {
      const x = tile.x * tileSize;
      const y = tile.y * tileSize;
      const base = tile.biomeVariant === "alt" ? skin.tileAlt : tile.biomeVariant === "path" ? skin.road : skin.tileBase;

      const cell = new PIXI.Graphics();
      cell.rect(x, y, tileSize, tileSize);
      cell.fill({ color: base, alpha: 0.95 });

      if (tile.overlays?.includes("water")) {
        cell.roundRect(x + 4, y + 4, tileSize - 8, tileSize - 8, 4);
        cell.fill({ color: skin.water, alpha: 0.35 });
      }
      if (tile.overlays?.includes("hazard")) {
        cell.roundRect(x + 5, y + 5, tileSize - 10, tileSize - 10, 4);
        cell.fill({ color: skin.hazard, alpha: 0.27 });
      }
      if (tile.isBlocked) {
        cell.moveTo(x + 6, y + 6);
        cell.lineTo(x + tileSize - 6, y + tileSize - 6);
        cell.moveTo(x + tileSize - 6, y + 6);
        cell.lineTo(x + 6, y + tileSize - 6);
        cell.stroke({ color: 0xf9b6ba, width: 2, alpha: 0.55 });
      }
      cell.rect(x, y, tileSize, tileSize);
      cell.stroke({ color: skin.grid, width: 1, alpha: 0.18 });
      this.tilesLayer.addChild(cell);
    }
  }

  private drawProps(snapshot: RenderSnapshot) {
    this.propsLayer.removeChildren();
    const tileSize = snapshot.board.tileSize;

    const biomeProps = pickBiomeProps(snapshot);
    for (const prop of biomeProps) {
      const g = new PIXI.Graphics();
      const px = (prop.x * tileSize) + (tileSize / 2);
      const py = (prop.y * tileSize) + (tileSize / 2);
      g.circle(px, py, tileSize * 0.16);
      g.fill({ color: prop.tint, alpha: 0.28 });
      g.stroke({ color: 0xfaf6e0, width: 1, alpha: 0.25 });
      this.propsLayer.addChild(g);
    }
  }

  private drawUiMarkers(snapshot: RenderSnapshot) {
    this.uiLayer.removeChildren();
    const tileSize = snapshot.board.tileSize;
    for (const marker of snapshot.uiOverlays) {
      const x = (marker.x * tileSize) + 2;
      const y = (marker.y * tileSize) + 2;
      const box = new PIXI.Graphics();
      box.roundRect(x, y, 18, 12, 3);
      box.fill({ color: 0x0f1115, alpha: 0.6 });
      box.stroke({ color: 0xfde68a, width: 1, alpha: 0.45 });
      this.uiLayer.addChild(box);

      const text = new PIXI.Text({
        text: marker.type === "danger" ? "!" : marker.type === "merchant" ? "$" : marker.type === "healer" ? "+" : "?",
        style: {
          fontFamily: "Verdana, sans-serif",
          fontSize: 9,
          fill: 0xfbf2ce,
          fontWeight: "bold",
        },
      });
      text.anchor.set(0.5, 0.5);
      text.position.set(x + 9, y + 6);
      this.uiLayer.addChild(text);
    }
  }

  private addTimedDisplay(display: PIXI.Container, lifeMs: number) {
    this.vfxLayer.addChild(display);
    this.activeTimed.push({ display, ageMs: 0, lifeMs });
  }

  private processEvent(event: VisualEvent) {
    if (!this.snapshot) return;
    this.consumedEventIds.add(event.id);
    this.debugState.eventTimeline.push(event);
    this.debugState.eventTimeline = this.debugState.eventTimeline.slice(-40);

    if (event.type === "BoardTransition") {
      this.transitions.start(event.fromBoardType, event.toBoardType, this.settings);
      return;
    }

    if (event.type === "TurnStart" && event.actorId) {
      const center = entityCenter(this.snapshot, event.actorId);
      if (center) this.camera.focus(center.x, center.y);
    }

    const anchor = (() => {
      if ("tile" in event && event.tile) return tileCenter(this.snapshot as RenderSnapshot, event.tile);
      if ("targetTile" in event && event.targetTile) return tileCenter(this.snapshot as RenderSnapshot, event.targetTile);
      if ("targetId" in event && event.targetId) return entityCenter(this.snapshot as RenderSnapshot, event.targetId);
      if ("entityId" in event && event.entityId) return entityCenter(this.snapshot as RenderSnapshot, event.entityId);
      if ("actorId" in event && event.actorId) return entityCenter(this.snapshot as RenderSnapshot, event.actorId);
      return null;
    })();

    if (anchor) {
      this.particles.emitFromEvent(event, anchor, this.settings);
      this.floatingText.emit(event, anchor, this.settings);
    }

    if (event.type === "MoveTrail") {
      const line = new PIXI.Graphics();
      const from = tileCenter(this.snapshot, event.from);
      const to = tileCenter(this.snapshot, event.to);
      line.moveTo(from.x, from.y);
      line.lineTo(to.x, to.y);
      line.stroke({ color: 0x9be5ff, width: 2, alpha: 0.8 });
      this.addTimedDisplay(line, Math.min(900, Math.max(520, event.durationMs)));
    }

    if (event.type === "AttackWindup") {
      const source = entityCenter(this.snapshot, event.attackerId);
      const target = event.targetTile ? tileCenter(this.snapshot, event.targetTile) : null;
      if (source && target) {
        const line = new PIXI.Graphics();
        line.moveTo(source.x, source.y);
        line.lineTo(target.x, target.y);
        line.stroke({ color: 0xf6e2b8, width: 1.6, alpha: 0.72 });
        this.addTimedDisplay(line, 260);
      }
    }

    if (event.type === "HitImpact") {
      this.camera.onHitImpact(Math.min(1, Math.max(0, event.damage / 120)), event.seedKey, this.settings);
      const flash = new PIXI.Graphics();
      flash.circle(anchor?.x ?? 0, anchor?.y ?? 0, 10);
      flash.fill({ color: 0xffb09c, alpha: 0.4 });
      this.addTimedDisplay(flash, 280);
    }

    if (event.type === "HealImpact") {
      this.camera.onHealImpact(Math.min(1, Math.max(0, event.amount / 80)), this.settings);
      const pulse = new PIXI.Graphics();
      pulse.circle(anchor?.x ?? 0, anchor?.y ?? 0, 11);
      pulse.fill({ color: 0x9afab6, alpha: 0.34 });
      this.addTimedDisplay(pulse, 340);
    }

    if (event.type === "MissIndicator") {
      const miss = new PIXI.Graphics();
      miss.rect((anchor?.x ?? 0) - 8, (anchor?.y ?? 0) - 1, 16, 2);
      miss.fill({ color: 0xe9eef7, alpha: 0.7 });
      this.addTimedDisplay(miss, 360);
    }

    if (event.type === "DeathBurst" || event.type === "Downed") {
      const burst = new PIXI.Graphics();
      burst.circle(anchor?.x ?? 0, anchor?.y ?? 0, 14);
      burst.stroke({ color: 0xff8ca6, width: 2, alpha: 0.9 });
      this.addTimedDisplay(burst, 700);
    }

    if (event.type === "TurnStart" || event.type === "TurnEnd") {
      const boardPulse = new PIXI.Graphics();
      if (this.snapshot) {
        boardPulse.rect(0, 0, this.snapshot.board.width * this.snapshot.board.tileSize, this.snapshot.board.height * this.snapshot.board.tileSize);
      }
      boardPulse.fill({ color: event.type === "TurnStart" ? 0x8be5ff : 0xfad28c, alpha: 0.08 });
      this.addTimedDisplay(boardPulse, 240);
    }
  }

  tick(deltaMs: number) {
    if (!this.snapshot) return;

    const frameMs = Math.max(1, deltaMs);
    this.fpsWindow.push(frameMs);
    if (this.fpsWindow.length > 60) this.fpsWindow.shift();
    const avgMs = this.fpsWindow.reduce((acc, value) => acc + value, 0) / this.fpsWindow.length;
    this.debugState.fps = avgMs > 0 ? 1000 / avgMs : 0;

    this.camera.setViewport(this.app.renderer.width, this.app.renderer.height);

    if (this.needsStaticRedraw) {
      this.drawTilesAndTerrain(this.snapshot);
      this.drawProps(this.snapshot);
      this.needsStaticRedraw = false;
    }

    this.entityRenderer.render(this.snapshot, this.assetManager, this.settings);
    this.telegraphRenderer.render(this.snapshot);
    this.drawUiMarkers(this.snapshot);

    const cadence = this.settings.fastMode ? 44 : 110;
    this.eventAccumulatorMs += frameMs;
    while (this.eventAccumulatorMs >= cadence && this.pendingEvents.length > 0) {
      this.eventAccumulatorMs -= cadence;
      const next = this.pendingEvents.shift() as VisualEvent;
      this.processEvent(next);
    }

    const keep: TimedDisplay[] = [];
    for (const timed of this.activeTimed) {
      timed.ageMs += frameMs;
      if (timed.ageMs >= timed.lifeMs) {
        this.vfxLayer.removeChild(timed.display);
        timed.display.destroy();
        continue;
      }
      const alpha = Math.max(0, 1 - (timed.ageMs / timed.lifeMs));
      timed.display.alpha = alpha;
      keep.push(timed);
    }
    this.activeTimed = keep;

    this.particles.update(frameMs);
    this.floatingText.update(frameMs);
    this.transitions.update(frameMs);
    this.transitions.drawOverlay(this.transitionLayer, this.app.renderer.width, this.app.renderer.height);

    const transform = this.camera.update(frameMs, this.settings);
    this.camera.applyTo(this.world, transform);
    const cameraDebug = this.camera.debugState();

    this.debugState.drawCalls = this.app.stage.children.length + this.world.children.length;
    this.debugState.queueDepth = this.pendingEvents.length;
    this.debugState.activeParticles = this.particles.activeCount();
    this.debugState.activeFloatingTexts = this.floatingText.activeCount();
    this.debugState.cameraScale = cameraDebug.scale;
    this.debugState.cameraShakeMs = cameraDebug.shakeMs;

    this.devOverlay.render(this.snapshot, this.debugState, this.settings.showDevOverlay);
    this.app.render();
  }

  getDebugState(): RendererDebugState {
    return {
      fps: this.debugState.fps,
      drawCalls: this.debugState.drawCalls,
      eventTimeline: [...this.debugState.eventTimeline],
      queueDepth: this.debugState.queueDepth,
      activeParticles: this.debugState.activeParticles,
      activeFloatingTexts: this.debugState.activeFloatingTexts,
    };
  }

  destroy() {
    this.entityRenderer.destroy();
    this.telegraphRenderer.destroy();
    this.particles.destroy();
    this.floatingText.destroy();
    this.devOverlay.destroy();
    this.assetManager.destroy();
    this.app.destroy(true, { children: true, texture: false, textureSource: false, context: false });
  }
}
