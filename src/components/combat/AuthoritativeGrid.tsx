import { useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import type { GridPosition, GridTile, CombatEntity, GameAbility } from "@/types/game";

interface AuthoritativeGridProps {
  gridSize: { rows: number; cols: number };
  tiles: GridTile[];
  entities: CombatEntity[];
  selectedEntityId?: string;
  selectedAbility?: GameAbility | null;
  validTargets?: GridPosition[];
  areaOfEffect?: GridPosition[];
  currentTurnId?: string;
  onCellClick?: (position: GridPosition) => void;
  onEntityClick?: (entity: CombatEntity) => void;
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

export function AuthoritativeGrid({
  gridSize,
  tiles,
  entities,
  selectedEntityId,
  selectedAbility,
  validTargets = [],
  areaOfEffect = [],
  currentTurnId,
  onCellClick,
  onEntityClick,
}: AuthoritativeGridProps) {
  const [hoveredCell, setHoveredCell] = useState<GridPosition | null>(null);

  const getTileAt = useCallback((x: number, y: number): GridTile | undefined => {
    return tiles.find(t => t.x === x && t.y === y);
  }, [tiles]);

  const getEntityAt = useCallback((x: number, y: number): CombatEntity | undefined => {
    return entities.find(e => e.position.x === x && e.position.y === y);
  }, [entities]);

  const isValidTarget = useCallback((x: number, y: number): boolean => {
    return validTargets.some(t => t.x === x && t.y === y);
  }, [validTargets]);

  const isInAoE = useCallback((x: number, y: number): boolean => {
    return areaOfEffect.some(t => t.x === x && t.y === y);
  }, [areaOfEffect]);

  const cellSize = useMemo(() => {
    // Calculate cell size to fit in viewport
    return Math.min(48, Math.floor(800 / Math.max(gridSize.cols, gridSize.rows)));
  }, [gridSize]);

  return (
    <div className="relative w-full overflow-auto rounded-xl border border-border bg-stone-900/30">
      <div 
        className="grid gap-px p-2"
        style={{
          gridTemplateColumns: `repeat(${gridSize.cols}, ${cellSize}px)`,
          gridTemplateRows: `repeat(${gridSize.rows}, ${cellSize}px)`,
        }}
      >
        {Array.from({ length: gridSize.rows * gridSize.cols }).map((_, index) => {
          const x = index % gridSize.cols;
          const y = Math.floor(index / gridSize.cols);
          const tile = getTileAt(x, y);
          const entity = getEntityAt(x, y);
          const isValid = isValidTarget(x, y);
          const inAoE = isInAoE(x, y);
          const isHovered = hoveredCell?.x === x && hoveredCell?.y === y;
          const isSelected = entity?.id === selectedEntityId;
          const isCurrentTurn = entity?.id === currentTurnId;

          return (
            <motion.div
              key={`${x}-${y}`}
              className={`
                relative flex items-center justify-center rounded-sm cursor-pointer
                transition-all duration-150 border border-transparent
                ${tile ? TERRAIN_STYLES[tile.terrain] || TERRAIN_STYLES.floor : TERRAIN_STYLES.floor}
                ${isValid && selectedAbility ? "ring-2 ring-primary/60 bg-primary/20" : ""}
                ${inAoE ? "bg-destructive/30 ring-1 ring-destructive" : ""}
                ${isHovered && !entity ? "brightness-125" : ""}
                ${tile?.blocked ? "cursor-not-allowed opacity-60" : ""}
              `}
              style={{ width: cellSize, height: cellSize }}
              onMouseEnter={() => setHoveredCell({ x, y })}
              onMouseLeave={() => setHoveredCell(null)}
              onClick={() => {
                if (entity) {
                  onEntityClick?.(entity);
                } else if (!tile?.blocked) {
                  onCellClick?.({ x, y });
                }
              }}
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
                    ${entity.isEnemy 
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

              {/* Terrain Indicator */}
              {tile?.terrain === "tree" && !entity && (
                <span className="text-emerald-600 text-lg">🌲</span>
              )}
              {tile?.terrain === "rock" && !entity && (
                <span className="text-stone-400 text-sm">🪨</span>
              )}
              {tile?.terrain === "water" && !entity && (
                <span className="text-blue-400 text-sm">💧</span>
              )}

              {/* Coordinate Debug (optional) */}
              {isHovered && !entity && (
                <span className="absolute text-[8px] text-muted-foreground/50">
                  {x},{y}
                </span>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="absolute top-2 right-2 flex gap-2 text-xs">
        {selectedAbility && (
          <div className="px-2 py-1 rounded bg-background/80 border border-border">
            <span className="text-primary">◆</span> {selectedAbility.name} (Range: {selectedAbility.range})
          </div>
        )}
      </div>
    </div>
  );
}

export default AuthoritativeGrid;
