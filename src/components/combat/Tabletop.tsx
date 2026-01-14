import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import CombatMiniature, { type Character } from "./CombatMiniature";
import SpellEffect from "./SpellEffect";
import FloatingDamage, { useFloatingDamage } from "./FloatingDamage";
import TerrainTile, { type TerrainType } from "./TerrainTile";

interface TerrainCell {
  type: TerrainType;
  passable: boolean;
}

interface TabletopProps {
  characters: Character[];
  gridSize?: { rows: number; cols: number };
  terrain?: Map<string, TerrainCell>;
  fogOfWar?: Set<string>;
  onCharacterClick?: (character: Character) => void;
  onCellClick?: (position: { x: number; y: number }) => void;
  onCharacterMove?: (characterId: string, position: { x: number; y: number }) => void;
  selectedCharacterId?: string;
  currentTurnId?: string;
  highlightedCells?: { x: number; y: number; type: "move" | "attack" | "spell" | "aoe" }[];
  effects?: Array<{
    id: string;
    type: "fire" | "ice" | "lightning" | "heal" | "arcane" | "physical";
    position: { x: number; y: number };
    targetPosition?: { x: number; y: number };
  }>;
  onEffectComplete?: (effectId: string) => void;
}

const Tabletop = ({
  characters,
  gridSize = { rows: 10, cols: 12 },
  terrain = new Map(),
  fogOfWar = new Set(),
  onCharacterClick,
  onCellClick,
  onCharacterMove,
  selectedCharacterId,
  currentTurnId,
  highlightedCells = [],
  effects = [],
  onEffectComplete,
}: TabletopProps) => {
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const [draggedCharacter, setDraggedCharacter] = useState<string | null>(null);
  const { damages, addDamage, removeDamage } = useFloatingDamage();

  const cellSize = Math.min(
    (typeof window !== 'undefined' ? Math.min(window.innerWidth * 0.6, 800) : 600) / gridSize.cols,
    (typeof window !== 'undefined' ? Math.min(window.innerHeight * 0.5, 500) : 400) / gridSize.rows
  );

  const getCharacterAtPosition = (x: number, y: number) => {
    return characters.find(c => c.position?.x === x && c.position?.y === y);
  };

  const getCellHighlight = (x: number, y: number) => {
    return highlightedCells.find(cell => cell.x === x && cell.y === y);
  };

  const getTerrainAtPosition = (x: number, y: number): TerrainCell | undefined => {
    return terrain.get(`${x},${y}`);
  };

  const isFogOfWar = (x: number, y: number): boolean => {
    return fogOfWar.has(`${x},${y}`);
  };

  const highlightColors = {
    move: "bg-accent/40 border-accent shadow-[inset_0_0_20px_hsl(var(--accent)/0.3)]",
    attack: "bg-destructive/40 border-destructive shadow-[inset_0_0_20px_hsl(var(--destructive)/0.3)]",
    spell: "bg-arcane/40 border-arcane shadow-[inset_0_0_20px_hsl(var(--arcane)/0.3)]",
    aoe: "bg-orange-500/30 border-orange-500 shadow-[inset_0_0_20px_rgba(249,115,22,0.3)]",
  };

  const handleCellClick = (x: number, y: number) => {
    const character = getCharacterAtPosition(x, y);
    if (character) {
      onCharacterClick?.(character);
    } else {
      const highlight = getCellHighlight(x, y);
      if (highlight?.type === "move" && selectedCharacterId) {
        onCharacterMove?.(selectedCharacterId, { x, y });
      }
      onCellClick?.({ x, y });
    }
  };

  // Convert grid position to pixel position
  const gridToPixel = (gridX: number, gridY: number) => ({
    x: gridX * cellSize + cellSize / 2,
    y: gridY * cellSize + cellSize / 2,
  });

  return (
    <div className="relative w-full overflow-hidden rounded-xl border-2 border-border shadow-2xl">
      {/* Table surface texture */}
      <div 
        className="absolute inset-0 bg-gradient-to-br from-amber-950/30 via-stone-900/40 to-stone-950/50"
        style={{
          backgroundImage: `
            url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='0.1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")
          `,
        }}
      />

      {/* Main grid container */}
      <div 
        className="relative"
        style={{
          width: gridSize.cols * cellSize,
          height: gridSize.rows * cellSize,
        }}
      >
        {/* Grid lines */}
        <svg 
          className="absolute inset-0 pointer-events-none"
          width="100%"
          height="100%"
        >
          <defs>
            <pattern 
              id="grid" 
              width={cellSize} 
              height={cellSize} 
              patternUnits="userSpaceOnUse"
            >
              <path 
                d={`M ${cellSize} 0 L 0 0 0 ${cellSize}`} 
                fill="none" 
                stroke="hsl(var(--border))" 
                strokeWidth="1"
                opacity="0.5"
              />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </svg>

        {/* Terrain layer */}
        {Array.from({ length: gridSize.rows * gridSize.cols }).map((_, index) => {
          const x = index % gridSize.cols;
          const y = Math.floor(index / gridSize.cols);
          const terrainCell = getTerrainAtPosition(x, y);
          
          if (!terrainCell) return null;
          
          return (
            <div
              key={`terrain-${x}-${y}`}
              className="absolute"
              style={{
                left: x * cellSize,
                top: y * cellSize,
                width: cellSize,
                height: cellSize,
              }}
            >
              <TerrainTile type={terrainCell.type} size={cellSize} />
            </div>
          );
        })}

        {/* Cell interaction layer */}
        <div 
          className="absolute inset-0 grid"
          style={{
            gridTemplateColumns: `repeat(${gridSize.cols}, ${cellSize}px)`,
            gridTemplateRows: `repeat(${gridSize.rows}, ${cellSize}px)`,
          }}
        >
          {Array.from({ length: gridSize.rows * gridSize.cols }).map((_, index) => {
            const x = index % gridSize.cols;
            const y = Math.floor(index / gridSize.cols);
            const character = getCharacterAtPosition(x, y);
            const highlight = getCellHighlight(x, y);
            const isHovered = hoveredCell?.x === x && hoveredCell?.y === y;
            const isFogged = isFogOfWar(x, y);

            return (
              <motion.div
                key={`cell-${x}-${y}`}
                className={`
                  relative flex items-center justify-center
                  border border-transparent
                  transition-all duration-200 cursor-pointer
                  ${highlight ? highlightColors[highlight.type] : ""}
                  ${isHovered && !character ? "bg-white/10 border-white/20" : ""}
                `}
                onMouseEnter={() => setHoveredCell({ x, y })}
                onMouseLeave={() => setHoveredCell(null)}
                onClick={() => handleCellClick(x, y)}
                whileHover={{ scale: character ? 1 : 1.02 }}
              >
                {/* Highlighted cell pulse effect */}
                {highlight && !character && (
                  <motion.div
                    initial={{ opacity: 0.3 }}
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="absolute inset-1 rounded-lg pointer-events-none"
                  />
                )}

                {/* Fog of war overlay */}
                {isFogged && (
                  <div className="absolute inset-0 bg-background/90 backdrop-blur-sm pointer-events-none" />
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Character miniatures layer */}
        <AnimatePresence>
          {characters.map((character) => {
            if (!character.position) return null;
            const pixelPos = gridToPixel(character.position.x, character.position.y);
            
            return (
              <motion.div
                key={character.id}
                className="absolute pointer-events-auto"
                initial={false}
                animate={{
                  x: pixelPos.x - cellSize / 2,
                  y: pixelPos.y - cellSize / 2,
                }}
                transition={{
                  type: "spring",
                  stiffness: 200,
                  damping: 25,
                }}
                style={{
                  width: cellSize,
                  height: cellSize,
                  zIndex: character.id === currentTurnId ? 20 : 10,
                }}
              >
                <CombatMiniature
                  character={{
                    ...character,
                    isActive: character.id === currentTurnId,
                  }}
                  size={cellSize > 60 ? "lg" : cellSize > 40 ? "md" : "sm"}
                  showDetails={true}
                  onClick={() => onCharacterClick?.(character)}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>

        {/* Spell effects layer */}
        <AnimatePresence>
          {effects.map((effect) => {
            const startPixel = gridToPixel(effect.position.x, effect.position.y);
            const endPixel = effect.targetPosition 
              ? gridToPixel(effect.targetPosition.x, effect.targetPosition.y)
              : undefined;

            return (
              <SpellEffect
                key={effect.id}
                type={effect.type}
                position={startPixel}
                targetPosition={endPixel}
                onComplete={() => onEffectComplete?.(effect.id)}
              />
            );
          })}
        </AnimatePresence>

        {/* Floating damage numbers */}
        <FloatingDamage damages={damages} onComplete={removeDamage} />

        {/* Selection indicator for current turn */}
        {currentTurnId && (
          <motion.div
            className="absolute pointer-events-none border-2 border-primary rounded-lg"
            initial={false}
            animate={{
              x: (characters.find(c => c.id === currentTurnId)?.position?.x || 0) * cellSize,
              y: (characters.find(c => c.id === currentTurnId)?.position?.y || 0) * cellSize,
              width: cellSize,
              height: cellSize,
            }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            style={{ zIndex: 5 }}
          >
            <motion.div
              className="absolute inset-0 border-2 border-primary rounded-lg"
              animate={{ 
                boxShadow: [
                  "0 0 10px hsl(var(--primary))",
                  "0 0 25px hsl(var(--primary))",
                  "0 0 10px hsl(var(--primary))"
                ]
              }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          </motion.div>
        )}
      </div>

      {/* Ambient lighting effect */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "radial-gradient(ellipse at 50% 30%, transparent 0%, hsl(var(--background) / 0.4) 100%)",
        }}
      />
    </div>
  );
};

export default Tabletop;
export { useFloatingDamage };