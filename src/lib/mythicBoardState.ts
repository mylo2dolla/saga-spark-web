import type { MythicBoardType } from "@/types/mythic";
import type {
  MythicBiome,
  MythicBoardEntities,
  MythicBoardEntity,
  MythicBoardParseResult,
  MythicBoardStateV2,
  MythicChunkMeta,
  MythicTileLayer,
} from "@/types/mythicBoard";

interface NormalizeOptions {
  campaignId?: string;
  boardId?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function seededRoll(seed: number, label: string): number {
  const v = hashString(`${seed}:${label}`) % 10_000;
  return v / 10_000;
}

function inferBiome(boardType: MythicBoardType, raw: Record<string, unknown>): MythicBiome {
  const candidate = asString(raw.biome, "").toLowerCase();
  if (candidate) {
    const accepted: MythicBiome[] = [
      "town",
      "plains",
      "forest",
      "wetlands",
      "desert",
      "badlands",
      "mountain",
      "ruins",
      "cavern",
      "crypt",
      "void",
    ];
    if (accepted.includes(candidate as MythicBiome)) return candidate as MythicBiome;
  }

  if (boardType === "town") return "town";
  if (boardType === "dungeon") {
    const faction = asArray(raw.faction_presence).map((x) => asString(x).toLowerCase()).join(" ");
    if (faction.includes("priory")) return "crypt";
    if (faction.includes("stone")) return "ruins";
    return "cavern";
  }
  if (boardType === "travel") {
    const weather = asString(raw.weather, "clear").toLowerCase();
    if (weather === "storm" || weather === "dust") return "badlands";
    if (weather === "rain") return "wetlands";
    const segments = asArray(raw.route_segments);
    const terrainText = segments
      .map((segment) => asString(asRecord(segment).terrain).toLowerCase())
      .join(" ");
    if (terrainText.includes("forest")) return "forest";
    if (terrainText.includes("bog")) return "wetlands";
    if (terrainText.includes("ridge")) return "mountain";
    return "plains";
  }
  return "ruins";
}

function buildChunk(boardType: MythicBoardType, raw: Record<string, unknown>, fallbackSeed: number): MythicChunkMeta {
  const chunk = asRecord(raw.chunk);
  const coordX = clampInt(asNumber(chunk.coord_x ?? raw.coord_x, 0), -9999, 9999);
  const coordY = clampInt(asNumber(chunk.coord_y ?? raw.coord_y, 0), -9999, 9999);
  const seed = clampInt(asNumber(chunk.seed ?? raw.seed, fallbackSeed), 1, 2_147_483_647);
  const biome = inferBiome(boardType, { ...raw, ...chunk });

  return {
    board_type: boardType,
    coord_x: coordX,
    coord_y: coordY,
    biome,
    seed,
  };
}

function defaultSize(boardType: MythicBoardType): { width: number; height: number; tileSize: number } {
  if (boardType === "town") return { width: 48, height: 32, tileSize: 16 };
  if (boardType === "travel") return { width: 64, height: 40, tileSize: 16 };
  if (boardType === "dungeon") return { width: 56, height: 36, tileSize: 16 };
  return { width: 24, height: 24, tileSize: 16 };
}

function biomeTerrainTile(biome: MythicBiome): string {
  switch (biome) {
    case "town":
      return "cobble";
    case "forest":
      return "grass_forest";
    case "wetlands":
      return "mud";
    case "desert":
      return "sand";
    case "badlands":
      return "dry_rock";
    case "mountain":
      return "stone";
    case "ruins":
      return "ruin_floor";
    case "cavern":
      return "cave_floor";
    case "crypt":
      return "crypt_floor";
    case "void":
      return "void";
    default:
      return "grass";
  }
}

function createGridLayers(chunk: MythicChunkMeta, raw: Record<string, unknown>): { width: number; height: number; tileSize: number; layers: MythicTileLayer[] } {
  const grid = asRecord(raw.grid);
  const fallback = defaultSize(chunk.board_type);
  const width = clampInt(asNumber(grid.width, fallback.width), 12, 128);
  const height = clampInt(asNumber(grid.height, fallback.height), 12, 128);
  const tileSize = clampInt(asNumber(grid.tile_size, fallback.tileSize), 8, 64);

  const suppliedLayers = asArray(grid.layers)
    .map((entry) => asRecord(entry))
    .filter((layer) => asString(layer.id).length > 0 && Array.isArray(layer.tiles));

  if (suppliedLayers.length > 0) {
    const layers: MythicTileLayer[] = suppliedLayers.map((layer, index) => {
      const tileRows = asArray(layer.tiles).slice(0, height).map((rowValue) => {
        const row = asArray(rowValue).slice(0, width).map((cell) => asString(cell, "void"));
        while (row.length < width) row.push("void");
        return row;
      });
      while (tileRows.length < height) {
        tileRows.push(Array.from({ length: width }, () => "void"));
      }
      return {
        id: asString(layer.id, `layer_${index + 1}`),
        kind: ((): MythicTileLayer["kind"] => {
          const kind = asString(layer.kind, "terrain");
          if (kind === "obstacle" || kind === "overlay") return kind;
          return "terrain";
        })(),
        tiles: tileRows,
        collision: asBoolean(layer.collision, false),
        destructible: asBoolean(layer.destructible, false),
        metadata: asRecord(layer.metadata),
      };
    });
    return { width, height, tileSize, layers };
  }

  const terrainTile = biomeTerrainTile(chunk.biome);
  const baseTiles = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (edge) return `${terrainTile}_edge`;
      if (seededRoll(chunk.seed, `terrain:${x}:${y}`) < 0.06) return `${terrainTile}_variant`;
      return terrainTile;
    }),
  );

  const obstacleTiles = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const edge = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (edge) return "wall";
      if (chunk.board_type === "travel") {
        return seededRoll(chunk.seed, `travel_obs:${x}:${y}`) < 0.045 ? "tree" : "void";
      }
      if (chunk.board_type === "town") {
        return seededRoll(chunk.seed, `town_obs:${x}:${y}`) < 0.025 ? "crate" : "void";
      }
      if (chunk.board_type === "dungeon") {
        return seededRoll(chunk.seed, `dungeon_obs:${x}:${y}`) < 0.08 ? "pillar" : "void";
      }
      return "void";
    }),
  );

  const blockedTiles = asArray(raw.blocked_tiles)
    .map((tile) => asRecord(tile))
    .map((tile) => ({ x: clampInt(asNumber(tile.x, -1), -1, width + 1), y: clampInt(asNumber(tile.y, -1), -1, height + 1) }))
    .filter((tile) => tile.x >= 0 && tile.x < width && tile.y >= 0 && tile.y < height);

  for (const tile of blockedTiles) {
    obstacleTiles[tile.y]![tile.x] = "wall";
  }

  return {
    width,
    height,
    tileSize,
    layers: [
      {
        id: "terrain",
        kind: "terrain",
        tiles: baseTiles,
        collision: false,
        destructible: false,
      },
      {
        id: "obstacles",
        kind: "obstacle",
        tiles: obstacleTiles,
        collision: true,
        destructible: true,
      },
    ],
  };
}

