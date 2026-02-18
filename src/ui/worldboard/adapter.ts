import type { UnifiedState } from "@/engine/UnifiedState";
import type { WorldEvent } from "@/engine/narrative/types";
import type { TravelState } from "@/engine/narrative/Travel";
import type { WorldBoardModel, WorldBoardNode, WorldBoardEdge, WorldBoardEvent, WorldBoardFaction } from "./types";

type WorldWithTravel = UnifiedState["world"] & { travelState?: TravelState };

const toEdgeId = (fromId: string, toId: string) => {
  const ordered = [fromId, toId].sort();
  return `${ordered[0]}__${ordered[1]}`;
};

export function toWorldBoardModel(state: UnifiedState): WorldBoardModel {
  const world = state.world as WorldWithTravel;
  const nodes: WorldBoardNode[] = [];
  const edgesMap = new Map<string, WorldBoardEdge>();
  const events: WorldBoardEvent[] = [];
  const factions: WorldBoardFaction[] = [];
  const campaignFactions = world.campaignSeed.factions ?? [];

  for (const faction of campaignFactions) {
    factions.push({
      id: faction.id,
      name: faction.name,
    });
  }

  for (const location of world.locations.values()) {
    const factionId = "factionControl" in location ? (location as { factionControl?: string | null }).factionControl : null;
    nodes.push({
      id: location.id,
      name: location.name,
      x: location.position?.x,
      y: location.position?.y,
      factionId: factionId ?? null,
    });

    if (location.connectedTo) {
      for (const targetId of location.connectedTo) {
        if (!world.locations.has(targetId)) continue;
        const edgeId = toEdgeId(location.id, targetId);
        if (!edgesMap.has(edgeId)) {
          edgesMap.set(edgeId, {
            id: edgeId,
            fromId: location.id,
            toId: targetId,
          });
        }
      }
    }
  }

  const pendingEvents = (state.pendingWorldEvents ?? []) as WorldEvent[];
  for (const event of pendingEvents) {
    const regionId = event.targetId && world.locations.has(event.targetId)
      ? event.targetId
      : undefined;
    events.push({
      id: `${event.type}-${event.timestamp}`,
      kind: event.type,
      regionId,
      startedAt: event.timestamp,
    });
  }

  const currentLocationId = world.travelState?.currentLocationId;
  const currentLocation = currentLocationId ? world.locations.get(currentLocationId) : undefined;

  return {
    nodes,
    edges: Array.from(edgesMap.values()),
    entities: [],
    factions,
    events,
    playerMarker: currentLocationId
      ? {
          regionId: currentLocationId,
          x: currentLocation?.position?.x,
          y: currentLocation?.position?.y,
        }
      : undefined,
  };
}
