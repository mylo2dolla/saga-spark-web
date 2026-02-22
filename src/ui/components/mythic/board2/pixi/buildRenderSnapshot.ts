import type {
  CombatSceneData,
  DungeonSceneData,
  NarrativeBoardSceneModel,
  RenderEntity,
  RenderOverlayMarker,
  RenderSnapshot,
  RenderTile,
  TownSceneData,
  TravelSceneData,
} from "@/ui/components/mythic/board2/types";
import { buildVisualEvents } from "@/ui/components/mythic/board2/pixi/buildVisualEvents";

function modeToBiome(mode: NarrativeBoardSceneModel["mode"]): RenderSnapshot["board"]["biomeId"] {
  if (mode === "town") return "town";
  if (mode === "travel") return "plains";
  if (mode === "dungeon") return "dungeon";
  return "combat";
}

function hotspotMarkerType(kind: string): RenderOverlayMarker["type"] {
  if (kind === "vendor") return "merchant";
  if (kind === "notice_board") return "notice";
  if (kind === "gate") return "gate";
  if (kind === "encounter" || kind === "trap") return "danger";
  if (kind === "route_segment") return "travel";
  if (kind === "dungeon_entry") return "hook";
  if (kind === "room" || kind === "door") return "quest";
  return "hook";
}

function mapCombatEntities(scene: NarrativeBoardSceneModel, details: CombatSceneData): RenderEntity[] {
  return details.combatants
    .filter((combatant) => combatant.is_alive && Number(combatant.hp) > 0)
    .map((combatant) => {
      const display = details.displayNames[combatant.id];
      const type: RenderEntity["type"] = combatant.entity_type === "player"
        ? "player"
        : (typeof combatant.player_id === "string" && combatant.player_id.trim().length > 0)
          ? "ally"
          : "enemy";
      const families = details.statusFamiliesByCombatant[combatant.id] ?? [];
      return {
        id: combatant.id,
        type,
        label: display?.displayLabel ?? combatant.name,
        fullLabel: display?.fullName ?? combatant.name,
        x: Math.max(0, Math.floor(combatant.x)),
        y: Math.max(0, Math.floor(combatant.y)),
        hp: Math.max(0, Math.floor(combatant.hp)),
        hpMax: Math.max(1, Math.floor(combatant.hp_max)),
        mp: Math.max(0, Math.floor(combatant.power)),
        mpMax: Math.max(1, Math.floor(combatant.power_max)),
        armor: Math.max(0, Math.floor(combatant.armor)),
        isAlive: combatant.is_alive && Number(combatant.hp) > 0,
        isActiveTurn: details.activeTurnCombatantId === combatant.id,
        isFocused: details.focusedCombatantId === combatant.id,
        statusIcons: families.map((family, index) => ({
          id: `${combatant.id}:${family}:${index + 1}`,
          label: family.slice(0, 3).toUpperCase(),
          family,
        })),
      };
    });
}

function mapTownEntities(scene: NarrativeBoardSceneModel, details: TownSceneData): RenderEntity[] {
  const buildings = scene.hotspots
    .filter((hotspot) => hotspot.kind === "vendor" || hotspot.kind === "notice_board" || hotspot.kind === "gate")
    .map((hotspot) => ({
      id: hotspot.id,
      type: "building" as const,
      label: hotspot.title,
      fullLabel: hotspot.title,
      x: Math.max(0, Math.floor(hotspot.rect.x)),
      y: Math.max(0, Math.floor(hotspot.rect.y)),
      hp: 1,
      hpMax: 1,
      mp: 0,
      mpMax: 1,
      armor: 0,
      isAlive: true,
      statusIcons: [],
    }));

  const npcs = details.npcs.map((npc) => ({
    id: `town-npc-${npc.id}`,
    type: "npc" as const,
    label: npc.name,
    fullLabel: `${npc.name} (${npc.role})`,
    x: Math.max(0, Math.floor(npc.locationTile.x)),
    y: Math.max(0, Math.floor(npc.locationTile.y)),
    hp: 1,
    hpMax: 1,
    mp: 0,
    mpMax: 1,
    armor: 0,
    isAlive: true,
    statusIcons: [
      { id: `${npc.id}:mood`, label: npc.mood.slice(0, 1).toUpperCase(), family: "mood" },
      ...(npc.grudge > 35 ? [{ id: `${npc.id}:grudge`, label: "!", family: "grudge" }] : []),
    ],
  }));

  return [...buildings, ...npcs];
}