function makeEntity(id: string, kind: MythicBoardEntity["kind"], x: number, y: number, name?: string): MythicBoardEntity {
  return {
    id,
    kind,
    x,
    y,
    name,
    destructible: kind === "interactable" || kind === "loot" || kind === "mob",
    critical_path: false,
    sprite: `${kind}_default`,
    state: "idle",
    tags: [],
    meta: {},
  };
}

function deriveEntities(chunk: MythicChunkMeta, raw: Record<string, unknown>, width: number, height: number): MythicBoardEntities {
  const entitiesRaw = asRecord(raw.entities);

  const loadGroup = (key: string, kind: MythicBoardEntity["kind"]): MythicBoardEntity[] => {
    const rows = asArray(entitiesRaw[key]);
    return rows.map((entry, idx) => {
      const rec = asRecord(entry);
      return {
        id: asString(rec.id, `${kind}_${idx + 1}`),
        kind,
        x: clampInt(asNumber(rec.x, 1 + (idx % Math.max(2, width - 2))), 1, width - 2),
        y: clampInt(asNumber(rec.y, 1 + ((idx * 3) % Math.max(2, height - 2))), 1, height - 2),
        name: asString(rec.name, undefined),
        sprite: asString(rec.sprite, `${kind}_default`),
        state: asString(rec.state, "idle"),
        destructible: asBoolean(rec.destructible, kind !== "npc"),
        critical_path: asBoolean(rec.critical_path, false),
        tags: asArray(rec.tags).map((tag) => asString(tag)).filter((tag) => tag.length > 0),
        meta: asRecord(rec.meta),
      };
    });
  };

  const playerSpawnRec = asRecord(entitiesRaw.player_spawn);
  const playerSpawn = {
    id: asString(playerSpawnRec.id, "player_spawn"),
    kind: "player_spawn" as const,
    x: clampInt(asNumber(playerSpawnRec.x, Math.floor(width / 2)), 1, width - 2),
    y: clampInt(asNumber(playerSpawnRec.y, Math.floor(height / 2)), 1, height - 2),
    sprite: asString(playerSpawnRec.sprite, "player_default"),
    state: "idle",
    destructible: false,
    critical_path: false,
    tags: ["spawn"],
    meta: asRecord(playerSpawnRec.meta),
  };

  let npcs = loadGroup("npcs", "npc");
  let mobs = loadGroup("mobs", "mob");
  let loot = loadGroup("loot", "loot");
  let interactables = loadGroup("interactables", "interactable");

  if (npcs.length === 0 && chunk.board_type === "town") {
    npcs = asArray(raw.vendors).map((vendor, idx) => {
      const rec = asRecord(vendor);
      return {
        ...makeEntity(`vendor_${idx + 1}`, "npc", 5 + (idx * 4), 4 + (idx % 3), asString(rec.name, `Vendor ${idx + 1}`)),
        tags: ["vendor"],
        destructible: false,
      };
    });
  }

  if (interactables.length === 0 && chunk.board_type === "town") {
    interactables = [
      { ...makeEntity("notice_board", "interactable", Math.max(2, width - 6), 4, "Notice Board"), tags: ["quest", "critical"] },
      { ...makeEntity("well", "interactable", Math.max(3, width - 8), Math.max(4, height - 6), "Old Well"), tags: ["lore"] },
      { ...makeEntity("town_gate", "interactable", Math.floor(width / 2), 1, "Town Gate"), tags: ["exit"], critical_path: true, destructible: false },
    ];
  }

  if (interactables.length === 0 && chunk.board_type === "travel") {
    interactables = asArray(raw.route_segments).map((segment, idx) => {
      const rec = asRecord(segment);
      return {
        ...makeEntity(
          asString(rec.id, `segment_${idx + 1}`),
          "interactable",
          6 + ((idx * 9) % Math.max(8, width - 8)),
          5 + ((idx * 6) % Math.max(8, height - 8)),
          `${asString(rec.terrain, "path")} route`,
        ),
        tags: ["poi", "travel"],
      };
    });
    if (interactables.length === 0) {
      interactables = [
        { ...makeEntity("travel_node_a", "interactable", 8, 7, "Roadside Shrine"), tags: ["poi", "quest"] },
        { ...makeEntity("travel_node_b", "interactable", width - 10, height - 8, "Broken Caravan"), tags: ["loot", "event"] },
      ];
    }
  }

  if (chunk.board_type === "dungeon") {
    if (mobs.length === 0) {
      mobs = Array.from({ length: 5 }, (_, idx) => ({
        ...makeEntity(`mob_${idx + 1}`, "mob", 4 + ((idx * 7) % Math.max(6, width - 6)), 4 + ((idx * 5) % Math.max(6, height - 6)), `Dungeon Mob ${idx + 1}`),
        tags: ["enemy"],
      }));
    }
    if (interactables.length === 0) {
      interactables = [
        { ...makeEntity("dungeon_core", "interactable", Math.floor(width / 2), 2, "Dungeon Core"), tags: ["core", "critical"], critical_path: true, destructible: false },
        { ...makeEntity("sealed_door", "interactable", width - 4, Math.floor(height / 2), "Sealed Door"), tags: ["door", "critical"], critical_path: true, destructible: false },
        { ...makeEntity("cracked_statue", "interactable", 5, height - 5, "Cracked Statue"), tags: ["destructible", "lore"], destructible: true },
      ];
    }
    if (loot.length === 0) {
      loot = [
        { ...makeEntity("chest_1", "loot", 7, 7, "Ancient Cache"), tags: ["loot", "quest"] },
      ];
    }
  }

  return {
    player_spawn: playerSpawn,
    npcs,
    mobs,
    loot,
    interactables,
  };
}

