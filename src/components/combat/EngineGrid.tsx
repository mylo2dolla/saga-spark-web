/**
 * EngineGrid - renders the game grid directly from engine state.
 * No local state for entities/positions - everything comes from the engine.
 */

import { useCallback, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useEngine } from "@/contexts/EngineContext";
import type { Vec2, Entity } from "@/engine";
import { worldToGrid } from "@/engine";

interface EngineGridProps {
  cellSize?: number;
  onEntityClick?: (entity: Entity) => void;
  onCellClick?: (gridPos: { row: number; col: number }) => void;
  selectedEntityId?: string;
}

const TERRAIN_STYLES: Record<string, string> = {
  floor: "bg-stone-800/50",
  wall: "bg-stone-600 border-stone-500",
  tree: "bg-emerald-900/60",
  rock: "bg-stone-500/60",
  water: "bg-blue-900/60",
  lava: "bg-orange-600/60",
  pit: "bg-black/80",
};

export function EngineGrid({
  cellSize = 48,
  onEntityClick,
  onCellClick,
  selectedEntityId,
}: EngineGridProps) {
  const { entities, board, currentTurn, isInCombat, getValidMoves } = useEngine();
  const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number } | null>(null);

  // Calculate valid moves for selected entity
  const validMoves = useMemo(() => {
    if (!selectedEntityId || !isInCombat) return new Set<string>();
    const moves = getValidMoves(selectedEntityId);
    return new Set(moves.map(v => `${Math.round(v.x / board.cellSize)},${Math.round(v.y / board.cellSize)}`));
  }, [selectedEntityId, isInCombat, getValidMoves, board.cellSize]);

  // Map entities to their grid positions
  const entityByCell = useMemo(() => {
    const map = new Map<string, Entity>();
    for (const entity of entities) {
      if (!entity.isAlive) continue;
      const grid = worldToGrid(entity.position, board.cellSize);
      map.set(`${grid.row},${grid.col}`, entity);
    }
    return map;
  }, [entities, board.cellSize]);

  // Get tile at position - board.tiles is a 2D array [row][col]
  const getTileAt = useCallback((row: number, col: number) => {
    if (row < 0 || row >= board.rows || col < 0 || col >= board.cols) return undefined;
    return board.tiles[row]?.[col];
  }, [board.tiles, board.rows, board.cols]);

  const handleCellClick = useCallback((row: number, col: number) => {
    const entity = entityByCell.get(`${row},${col}`);
    if (entity) {
      onEntityClick?.(entity);
    } else {
      onCellClick?.({ row, col });
    }
  }, [entityByCell, onEntityClick, onCellClick]);

  return (
    <div className="relative w-full overflow-auto rounded-xl border border-border bg-stone-900/30">
      <div 
        className="grid gap-px p-2"
        style={{
          gridTemplateColumns: `repeat(${board.cols}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${board.rows}, ${cellSize}px)`,
        }}
      >
        {Array.from({ length: board.rows * board.cols }).map((_, index) => {
          const col = index % board.cols;
          const row = Math.floor(index / board.cols);
          const tile = getTileAt(row, col);
          const entity = entityByCell.get(`${row},${col}`);
          const isValidMove = validMoves.has(`${row},${col}`);
          const isHovered = hoveredCell?.row === row && hoveredCell?.col === col;
          const isSelected = entity?.id === selectedEntityId;
          const isCurrentTurn = entity?.id === currentTurn?.id;

          return (
            <motion.div
              key={`${row}-${col}`}
              className={`
                relative flex items-center justify-center rounded-sm cursor-pointer
                transition-all duration-150 border border-transparent
                ${tile ? TERRAIN_STYLES[tile.terrain] || TERRAIN_STYLES.floor : TERRAIN_STYLES.floor}
                ${isValidMove && !entity ? "ring-2 ring-primary/60 bg-primary/20" : ""}
                ${isHovered && !entity ? "brightness-125" : ""}
                ${tile?.blocked ? "cursor-not-allowed opacity-60" : ""}
              `}
              style={{ width: cellSize, height: cellSize }}
              onMouseEnter={() => setHoveredCell({ row, col })}
              onMouseLeave={() => setHoveredCell(null)}
              onClick={() => handleCellClick(row, col)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Entity Token */}
              {entity && (
                <motion.div
                  layoutId={entity.id}
                  className={`
                    absolute inset-1 rounded-full flex items-center justify-center
                    text-xs font-bold shadow-lg
                    ${entity.faction === "enemy" 
                      ? "bg-gradient-to-br from-destructive to-destructive/80 text-destructive-foreground" 
                      : "bg-gradient-to-br from-primary to-primary/80 text-primary-foreground"
                    }
                    ${isSelected ? "ring-2 ring-white ring-offset-2 ring-offset-background" : ""}
                    ${isCurrentTurn ? "animate-pulse" : ""}
                  `}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 300 }}
                >
                  {entity.name.slice(0, 2).toUpperCase()}
                  
                  {/* HP Bar */}
                  <div className="absolute -bottom-1 left-1 right-1 h-1 bg-black/50 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full ${entity.hp / entity.maxHp > 0.5 ? "bg-green-500" : entity.hp / entity.maxHp > 0.25 ? "bg-yellow-500" : "bg-red-500"}`}
                      initial={false}
                      animate={{ width: `${(entity.hp / entity.maxHp) * 100}%` }}
                    />
                  </div>

                  {/* Current Turn Indicator */}
                  {isCurrentTurn && (
                    <motion.div
                      className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-accent"
                      animate={{ scale: [1, 1.2, 1] }}
                      transition={{ repeat: Infinity, duration: 1 }}
                    />
                  )}
                </motion.div>
              )}

              {/* Coordinate Debug */}
              {isHovered && !entity && (
                <span className="absolute text-[8px] text-muted-foreground/50">
                  {row},{col}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default EngineGrid;
