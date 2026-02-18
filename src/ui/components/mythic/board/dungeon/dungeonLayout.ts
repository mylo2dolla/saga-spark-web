export type DungeonRoomLite = {
  id: string;
  name: string;
  tags: string[];
  danger?: number;
};

export type DungeonEdgeLite = {
  from: string;
  to: string;
};

export type DungeonLayout = {
  rooms: DungeonRoomLite[];
  edges: DungeonEdgeLite[];
  positions: Record<string, { gx: number; gy: number }>;
  neighbors: Record<string, string[]>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
};

type Dir = "n" | "s" | "e" | "w";

const DIRS: Array<{ dir: Dir; dx: number; dy: number }> = [
  { dir: "e", dx: 1, dy: 0 },
  { dir: "w", dx: -1, dy: 0 },
  { dir: "s", dx: 0, dy: 1 },
  { dir: "n", dx: 0, dy: -1 },
];

function hashString(seed: string): number {
  // FNV-1a-ish (small + deterministic).
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

function keyOf(x: number, y: number): string {
  return `${x},${y}`;
}

function rotatedDirs(seed: number, roomId: string): Array<{ dir: Dir; dx: number; dy: number }> {
  const offset = (seed + hashString(roomId)) % DIRS.length;
  const next: Array<{ dir: Dir; dx: number; dy: number }> = [];
  for (let i = 0; i < DIRS.length; i += 1) {
    next.push(DIRS[(offset + i) % DIRS.length]!);
  }
  return next;
}

function ensureNeighborBucket(map: Record<string, string[]>, key: string) {
  if (!map[key]) map[key] = [];
}

export function computeDungeonLayout(args: {
  rooms: DungeonRoomLite[];
  edges: DungeonEdgeLite[];
  seed: number;
}): DungeonLayout {
  const rooms = args.rooms ?? [];
  const edges = args.edges ?? [];

  const neighbors: Record<string, string[]> = {};
  for (const room of rooms) {
    ensureNeighborBucket(neighbors, room.id);
  }
  for (const edge of edges) {
    if (!edge?.from || !edge?.to) continue;
    ensureNeighborBucket(neighbors, edge.from);
    ensureNeighborBucket(neighbors, edge.to);
    if (!neighbors[edge.from]!.includes(edge.to)) neighbors[edge.from]!.push(edge.to);
    if (!neighbors[edge.to]!.includes(edge.from)) neighbors[edge.to]!.push(edge.from);
  }

  const positions: Record<string, { gx: number; gy: number }> = {};
  const occupied = new Set<string>();

  const first = rooms[0]?.id ?? null;
  if (first) {
    positions[first] = { gx: 0, gy: 0 };
    occupied.add(keyOf(0, 0));
  }

  const placeNear = (fromId: string, toId: string) => {
    const from = positions[fromId];
    if (!from) return;
    const dirOrder = rotatedDirs(args.seed, toId);
    for (let radius = 1; radius <= 8; radius += 1) {
      for (const d of dirOrder) {
        const gx = from.gx + d.dx * radius;
        const gy = from.gy + d.dy * radius;
        const key = keyOf(gx, gy);
        if (occupied.has(key)) continue;
        positions[toId] = { gx, gy };
        occupied.add(key);
        return;
      }
    }
  };

  for (const edge of edges) {
    const fromId = edge.from;
    const toId = edge.to;
    if (!fromId || !toId) continue;
    if (!positions[fromId] && rooms.some((r) => r.id === fromId)) {
      // If we have an unplaced "from" (uncommon), place it near origin deterministically.
      const h = hashString(fromId) % 9;
      const gx = (h % 3) - 1;
      const gy = Math.floor(h / 3) - 1;
      const key = keyOf(gx, gy);
      if (!occupied.has(key)) {
        positions[fromId] = { gx, gy };
        occupied.add(key);
      }
    }
    if (positions[toId]) continue;
    placeNear(fromId, toId);
  }

  // Any remaining rooms not connected via edges: place in a deterministic ring.
  let spill = 0;
  for (const room of rooms) {
    if (positions[room.id]) continue;
    for (let i = 0; i < 32; i += 1) {
      const gx = 2 + ((spill + i) % 6);
      const gy = -2 + Math.floor((spill + i) / 6);
      const key = keyOf(gx, gy);
      if (occupied.has(key)) continue;
      positions[room.id] = { gx, gy };
      occupied.add(key);
      spill += 1;
      break;
    }
  }

  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  const ids = Object.keys(positions);
  if (ids.length > 0) {
    minX = Math.min(...ids.map((id) => positions[id]!.gx));
    maxX = Math.max(...ids.map((id) => positions[id]!.gx));
    minY = Math.min(...ids.map((id) => positions[id]!.gy));
    maxY = Math.max(...ids.map((id) => positions[id]!.gy));
  }

  return {
    rooms,
    edges,
    positions,
    neighbors,
    bounds: { minX, maxX, minY, maxY },
  };
}

export function neighborDirections(layout: DungeonLayout, roomId: string): Array<{ toRoomId: string; dir: Dir }> {
  const origin = layout.positions[roomId];
  if (!origin) return [];
  const out: Array<{ toRoomId: string; dir: Dir }> = [];
  const ns = layout.neighbors[roomId] ?? [];
  for (const toRoomId of ns) {
    const pos = layout.positions[toRoomId];
    if (!pos) continue;
    const dx = pos.gx - origin.gx;
    const dy = pos.gy - origin.gy;
    let dir: Dir = "e";
    if (Math.abs(dx) >= Math.abs(dy)) {
      dir = dx >= 0 ? "e" : "w";
    } else {
      dir = dy >= 0 ? "s" : "n";
    }
    out.push({ toRoomId, dir });
  }
  return out;
}

