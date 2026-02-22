import type {
  CombatSceneData,
  DungeonSceneData,
  NarrativeBoardSceneModel,
  TownSceneData,
  TravelSceneData,
} from "@/ui/components/mythic/board2/types";
import type {
  BiomeSkinId,
  RenderEntity,
  RenderEntityTeam,
  RenderOverlayMarker,
  RenderSnapshot,
  RenderTelegraph,
  RenderTile,
  RenderBoardType,
} from "@/ui/components/mythic/board2/render/types";
import { hashString, seededFloat } from "@/ui/components/mythic/board2/render/deterministic";
import { biomeSkinFor } from "@/ui/components/mythic/board2/render/BiomeSkinRegistry";

const TILE_SIZE = 48;

function mapBoardType(mode: NarrativeBoardSceneModel["mode"]): RenderBoardType {
  if (mode === "town" || mode === "travel" || mode === "dungeon" || mode === "combat") return mode;
  return "town";
}

function mapBiome(mode: NarrativeBoardSceneModel["mode"], scene: NarrativeBoardSceneModel): BiomeSkinId {
  const seed = scene.layout.seed.toLowerCase();
  if (mode === "town") return "town_cobble_lantern";
  if (mode === "dungeon") return "dungeon_stone_torch";
  if (mode === "combat") {
    if (seed.includes("snow") || seed.includes("frost")) return "snow_frost_mist";
    if (seed.includes("sand") || seed.includes("desert")) return "desert_heat_shimmer";
    if (seed.includes("forest")) return "forest_green_fireflies";
    return "plains_road_dust";
  }
  if (seed.includes("snow") || seed.includes("frost")) return "snow_frost_mist";
  if (seed.includes("sand") || seed.includes("desert")) return "desert_heat_shimmer";
  if (seed.includes("forest")) return "forest_green_fireflies";
  return "plains_road_dust";
}

function hotspotToOverlayType(kind: string): RenderOverlayMarker["type"] {
  if (kind === "vendor") return "merchant";
  if (kind === "notice_board") return "notice";
  if (kind === "gate") return "gate";
  if (kind === "encounter" || kind === "trap") return "danger";
  if (kind === "dungeon_entry") return "hot_hook";
  if (kind === "room" || kind === "door") return "objective";
  return "quest";
}

function statusFamilyFromRaw(raw: string): RenderEntity["statuses"][number]["family"] {
  const key = raw.trim().toLowerCase();
  if (key.includes("bleed")) return "bleed";
  if (key.includes("poison")) return "poison";
  if (key.includes("burn") || key.includes("fire")) return "burn";
  if (key.includes("guard")) return "guard";
  if (key.includes("barrier") || key.includes("armor")) return "barrier";
  if (key.includes("stun")) return "stunned";
  if (key.includes("vulnerable") || key.includes("expose")) return "vulnerable";
  if (key.includes("buff")) return "buff";
  return "debuff";
}

function buildTiles(scene: NarrativeBoardSceneModel, biomeId: BiomeSkinId): RenderTile[] {
  const cols = Math.max(1, Math.floor(scene.grid.cols));
  const rows = Math.max(1, Math.floor(scene.grid.rows));
  const blocked = new Set(scene.grid.blockedTiles.map((tile) => `${Math.floor(tile.x)}:${Math.floor(tile.y)}`));
  const overlays = new Map<string, Set<string>>();

  for (const hotspot of scene.hotspots) {
    const minX = Math.max(0, Math.floor(hotspot.rect.x));
    const minY = Math.max(0, Math.floor(hotspot.rect.y));
    const maxX = Math.min(cols - 1, Math.floor(hotspot.rect.x + hotspot.rect.w - 1));
    const maxY = Math.min(rows - 1, Math.floor(hotspot.rect.y + hotspot.rect.h - 1));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = `${x}:${y}`;
        const bucket = overlays.get(key) ?? new Set<string>();
        bucket.add("interactable");
        if (hotspot.kind === "route_segment" || hotspot.kind === "door" || hotspot.kind === "gate") bucket.add("road");
        if (hotspot.kind === "trap" || hotspot.kind === "encounter") bucket.add("hazard");
        if (hotspot.kind === "altar" || hotspot.kind === "chest") bucket.add("objective");
        overlays.set(key, bucket);
      }
    }
  }

  const out: RenderTile[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const key = `${x}:${y}`;
      const seed = seededFloat(scene.layout.seed, key);
      const variant = (() => {
        if (overlays.get(key)?.has("road")) return "path" as const;
        if (overlays.get(key)?.has("hazard")) return "hazard" as const;
        if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) return "edge" as const;
        return seed > 0.5 ? "base" as const : "alt" as const;
      })();
      const tileOverlays = Array.from(overlays.get(key) ?? []);
      out.push({
        x,
        y,
        biomeVariant: variant,
        height: Math.floor(seededFloat(scene.layout.seed, `h:${key}`) * 3),
        isWalkable: !blocked.has(key),
        isBlocked: blocked.has(key),
        overlays: tileOverlays.length > 0 ? (tileOverlays as RenderTile["overlays"]) : undefined,
      });
    }
  }
  return out;
}

