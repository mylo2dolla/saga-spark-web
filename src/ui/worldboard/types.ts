export interface WorldBoardNode {
  id: string;
  name: string;
  x?: number;
  y?: number;
  factionId?: string | null;
}

export interface WorldBoardEdge {
  id: string;
  fromId: string;
  toId: string;
}

export interface WorldBoardEntity {
  id: string;
  name: string;
  kind: string;
  regionId?: string;
  factionId?: string;
}

export interface WorldBoardFaction {
  id: string;
  name: string;
  color?: string;
  icon?: string;
}

export interface WorldBoardEvent {
  id: string;
  kind: string;
  regionId?: string;
  severity?: string;
  startedAt?: number;
}

export interface WorldBoardPlayerMarker {
  regionId: string;
  x?: number;
  y?: number;
}

export interface WorldBoardModel {
  nodes: WorldBoardNode[];
  edges: WorldBoardEdge[];
  entities: WorldBoardEntity[];
  factions: WorldBoardFaction[];
  events: WorldBoardEvent[];
  playerMarker?: WorldBoardPlayerMarker;
  fog?: Record<string, unknown>;
}
