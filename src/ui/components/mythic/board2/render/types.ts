export type RenderBoardType = "town" | "travel" | "combat" | "dungeon";

export type BiomeSkinId =
  | "town_cobble_lantern"
  | "forest_green_fireflies"
  | "dungeon_stone_torch"
  | "plains_road_dust"
  | "snow_frost_mist"
  | "desert_heat_shimmer";

export interface RenderLighting {
  tint: number;
  vignetteAlpha: number;
  fogAlpha: number;
  saturation: number;
}

export interface RenderBoardMeta {
  id: string;
  type: RenderBoardType;
  width: number;
  height: number;
  tileSize: number;
  biomeId: BiomeSkinId;
  tick: number;
  seed: string;
  lighting?: RenderLighting;
}

export type TileOverlayKind =
  | "road"
  | "water"
  | "cliff"
  | "hazard"
  | "fog"
  | "interactable"
  | "aoe"
  | "telegraph"
  | "objective";

export interface RenderTile {
  x: number;
  y: number;
  biomeVariant: "base" | "alt" | "edge" | "path" | "hazard";
  height?: number;
  isWalkable: boolean;
  isBlocked: boolean;
  overlays?: TileOverlayKind[];
}

export interface StatusInstance {
  id: string;
  statusId: string;
  family: "bleed" | "poison" | "burn" | "guard" | "barrier" | "vulnerable" | "stunned" | "buff" | "debuff";
  stacks?: number;
  durationMs?: number;
}

export type EntityIntent =
  | { type: "attack"; targetId?: string; aoeTiles?: Array<{ x: number; y: number }> }
  | { type: "defend" }
  | { type: "cast"; targetTile?: { x: number; y: number }; aoeTiles?: Array<{ x: number; y: number }> }
  | { type: "charge"; targetId?: string }
  | { type: "support"; targetId?: string }
  | { type: "idle" };

export type RenderEntityKind = "player" | "enemy" | "npc" | "building" | "prop";
export type RenderEntityTeam = "ally" | "enemy" | "neutral";

export interface RenderEntity {
  id: string;
  kind: RenderEntityKind;
  team: RenderEntityTeam;
  x: number;
  y: number;
  facing?: "n" | "s" | "e" | "w";
  spriteId?: string;
  displayName?: string;
  fullName?: string;
  hp?: number;
  hpMax?: number;
  barrier?: number;
  mp?: number;
  mpMax?: number;
  statuses?: StatusInstance[];
  intent?: EntityIntent;
  isActive?: boolean;
  isFocused?: boolean;
  markerRole?: "merchant" | "healer" | "quest" | "danger";
}

export interface RenderOverlayMarker {
  id: string;
  type: "quest" | "hot_hook" | "merchant" | "healer" | "danger" | "objective" | "notice" | "gate";
  x: number;
  y: number;
  label: string;
  priority: number;
}

export interface RenderTelegraph {
  id: string;
  kind: "line" | "aoe";
  sourceEntityId?: string;
  targetEntityId?: string;
  targetTile?: { x: number; y: number };
  tiles?: Array<{ x: number; y: number }>;
  style: "imminent" | "queued" | "preview";
}

interface VisualEventBase {
  id: string;
  tick: number;
  createdAt: string;
  sequence: number;
  seedKey: string;
}

export type VisualEvent =
  | (VisualEventBase & {
      type: "MoveTrail";
      entityId: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
      path?: Array<{ x: number; y: number }>;
      durationMs: number;
    })
  | (VisualEventBase & {
      type: "AttackWindup";
      attackerId: string;
      targetTile?: { x: number; y: number };
      style: "melee" | "ranged" | "arcane";
    })
  | (VisualEventBase & {
      type: "HitImpact";
      attackerId: string;
      targetId: string;
      tile: { x: number; y: number };
      damage: number;
      isCrit?: boolean;
      element?: string;
    })
  | (VisualEventBase & {
      type: "MissIndicator";
      attackerId: string;
      targetId: string;
      tile: { x: number; y: number };
      roll?: number;
      threshold?: number;
    })
  | (VisualEventBase & {
      type: "HealImpact";
      sourceId: string;
      targetId: string;
      tile: { x: number; y: number };
      amount: number;
    })
  | (VisualEventBase & {
      type: "DamageNumber";
      targetId: string;
      tile: { x: number; y: number };
      amount: number;
      isCrit?: boolean;
      hitCount?: number;
    })
  | (VisualEventBase & {
      type: "HealNumber";
      targetId: string;
      tile: { x: number; y: number };
      amount: number;
    })
  | (VisualEventBase & {
      type: "StatusApply";
      targetId: string;
      tile: { x: number; y: number };
      statusId: string;
    })
  | (VisualEventBase & {
      type: "StatusApplyMulti";
      targetId: string;
      tile: { x: number; y: number };
      statusIds: string[];
    })
  | (VisualEventBase & {
      type: "StatusTick";
      targetId: string;
      tile: { x: number; y: number };
      statusId: string;
      amount?: number;
    })
  | (VisualEventBase & {
      type: "BarrierGain" | "BarrierBreak";
      targetId: string;
      tile: { x: number; y: number };
      amount?: number;
    })
  | (VisualEventBase & {
      type: "DeathBurst" | "Downed";
      targetId: string;
      tile: { x: number; y: number };
    })
  | (VisualEventBase & {
      type: "TurnStart" | "TurnEnd";
      actorId?: string;
    })
  | (VisualEventBase & {
      type: "BoardTransition";
      fromBoardType: RenderBoardType;
      toBoardType: RenderBoardType;
    });

export interface RenderEffectsQueueState {
  cursor: string | null;
  queue: VisualEvent[];
}

export interface RenderSnapshot {
  board: RenderBoardMeta;
  tiles: RenderTile[];
  entities: RenderEntity[];
  uiOverlays: RenderOverlayMarker[];
  telegraphs: RenderTelegraph[];
  effectsQueue: RenderEffectsQueueState;
}

export interface RenderFrameState {
  boardType: RenderBoardType;
  turnIndex: number;
  cursor: string | null;
}

export interface RendererSettings {
  fastMode: boolean;
  cinematicCamera: boolean;
  showDevOverlay: boolean;
  reducedMotion: boolean;
}

export interface RendererDebugState {
  fps: number;
  drawCalls: number;
  eventTimeline: VisualEvent[];
  queueDepth: number;
  activeParticles: number;
  activeFloatingTexts: number;
  cameraScale?: number;
  cameraShakeMs?: number;
}