function toCombatTeam(entry: { player_id: string | null; entity_type: string }): RenderEntityTeam {
  if (entry.entity_type === "player") return "ally";
  if (typeof entry.player_id === "string" && entry.player_id.trim().length > 0) return "ally";
  return "enemy";
}

function buildCombatEntities(scene: NarrativeBoardSceneModel): RenderEntity[] {
  const details = scene.details as CombatSceneData;
  return details.combatants
    .filter((combatant) => combatant.is_alive && Number(combatant.hp) > 0)
    .map((combatant) => {
      const statusFamilies = details.statusFamiliesByCombatant[combatant.id] ?? [];
      const fullName = details.displayNames[combatant.id]?.fullName ?? combatant.name;
      const displayName = details.displayNames[combatant.id]?.displayLabel ?? combatant.name;
      const intent: RenderEntity["intent"] | undefined = details.activeTurnCombatantId === combatant.id
        ? { type: combatant.player_id ? "support" : "attack", targetId: details.focusedCombatantId ?? undefined }
        : undefined;

      return {
        id: combatant.id,
        kind: combatant.entity_type === "player" ? "player" : "enemy",
        team: toCombatTeam(combatant),
        x: Math.max(0, Math.floor(combatant.x)),
        y: Math.max(0, Math.floor(combatant.y)),
        displayName,
        fullName,
        hp: Math.max(0, Math.floor(combatant.hp)),
        hpMax: Math.max(1, Math.floor(combatant.hp_max)),
        barrier: Math.max(0, Math.floor(combatant.armor)),
        mp: Math.max(0, Math.floor(combatant.power)),
        mpMax: Math.max(1, Math.floor(combatant.power_max)),
        statuses: statusFamilies.map((family, index) => ({
          id: `${combatant.id}:${family}:${index + 1}`,
          statusId: family,
          family: statusFamilyFromRaw(family),
          stacks: 1,
        })),
        intent,
        isActive: details.activeTurnCombatantId === combatant.id,
        isFocused: details.focusedCombatantId === combatant.id,
      };
    });
}

function buildTownEntities(scene: NarrativeBoardSceneModel): RenderEntity[] {
  const details = scene.details as TownSceneData;
  const buildings: RenderEntity[] = scene.hotspots
    .filter((spot) => spot.kind === "vendor" || spot.kind === "notice_board" || spot.kind === "gate")
    .map((spot) => ({
      id: `building:${spot.id}`,
      kind: "building",
      team: "neutral",
      x: Math.floor(spot.rect.x),
      y: Math.floor(spot.rect.y),
      displayName: spot.title,
      fullName: spot.subtitle ? `${spot.title} · ${spot.subtitle}` : spot.title,
      markerRole: spot.kind === "vendor" ? "merchant" : spot.kind === "notice_board" ? "quest" : "danger",
    }));

  const npcs: RenderEntity[] = details.npcs.map((npc) => ({
    id: `npc:${npc.id}`,
    kind: "npc",
    team: "neutral",
    x: Math.max(0, Math.floor(npc.locationTile.x)),
    y: Math.max(0, Math.floor(npc.locationTile.y)),
    displayName: npc.name,
    fullName: `${npc.name} · ${npc.role}`,
    markerRole: npc.role.includes("heal") ? "healer" : npc.role.includes("vendor") ? "merchant" : "quest",
    statuses: [
      { id: `${npc.id}:mood`, statusId: npc.mood, family: "buff" },
      ...(npc.grudge > 35 ? [{ id: `${npc.id}:grudge`, statusId: "grudge", family: "debuff" as const }] : []),
    ],
  }));

  return [...buildings, ...npcs];
}

