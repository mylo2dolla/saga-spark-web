import { useState } from "react";
import { motion } from "framer-motion";
import CombatMiniature, { type Character } from "./CombatMiniature";

interface CombatGridProps {
  characters: Character[];
  gridSize?: { rows: number; cols: number };
  onCharacterClick?: (character: Character) => void;
  onCellClick?: (position: { x: number; y: number }) => void;
  selectedCharacterId?: string;
  highlightedCells?: { x: number; y: number; type: "move" | "attack" | "spell" }[];
}

const CombatGrid = ({
  characters,
  gridSize = { rows: 8, cols: 10 },
  onCharacterClick,
  onCellClick,
  selectedCharacterId,
  highlightedCells = [],
}: CombatGridProps) => {
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);

  const getCharacterAtPosition = (x: number, y: number) => {
    return characters.find(c => c.position?.x === x && c.position?.y === y);
  };

  const getCellHighlight = (x: number, y: number) => {
    return highlightedCells.find(cell => cell.x === x && cell.y === y);
  };

  const highlightColors = {
    move: "bg-accent/30 border-accent",
    attack: "bg-destructive/30 border-destructive",
    spell: "bg-arcane/30 border-arcane",
  };

  return (
    <div className="relative w-full aspect-[5/4] bg-gradient-to-br from-muted/30 to-muted/10 rounded-xl border border-border overflow-hidden">
      {/* Grid Background Pattern */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, hsl(var(--border) / 0.3) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--border) / 0.3) 1px, transparent 1px)
          `,
          backgroundSize: `${100 / gridSize.cols}% ${100 / gridSize.rows}%`,
        }}
      />

      {/* Fog of War Overlay (optional, can be toggled) */}
      <div className="absolute inset-0 pointer-events-none">
        <div 
          className="absolute inset-0"
          style={{
            background: "radial-gradient(ellipse at center, transparent 40%, hsl(var(--background) / 0.6) 100%)",
          }}
        />
      </div>

      {/* Grid Cells */}
      <div 
        className="absolute inset-0 grid"
        style={{
          gridTemplateColumns: `repeat(${gridSize.cols}, 1fr)`,
          gridTemplateRows: `repeat(${gridSize.rows}, 1fr)`,
        }}
      >
        {Array.from({ length: gridSize.rows * gridSize.cols }).map((_, index) => {
          const x = index % gridSize.cols;
          const y = Math.floor(index / gridSize.cols);
          const character = getCharacterAtPosition(x, y);
          const highlight = getCellHighlight(x, y);
          const isHovered = hoveredCell?.x === x && hoveredCell?.y === y;

          return (
            <motion.div
              key={`${x}-${y}`}
              className={`
                relative flex items-center justify-center
                border border-transparent
                transition-colors duration-200
                ${highlight ? highlightColors[highlight.type] : ""}
                ${isHovered && !character ? "bg-white/5" : ""}
              `}
              onMouseEnter={() => setHoveredCell({ x, y })}
              onMouseLeave={() => setHoveredCell(null)}
              onClick={() => {
                if (character) {
                  onCharacterClick?.(character);
                } else {
                  onCellClick?.({ x, y });
                }
              }}
            >
              {character && (
                <CombatMiniature
                  character={{
                    ...character,
                    isActive: character.id === selectedCharacterId,
                  }}
                  size="sm"
                  showDetails={false}
                  onClick={() => onCharacterClick?.(character)}
                />
              )}

              {/* Highlight Effect */}
              {highlight && !character && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 0.6, scale: 1 }}
                  className={`
                    absolute inset-1 rounded-lg
                    ${highlight.type === "move" ? "bg-accent/20" : ""}
                    ${highlight.type === "attack" ? "bg-destructive/20" : ""}
                    ${highlight.type === "spell" ? "bg-arcane/20" : ""}
                  `}
                />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Selected Character Highlight */}
      {selectedCharacterId && (
        <motion.div
          layoutId="selection"
          className="absolute pointer-events-none"
          style={{
            width: `${100 / gridSize.cols}%`,
            height: `${100 / gridSize.rows}%`,
            left: `${((characters.find(c => c.id === selectedCharacterId)?.position?.x || 0) / gridSize.cols) * 100}%`,
            top: `${((characters.find(c => c.id === selectedCharacterId)?.position?.y || 0) / gridSize.rows) * 100}%`,
          }}
        >
          <div className="absolute inset-0 border-2 border-primary rounded-lg animate-pulse" />
        </motion.div>
      )}
    </div>
  );
};

export default CombatGrid;
