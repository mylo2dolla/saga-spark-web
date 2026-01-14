import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Dices } from "lucide-react";

type DiceType = "d4" | "d6" | "d8" | "d10" | "d12" | "d20";

interface DiceRollerProps {
  onRoll?: (dice: DiceType, result: number) => void;
  compact?: boolean;
}

const diceConfig: Record<DiceType, { max: number; color: string }> = {
  d4: { max: 4, color: "from-green-500 to-emerald-600" },
  d6: { max: 6, color: "from-blue-500 to-cyan-600" },
  d8: { max: 8, color: "from-purple-500 to-violet-600" },
  d10: { max: 10, color: "from-orange-500 to-amber-600" },
  d12: { max: 12, color: "from-red-500 to-rose-600" },
  d20: { max: 20, color: "from-primary to-amber-500" },
};

const DiceRoller = ({ onRoll, compact = false }: DiceRollerProps) => {
  const [lastRoll, setLastRoll] = useState<{ dice: DiceType; result: number } | null>(null);
  const [isRolling, setIsRolling] = useState(false);

  const rollDice = (dice: DiceType) => {
    if (isRolling) return;
    
    setIsRolling(true);
    
    // Simulate rolling animation
    setTimeout(() => {
      const result = Math.floor(Math.random() * diceConfig[dice].max) + 1;
      setLastRoll({ dice, result });
      setIsRolling(false);
      onRoll?.(dice, result);
    }, 600);
  };

  const isCritical = lastRoll?.result === diceConfig[lastRoll?.dice]?.max;
  const isFumble = lastRoll?.result === 1;

  return (
    <div className={`${compact ? "p-2" : "p-4"} bg-card/50 backdrop-blur-sm rounded-lg border border-border`}>
      <div className="flex items-center gap-2 mb-3">
        <Dices className="w-5 h-5 text-primary" />
        <span className="font-display text-sm text-foreground">Roll Dice</span>
      </div>
      
      <div className={`grid ${compact ? "grid-cols-3 gap-1" : "grid-cols-6 gap-2"}`}>
        {(Object.keys(diceConfig) as DiceType[]).map((dice) => (
          <motion.button
            key={dice}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => rollDice(dice)}
            disabled={isRolling}
            className={`
              bg-gradient-to-br ${diceConfig[dice].color} 
              text-white font-bold rounded-lg 
              ${compact ? "p-2 text-xs" : "p-3 text-sm"}
              shadow-lg hover:shadow-xl transition-shadow
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            {dice.toUpperCase()}
          </motion.button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {lastRoll && (
          <motion.div
            key={`${lastRoll.dice}-${lastRoll.result}`}
            initial={{ scale: 0.5, opacity: 0, rotateZ: -180 }}
            animate={{ scale: 1, opacity: 1, rotateZ: 0 }}
            exit={{ scale: 0.5, opacity: 0 }}
            className={`
              mt-4 text-center p-4 rounded-lg
              ${isCritical ? "bg-primary/20 border-2 border-primary" : ""}
              ${isFumble ? "bg-destructive/20 border-2 border-destructive" : ""}
              ${!isCritical && !isFumble ? "bg-muted/50" : ""}
            `}
          >
            <div className="text-xs text-muted-foreground mb-1">{lastRoll.dice.toUpperCase()}</div>
            <div className={`
              text-4xl font-display font-bold
              ${isCritical ? "text-primary text-glow-gold" : ""}
              ${isFumble ? "text-destructive" : ""}
              ${!isCritical && !isFumble ? "text-foreground" : ""}
            `}>
              {lastRoll.result}
            </div>
            {isCritical && (
              <div className="text-xs text-primary font-bold mt-1 uppercase tracking-wider">
                Critical Hit!
              </div>
            )}
            {isFumble && (
              <div className="text-xs text-destructive font-bold mt-1 uppercase tracking-wider">
                Critical Fail!
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DiceRoller;