function mapTravelEntities(scene: NarrativeBoardSceneModel, details: TravelSceneData): RenderEntity[] {
  return scene.hotspots
    .filter((hotspot) => hotspot.kind === "route_segment" || hotspot.kind === "dungeon_entry" || hotspot.kind === "return_town")
    .map((hotspot) => ({
      id: hotspot.id,
      type: "prop" as const,
      label: hotspot.title,
      fullLabel: hotspot.subtitle ? `${hotspot.title} · ${hotspot.subtitle}` : hotspot.title,
      x: Math.max(0, Math.floor(hotspot.rect.x)),
      y: Math.max(0, Math.floor(hotspot.rect.y)),
      hp: 1,
      hpMax: 1,
      mp: 0,
      mpMax: 1,
      armor: 0,
      isAlive: true,
      statusIcons: [],
    }));
}

function mapDungeonEntities(scene: NarrativeBoardSceneModel, details: DungeonSceneData): RenderEntity[] {
  return scene.hotspots
    .filter((hotspot) => hotspot.kind === "room" || hotspot.kind === "door" || hotspot.kind === "trap" || hotspot.kind === "chest" || hotspot.kind === "altar" || hotspot.kind === "puzzle")
    .map((hotspot) => ({
      id: hotspot.id,
      type: "prop" as const,
      label: hotspot.title,
      fullLabel: hotspot.subtitle ? `${hotspot.title} · ${hotspot.subtitle}` : hotspot.title,
      x: Math.max(0, Math.floor(hotspot.rect.x)),
      y: Math.max(0, Math.floor(hotspot.rect.y)),
      hp: 1,
      hpMax: 1,
      mp: 0,
      mpMax: 1,
      armor: 0,
      isAlive: true,
      statusIcons: [],
    }));
}

function buildTiles(scene: NarrativeBoardSceneModel): RenderTile[] {
  const cols = Math.max(1, Math.floor(scene.grid.cols));
  const rows = Math.max(1, Math.floor(scene.grid.rows));
  const blocked = new Set(scene.grid.blockedTiles.map((tile) => `${Math.floor(tile.x)}:${Math.floor(tile.y)}`));
  const interactables = new Set<string>();
  const hazardTiles = new Set<string>();
  const roadTiles = new Set<string>();

  for (const hotspot of scene.hotspots) {
    const minX = Math.max(0, Math.floor(hotspot.rect.x));
    const minY = Math.max(0, Math.floor(hotspot.rect.y));
    const maxX = Math.min(cols - 1, Math.floor(hotspot.rect.x + hotspot.rect.w - 1));
    const maxY = Math.min(rows - 1, Math.floor(hotspot.rect.y + hotspot.rect.h - 1));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = `${x}:${y}`;
        interactables.add(key);
        if (hotspot.kind === "trap" || hotspot.kind === "encounter") hazardTiles.add(key);
        if (hotspot.kind === "route_segment" || hotspot.kind === "gate" || hotspot.kind === "door") roadTiles.add(key);
      }
    }
  }

  const tiles: RenderTile[] = [];
  const biome = modeToBiome(scene.mode);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const key = `${x}:${y}`;
      tiles.push({
        id: `tile-${x}-${y}`,
        x,
        y,
        biome,
        blocked: blocked.has(key),
        hazard: hazardTiles.has(key),
        interactable: interactables.has(key),
        road: roadTiles.has(key),
      });
    }
  }
  return tiles;
}

export function buildRenderSnapshot(scene: NarrativeBoardSceneModel): RenderSnapshot {
  const tileSize = 48;
  const overlays: RenderOverlayMarker[] = scene.hotspots.map((hotspot) => ({
    id: `overlay-${hotspot.id}`,
    type: hotspotMarkerType(hotspot.kind),
    label: hotspot.title,
    x: Math.max(0, Math.floor(hotspot.rect.x)),
    y: Math.max(0, Math.floor(hotspot.rect.y)),
    priority: hotspot.visual?.tier === "primary" ? 1 : hotspot.visual?.tier === "secondary" ? 2 : 3,
  }));

  const entities: RenderEntity[] = scene.mode === "combat"
    ? mapCombatEntities(scene, scene.details as CombatSceneData)
    : scene.mode === "town"
      ? mapTownEntities(scene, scene.details as TownSceneData)
      : scene.mode === "travel"
        ? mapTravelEntities(scene, scene.details as TravelSceneData)
        : mapDungeonEntities(scene, scene.details as DungeonSceneData);

  return {
    board: {
      mode: scene.mode,
      type: scene.mode,
      width: Math.max(1, Math.floor(scene.grid.cols)),
      height: Math.max(1, Math.floor(scene.grid.rows)),
      tileSize,
      biomeId: modeToBiome(scene.mode),
    },
    tiles: buildTiles(scene),
    entities,
    overlays,
    effects: buildVisualEvents(scene),
  };
}
