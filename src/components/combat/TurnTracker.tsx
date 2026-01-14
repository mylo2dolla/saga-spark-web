import { motion } from "framer-motion";
import { ChevronRight, Swords, Clock, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Character } from "./CombatMiniature";

interface TurnTrackerProps {
  characters: Character[];
  currentTurnIndex: number;
  roundNumber: number;
  onEndTurn?: () => void;
  onSkipTurn?: () => void;
}

const TurnTracker = ({ 
  characters, 
  currentTurnIndex, 
  roundNumber,
  onEndTurn,
  onSkipTurn 
}: TurnTrackerProps) => {
  const sortedByInitiative = [...characters].sort((a, b) => b.initiative - a.initiative);
  const currentCharacter = sortedByInitiative[currentTurnIndex];

  return (
    <div className="bg-card/80 backdrop-blur-sm border border-border rounded-lg p-3">
      {/* Round Counter */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Swords className="w-4 h-4 text-destructive" />
          <span className="font-display text-sm text-foreground">Combat</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>Round {roundNumber}</span>
        </div>
      </div>

      {/* Current Turn Highlight */}
      <motion.div
        key={currentCharacter?.id}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        className={`
          mb-3 p-2 rounded-lg border-2
          ${currentCharacter?.isEnemy 
            ? "bg-destructive/10 border-destructive/50" 
            : "bg-primary/10 border-primary/50"
          }
        `}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 1, repeat: Infinity }}
              className={`w-8 h-8 rounded-full flex items-center justify-center font-display font-bold text-sm
                ${currentCharacter?.isEnemy 
                  ? "bg-destructive text-destructive-foreground" 
                  : "bg-primary text-primary-foreground"
                }
              `}
            >
              {currentCharacter?.name.charAt(0)}
            </motion.div>
            <div>
              <div className="font-display text-sm text-foreground">
                {currentCharacter?.name}'s Turn
              </div>
              <div className="text-xs text-muted-foreground">
                {currentCharacter?.class} • Init {currentCharacter?.initiative}
              </div>
            </div>
          </div>
          
          {!currentCharacter?.isEnemy && (
            <div className="flex gap-1">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={onSkipTurn}
                className="h-7 px-2"
              >
                <SkipForward className="w-3 h-3" />
              </Button>
              <Button 
                variant="combat" 
                size="sm"
                onClick={onEndTurn}
                className="h-7"
              >
                End Turn
              </Button>
            </div>
          )}
        </div>
      </motion.div>

      {/* Turn Order Queue */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
        {sortedByInitiative.map((char, index) => {
          const isActive = index === currentTurnIndex;
          const isPast = index < currentTurnIndex;
          const isDead = char.hp <= 0;

          return (
            <motion.div
              key={char.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ 
                opacity: isDead ? 0.3 : isPast ? 0.5 : 1, 
                scale: isActive ? 1.1 : 1,
              }}
              className="flex items-center"
            >
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center
                  text-xs font-display font-bold
                  transition-all duration-300
                  ${isActive 
                    ? char.isEnemy 
                      ? "bg-destructive text-destructive-foreground ring-2 ring-destructive ring-offset-1 ring-offset-background" 
                      : "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1 ring-offset-background"
                    : char.isEnemy
                      ? "bg-destructive/30 text-destructive"
                      : "bg-muted text-muted-foreground"
                  }
                  ${isDead ? "line-through opacity-40" : ""}
                `}
              >
                {char.name.charAt(0)}
              </div>
              {index < sortedByInitiative.length - 1 && (
                <ChevronRight className="w-3 h-3 text-muted-foreground mx-0.5" />
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default TurnTracker;