function deriveRuntime(raw: Record<string, unknown>): MythicBoardStateV2["runtime"] {
  const runtime = asRecord(raw.runtime);
  const destroyed = asArray(runtime.destroyed_ids ?? raw.destroyed_ids).map((id) => asString(id)).filter((id) => id.length > 0);
  const opened = asArray(runtime.opened_ids ?? raw.opened_ids).map((id) => asString(id)).filter((id) => id.length > 0);
  const fog = asArray(runtime.fog_revealed ?? asRecord(raw.fog_of_war).revealed)
    .map((entry) => asRecord(entry))
    .filter((entry) => Number.isFinite(Number(entry.x)) && Number.isFinite(Number(entry.y)))
    .map((entry) => ({ x: clampInt(asNumber(entry.x), -9999, 9999), y: clampInt(asNumber(entry.y), -9999, 9999) }));

  const flags: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(asRecord(runtime.flags ?? raw.consequence_flags))) {
    flags[key] = asBoolean(value, false);
  }

  return {
    destroyed_ids: Array.from(new Set(destroyed)),
    opened_ids: Array.from(new Set(opened)),
    fog_revealed: fog,
    flags,
  };
}

function deriveExits(chunk: MythicChunkMeta, raw: Record<string, unknown>): MythicBoardStateV2["exits"] {
  const exitsRaw = asRecord(raw.exits);
  const mkExit = (direction: "north" | "south" | "east" | "west") => {
    const rec = asRecord(exitsRaw[direction]);
    const enabled = asBoolean(rec.enabled, true);
    return {
      enabled,
      direction,
      hint: asString(rec.hint, `${direction} edge`),
      to: enabled
        ? {
            board_type: chunk.board_type,
            coord_x: clampInt(asNumber(rec.coord_x, direction === "west" ? chunk.coord_x - 1 : direction === "east" ? chunk.coord_x + 1 : chunk.coord_x), -9999, 9999),
            coord_y: clampInt(asNumber(rec.coord_y, direction === "north" ? chunk.coord_y - 1 : direction === "south" ? chunk.coord_y + 1 : chunk.coord_y), -9999, 9999),
            biome: inferBiome(chunk.board_type, { ...raw, ...rec, biome: rec.biome ?? chunk.biome }),
          }
        : undefined,
    };
  };

  return {
    north: mkExit("north"),
    south: mkExit("south"),
    east: mkExit("east"),
    west: mkExit("west"),
  };
}

