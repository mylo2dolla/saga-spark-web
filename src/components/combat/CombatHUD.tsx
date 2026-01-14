import { motion, AnimatePresence } from "framer-motion";
import { 
  Heart, 
  Shield, 
  Zap, 
  Skull, 
  Crown,
  Swords,
  Clock,
  ChevronRight
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Character } from "./CombatMiniature";

interface CombatHUDProps {
  characters: Character[];
  currentTurnId: string;
  roundNumber: number;
  onEndTurn: () => void;
  onSkipTurn: () => void;
  isMyTurn: boolean;
  myCharacterId?: string;
}

const CombatHUD = ({
  characters,
  currentTurnId,
  roundNumber,
  onEndTurn,
  onSkipTurn,
  isMyTurn,
  myCharacterId,
}: CombatHUDProps) => {
  const sortedCharacters = [...characters].sort((a, b) => b.initiative - a.initiative);
  const currentCharacter = characters.find(c => c.id === currentTurnId);
  const myCharacter = characters.find(c => c.id === myCharacterId);

  const aliveEnemies = characters.filter(c => c.isEnemy && c.hp > 0);
  const aliveAllies = characters.filter(c => !c.isEnemy && c.hp > 0);

  return (
    <div className="absolute top-4 left-4 right-4 flex items-start justify-between gap-4 pointer-events-none">
      {/* Left side - Current turn & initiative */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        className="pointer-events-auto"
      >
        {/* Round indicator */}
        <div className="bg-card/90 backdrop-blur-md border border-border rounded-xl p-4 shadow-lg mb-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-primary/20 flex items-center justify-center">
              <Swords className="w-6 h-6 text-primary" />
            </div>
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wider">Combat</div>
              <div className="font-display text-xl">Round {roundNumber}</div>
            </div>
          </div>
        </div>

        {/* Initiative order */}
        <div className="bg-card/90 backdrop-blur-md border border-border rounded-xl overflow-hidden shadow-lg">
          <div className="p-2 border-b border-border bg-muted/30">
            <span className="text-xs font-medium text-muted-foreground">Turn Order</span>
          </div>
          <div className="p-2 space-y-1">
            {sortedCharacters.slice(0, 6).map((char, index) => {
              const isCurrent = char.id === currentTurnId;
              const isDead = char.hp <= 0;
              
              return (
                <motion.div
                  key={char.id}
                  initial={false}
                  animate={{
                    scale: isCurrent ? 1.02 : 1,
                    x: isCurrent ? 4 : 0,
                  }}
                  className={`
                    flex items-center gap-2 p-2 rounded-lg transition-colors
                    ${isCurrent ? "bg-primary/20 border border-primary/40" : ""}
                    ${isDead ? "opacity-40" : ""}
                  `}
                >
                  {isCurrent && (
                    <motion.div
                      animate={{ x: [0, 4, 0] }}
                      transition={{ duration: 1, repeat: Infinity }}
                    >
                      <ChevronRight className="w-4 h-4 text-primary" />
                    </motion.div>
                  )}
                  <div className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold
                    ${char.isEnemy 
                      ? "bg-destructive/20 text-destructive" 
                      : "bg-primary/20 text-primary"
                    }
                  `}>
                    {char.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{char.name}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Heart className="w-3 h-3" />
                      {char.hp}/{char.maxHp}
                    </div>
                  </div>
                  {isDead && <Skull className="w-4 h-4 text-destructive" />}
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.div>

      {/* Center - Current turn announcement */}
      <AnimatePresence mode="wait">
        {currentCharacter && (
          <motion.div
            key={currentTurnId}
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            className="pointer-events-auto"
          >
            <div className={`
              bg-card/90 backdrop-blur-md border-2 rounded-xl p-4 shadow-xl
              ${isMyTurn ? "border-primary" : "border-border"}
            `}>
              <div className="text-center">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  {isMyTurn ? "Your Turn!" : "Current Turn"}
                </div>
                <div className="flex items-center justify-center gap-2">
                  {currentCharacter.isEnemy ? (
                    <Skull className="w-5 h-5 text-destructive" />
                  ) : (
                    <Crown className="w-5 h-5 text-primary" />
                  )}
                  <span className="font-display text-lg">{currentCharacter.name}</span>
                </div>
                
                {isMyTurn && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-3 flex gap-2"
                  >
                    <Button
                      size="sm"
                      onClick={onEndTurn}
                      className="gap-1"
                    >
                      <Clock className="w-4 h-4" />
                      End Turn
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onSkipTurn}
                    >
                      Skip
                    </Button>
                  </motion.div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Right side - My character stats */}
      {myCharacter && (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="pointer-events-auto"
        >
          <div className="bg-card/90 backdrop-blur-md border border-border rounded-xl p-4 shadow-lg">
            <div className="flex items-center gap-3 mb-3">
              <div className={`
                w-12 h-12 rounded-full flex items-center justify-center
                bg-gradient-to-br from-primary/80 to-primary
                border-2 border-white/20
                ${myCharacter.imageUrl ? "" : ""}
              `}>
                {myCharacter.imageUrl ? (
                  <img 
                    src={myCharacter.imageUrl} 
                    alt={myCharacter.name}
                    className="w-full h-full rounded-full object-cover"
                  />
                ) : (
                  <span className="font-display font-bold text-white text-lg">
                    {myCharacter.name.charAt(0)}
                  </span>
                )}
              </div>
              <div>
                <div className="font-display font-medium">{myCharacter.name}</div>
                <div className="text-xs text-muted-foreground">
                  Level {myCharacter.level} {myCharacter.class}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="space-y-2">
              {/* HP Bar */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="flex items-center gap-1 text-destructive">
                    <Heart className="w-3 h-3" />
                    Health
                  </span>
                  <span>{myCharacter.hp}/{myCharacter.maxHp}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-destructive to-red-400"
                    initial={false}
                    animate={{ width: `${(myCharacter.hp / myCharacter.maxHp) * 100}%` }}
                    transition={{ type: "spring", stiffness: 100 }}
                  />
                </div>
              </div>

              {/* AC & Initiative */}
              <div className="flex gap-4 pt-2">
                <div className="flex items-center gap-1">
                  <Shield className="w-4 h-4 text-accent" />
                  <span className="text-sm font-medium">{myCharacter.ac}</span>
                  <span className="text-xs text-muted-foreground">AC</span>
                </div>
                <div className="flex items-center gap-1">
                  <Zap className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">{myCharacter.initiative}</span>
                  <span className="text-xs text-muted-foreground">Init</span>
                </div>
              </div>
            </div>

            {/* Combat summary */}
            <div className="mt-3 pt-3 border-t border-border flex justify-between text-xs">
              <span className="text-green-500">{aliveAllies.length} Allies</span>
              <span className="text-destructive">{aliveEnemies.length} Enemies</span>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

export default CombatHUD;