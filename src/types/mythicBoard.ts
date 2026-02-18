import type { MythicBoardType } from "@/types/mythic";

export type MythicBiome =
  | "town"
  | "plains"
  | "forest"
  | "wetlands"
  | "desert"
  | "badlands"
  | "mountain"
  | "ruins"
  | "cavern"
  | "crypt"
  | "void";

export type MythicDirection = "north" | "south" | "east" | "west";

export interface MythicChunkMeta {
  board_type: MythicBoardType;
  coord_x: number;
  coord_y: number;
  biome: MythicBiome;
  seed: number;
}

export interface MythicTileLayer {
  id: string;
  kind: "terrain" | "obstacle" | "overlay";
  tiles: string[][];
  collision: boolean;
  destructible: boolean;
  metadata?: Record<string, unknown>;
}

export interface MythicBoardGrid {
  width: number;
  height: number;
  tile_size: number;
  layers: MythicTileLayer[];
}

export interface MythicBoardEntity {
  id: string;
  kind: "player_spawn" | "npc" | "mob" | "loot" | "interactable";
  x: number;
  y: number;
  name?: string;
  sprite?: string;
  state?: string;
  destructible?: boolean;
  critical_path?: boolean;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export interface MythicBoardEntities {
  player_spawn: MythicBoardEntity | null;
  npcs: MythicBoardEntity[];
  mobs: MythicBoardEntity[];
  loot: MythicBoardEntity[];
  interactables: MythicBoardEntity[];
}

export interface MythicBoardRuntime {
  destroyed_ids: string[];
  opened_ids: string[];
  flags: Record<string, boolean>;
  fog_revealed: Array<{ x: number; y: number }>;
}

export interface MythicBoardExit {
  enabled: boolean;
  direction: MythicDirection;
  hint?: string;
  to?: {
    board_type: MythicBoardType;
    coord_x: number;
    coord_y: number;
    biome: MythicBiome;
  };
}

export interface MythicBoardStateV2 {
  version: 2;
  chunk: MythicChunkMeta;
  grid: MythicBoardGrid;
  entities: MythicBoardEntities;
  runtime: MythicBoardRuntime;
  exits: Record<MythicDirection, MythicBoardExit>;
  metadata?: {
    source?: string;
    legacy_payload?: Record<string, unknown>;
    transition?: Record<string, unknown>;
  };
}

export interface MythicBoardParseResult {
  state: MythicBoardStateV2;
  diagnostics: string[];
}