function buildTravelEntities(scene: NarrativeBoardSceneModel): RenderEntity[] {
  return scene.hotspots
    .filter((spot) => spot.kind === "route_segment" || spot.kind === "dungeon_entry" || spot.kind === "return_town")
    .map((spot) => ({
      id: `prop:${spot.id}`,
      kind: "prop",
      team: "neutral",
      x: Math.floor(spot.rect.x),
      y: Math.floor(spot.rect.y),
      displayName: spot.title,
      fullName: spot.subtitle ? `${spot.title} · ${spot.subtitle}` : spot.title,
      markerRole: spot.kind === "dungeon_entry" ? "danger" : "quest",
    }));
}

function buildDungeonEntities(scene: NarrativeBoardSceneModel): RenderEntity[] {
  const details = scene.details as DungeonSceneData;
  const rooms = details.rooms.map((room, index) => ({
    id: `room:${room.id}`,
    kind: "building" as const,
    team: "neutral" as const,
    x: index % Math.max(1, Math.floor(scene.grid.cols / 3)),
    y: Math.floor(index / Math.max(1, Math.floor(scene.grid.cols / 3))),
    displayName: room.name,
    fullName: room.tags.length > 0 ? `${room.name} · ${room.tags.join(", ")}` : room.name,
    markerRole: room.danger > 6 ? "danger" as const : "quest" as const,
  }));
  return rooms;
}

function buildOverlays(scene: NarrativeBoardSceneModel): RenderOverlayMarker[] {
  return scene.hotspots.map((spot) => ({
    id: `overlay:${spot.id}`,
    type: hotspotToOverlayType(spot.kind),
    x: Math.max(0, Math.floor(spot.rect.x)),
    y: Math.max(0, Math.floor(spot.rect.y)),
    label: spot.title,
    priority: spot.visual?.tier === "primary" ? 1 : spot.visual?.tier === "secondary" ? 2 : 3,
  }));
}

function buildTelegraphs(scene: NarrativeBoardSceneModel, entities: RenderEntity[]): RenderTelegraph[] {
  if (scene.mode !== "combat") return [];
  const details = scene.details as CombatSceneData;
  const out: RenderTelegraph[] = [];

  if (details.activeTurnCombatantId && details.focusedCombatantId) {
    out.push({
      id: `line:${details.activeTurnCombatantId}:${details.focusedCombatantId}`,
      kind: "line",
      sourceEntityId: details.activeTurnCombatantId,
      targetEntityId: details.focusedCombatantId,
      style: "preview",
    });
  }

  const active = entities.find((entry) => entry.id === details.activeTurnCombatantId);
  if (active && details.movementTiles.length > 0) {
    out.push({
      id: `aoe:movement:${active.id}:${details.session?.current_turn_index ?? 0}`,
      kind: "aoe",
      sourceEntityId: active.id,
      tiles: details.movementTiles.slice(0, 64).map((tile) => ({ x: tile.x, y: tile.y })),
      style: "preview",
    });
  }

  return out;
}

function emptyQueue(): RenderSnapshot["effectsQueue"] {
  return { cursor: null, queue: [] };
}

export function buildRenderSnapshot(scene: NarrativeBoardSceneModel, tickHint = 0): RenderSnapshot {
  const boardType = mapBoardType(scene.mode);
  const biomeId = mapBiome(scene.mode, scene);
  const width = Math.max(1, Math.floor(scene.grid.cols));
  const height = Math.max(1, Math.floor(scene.grid.rows));
  const boardId = `${boardType}:${scene.layout.seed}:${width}x${height}`;

  const entities = (() => {
    if (scene.mode === "combat") return buildCombatEntities(scene);
    if (scene.mode === "town") return buildTownEntities(scene);
    if (scene.mode === "travel") return buildTravelEntities(scene);
    return buildDungeonEntities(scene);
  })();

  const board = {
    id: boardId,
    type: boardType,
    width,
    height,
    tileSize: TILE_SIZE,
    biomeId,
    tick: tickHint > 0 ? tickHint : hashString(`${scene.layout.seed}:${scene.mode}:${scene.title}`),
    seed: scene.layout.seed,
    lighting: biomeSkinFor(biomeId).lighting,
  } as const;

  return {
    board,
    tiles: buildTiles(scene, biomeId),
    entities,
    uiOverlays: buildOverlays(scene),
    telegraphs: buildTelegraphs(scene, entities),
    effectsQueue: emptyQueue(),
  };
}