function sanitizeV2(raw: Record<string, unknown>, boardType: MythicBoardType, fallbackSeed: number): MythicBoardParseResult {
  const diagnostics: string[] = [];
  const chunk = buildChunk(boardType, raw, fallbackSeed);
  const gridBundle = createGridLayers(chunk, raw);
  const entities = deriveEntities(chunk, raw, gridBundle.width, gridBundle.height);
  const runtime = deriveRuntime(raw);
  const exits = deriveExits(chunk, raw);

  if (gridBundle.layers.length === 0) {
    diagnostics.push("No layers were provided; generated default terrain layer.");
  }

  return {
    diagnostics,
    state: {
      version: 2,
      chunk,
      grid: {
        width: gridBundle.width,
        height: gridBundle.height,
        tile_size: gridBundle.tileSize,
        layers: gridBundle.layers,
      },
      entities,
      runtime,
      exits,
      metadata: {
        source: asString(raw.version) === "2" || asNumber(raw.version, 0) === 2 ? "v2" : "legacy",
        legacy_payload: raw,
      },
    },
  };
}

export function normalizeMythicBoardState(
  value: unknown,
  boardType: MythicBoardType,
  options?: NormalizeOptions,
): MythicBoardParseResult {
  const raw = asRecord(value);
  const fallbackSeed = clampInt(hashString(`${options?.campaignId ?? "campaign"}:${options?.boardId ?? "board"}`) || 1, 1, 2_147_483_647);

  return sanitizeV2(raw, boardType, fallbackSeed);
}
