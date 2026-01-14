/**
 * Board module - manages the grid/tile system.
 * Pure functions only - no mutations.
 */

import type { Board, Tile, GridPos, Vec2, TerrainType, Entity } from "./types";
import { worldToGrid, gridToWorld } from "./types";

// ============= Tile Factories =============

export function createTile(terrain: TerrainType): Tile {
  switch (terrain) {
    case "wall":
      return { terrain, blocked: true, movementCost: Infinity };
    case "water":
      return { terrain, blocked: false, movementCost: 2 };
    case "difficult":
      return { terrain, blocked: false, movementCost: 2 };
    case "lava":
      return { terrain, blocked: false, movementCost: 1, damageOnEnter: 10 };
    case "pit":
      return { terrain, blocked: true, movementCost: Infinity, damageOnEnter: 100 };
    case "floor":
    default:
      return { terrain: "floor", blocked: false, movementCost: 1 };
  }
}

// ============= Board Factory =============

export function createBoard(rows: number, cols: number, cellSize: number = 1): Board {
  const tiles: Tile[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: Tile[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(createTile("floor"));
    }
    tiles.push(row);
  }
  return { rows, cols, cellSize, tiles };
}

// ============= Board Queries =============

export function getTileAt(board: Board, pos: GridPos): Tile | null {
  if (!isInBounds(board, pos)) return null;
  return board.tiles[pos.row][pos.col];
}

export function getTileAtWorld(board: Board, worldPos: Vec2): Tile | null {
  const gridPos = worldToGrid(worldPos, board.cellSize);
  return getTileAt(board, gridPos);
}

export function isInBounds(board: Board, pos: GridPos): boolean {
  return pos.row >= 0 && pos.row < board.rows && pos.col >= 0 && pos.col < board.cols;
}

export function isBlocked(board: Board, pos: GridPos): boolean {
  const tile = getTileAt(board, pos);
  return tile === null || tile.blocked;
}

export function isBlockedWorld(board: Board, worldPos: Vec2): boolean {
  const gridPos = worldToGrid(worldPos, board.cellSize);
  return isBlocked(board, gridPos);
}

export function getMovementCost(board: Board, pos: GridPos): number {
  const tile = getTileAt(board, pos);
  return tile?.movementCost ?? Infinity;
}

// ============= Board Mutations (return new board) =============

export function setTile(board: Board, pos: GridPos, terrain: TerrainType): Board {
  if (!isInBounds(board, pos)) return board;
  
  const newTiles = board.tiles.map((row, r) => {
    if (r !== pos.row) return row;
    return row.map((tile, c) => {
      if (c !== pos.col) return tile;
      return createTile(terrain);
    });
  });
  
  return { ...board, tiles: newTiles };
}

// ============= Pathfinding Helpers =============

export function getNeighbors(board: Board, pos: GridPos): GridPos[] {
  const neighbors: GridPos[] = [];
  const directions = [
    { row: -1, col: 0 },  // up
    { row: 1, col: 0 },   // down
    { row: 0, col: -1 },  // left
    { row: 0, col: 1 },   // right
  ];
  
  for (const dir of directions) {
    const neighbor = { row: pos.row + dir.row, col: pos.col + dir.col };
    if (isInBounds(board, neighbor) && !isBlocked(board, neighbor)) {
      neighbors.push(neighbor);
    }
  }
  
  return neighbors;
}

export function getNeighborsWithDiagonals(board: Board, pos: GridPos): GridPos[] {
  const neighbors: GridPos[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const neighbor = { row: pos.row + dr, col: pos.col + dc };
      if (isInBounds(board, neighbor) && !isBlocked(board, neighbor)) {
        neighbors.push(neighbor);
      }
    }
  }
  return neighbors;
}

// Simple A* pathfinding
export function findPath(
  board: Board,
  start: GridPos,
  goal: GridPos,
  entities: ReadonlyMap<string, Entity>,
  excludeId?: string
): GridPos[] | null {
  if (isBlocked(board, goal)) return null;
  
  // Check if goal is occupied
  for (const entity of entities.values()) {
    if (entity.id !== excludeId) {
      const entityGrid = worldToGrid(entity.position, board.cellSize);
      if (entityGrid.row === goal.row && entityGrid.col === goal.col) {
        return null;
      }
    }
  }
  
  const openSet = new Map<string, { pos: GridPos; g: number; f: number; parent: string | null }>();
  const closedSet = new Set<string>();
  
  const key = (p: GridPos) => `${p.row},${p.col}`;
  const h = (p: GridPos) => Math.abs(p.row - goal.row) + Math.abs(p.col - goal.col);
  
  openSet.set(key(start), { pos: start, g: 0, f: h(start), parent: null });
  
  while (openSet.size > 0) {
    // Get node with lowest f score
    let currentKey = "";
    let currentNode = { pos: start, g: Infinity, f: Infinity, parent: null as string | null };
    for (const [k, node] of openSet) {
      if (node.f < currentNode.f) {
        currentKey = k;
        currentNode = node;
      }
    }
    
    if (currentNode.pos.row === goal.row && currentNode.pos.col === goal.col) {
      // Reconstruct path
      const path: GridPos[] = [];
      let current: string | null = currentKey;
      while (current) {
        const node = current === currentKey ? currentNode : 
          closedSet.has(current) ? null : openSet.get(current);
        if (!node) break;
        path.unshift(node.pos);
        current = node.parent;
      }
      return path;
    }
    
    openSet.delete(currentKey);
    closedSet.add(currentKey);
    
    for (const neighbor of getNeighbors(board, currentNode.pos)) {
      const neighborKey = key(neighbor);
      if (closedSet.has(neighborKey)) continue;
      
      // Check if occupied by another entity
      let occupied = false;
      for (const entity of entities.values()) {
        if (entity.id !== excludeId) {
          const entityGrid = worldToGrid(entity.position, board.cellSize);
          if (entityGrid.row === neighbor.row && entityGrid.col === neighbor.col) {
            occupied = true;
            break;
          }
        }
      }
      if (occupied) continue;
      
      const tentativeG = currentNode.g + getMovementCost(board, neighbor);
      const existing = openSet.get(neighborKey);
      
      if (!existing || tentativeG < existing.g) {
        openSet.set(neighborKey, {
          pos: neighbor,
          g: tentativeG,
          f: tentativeG + h(neighbor),
          parent: currentKey,
        });
      }
    }
  }
  
  return null; // No path found
}

// Get all reachable tiles within movement range
export function getReachableTiles(
  board: Board,
  start: GridPos,
  maxCost: number,
  entities: ReadonlyMap<string, Entity>,
  excludeId?: string
): GridPos[] {
  const reachable: GridPos[] = [];
  const visited = new Map<string, number>();
  const queue: { pos: GridPos; cost: number }[] = [{ pos: start, cost: 0 }];
  
  const key = (p: GridPos) => `${p.row},${p.col}`;
  visited.set(key(start), 0);
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    
    if (current.cost > 0) {
      reachable.push(current.pos);
    }
    
    for (const neighbor of getNeighbors(board, current.pos)) {
      const neighborKey = key(neighbor);
      const moveCost = current.cost + getMovementCost(board, neighbor);
      
      if (moveCost > maxCost) continue;
      
      const existingCost = visited.get(neighborKey);
      if (existingCost !== undefined && existingCost <= moveCost) continue;
      
      // Check if occupied
      let occupied = false;
      for (const entity of entities.values()) {
        if (entity.id !== excludeId) {
          const entityGrid = worldToGrid(entity.position, board.cellSize);
          if (entityGrid.row === neighbor.row && entityGrid.col === neighbor.col) {
            occupied = true;
            break;
          }
        }
      }
      if (occupied) continue;
      
      visited.set(neighborKey, moveCost);
      queue.push({ pos: neighbor, cost: moveCost });
    }
  }
  
  return reachable;
}
