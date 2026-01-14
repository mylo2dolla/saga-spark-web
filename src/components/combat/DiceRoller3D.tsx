import { useState, useCallback, forwardRef, useImperativeHandle } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2 } from "lucide-react";

export type DiceType = "d4" | "d6" | "d8" | "d10" | "d12" | "d20";

interface DiceRoll {
  id: string;
  type: DiceType;
  result: number;
  isCritical: boolean;
  isFumble: boolean;
  modifier?: number;
  label?: string;
}

interface DiceRoller3DProps {
  onRollComplete?: (rolls: DiceRoll[]) => void;
  position?: "center" | "corner";
}

export interface DiceRoller3DRef {
  roll: (dice: Array<{ type: DiceType; count?: number; modifier?: number; label?: string }>) => Promise<DiceRoll[]>;
}

const diceConfig: Record<DiceType, { max: number; faces: number; color: string }> = {
  d4: { max: 4, faces: 4, color: "from-emerald-500 to-emerald-700" },
  d6: { max: 6, faces: 6, color: "from-blue-500 to-blue-700" },
  d8: { max: 8, faces: 8, color: "from-purple-500 to-purple-700" },
  d10: { max: 10, faces: 10, color: "from-orange-500 to-orange-700" },
  d12: { max: 12, faces: 12, color: "from-rose-500 to-rose-700" },
  d20: { max: 20, faces: 20, color: "from-amber-400 to-amber-600" },
};

const DiceRoller3D = forwardRef<DiceRoller3DRef, DiceRoller3DProps>(({ 
  onRollComplete,
  position = "center" 
}, ref) => {
  const [activeRolls, setActiveRolls] = useState<DiceRoll[]>([]);
  const [isRolling, setIsRolling] = useState(false);
  const [showResults, setShowResults] = useState(false);

  const generateRoll = useCallback((type: DiceType): number => {
    return Math.floor(Math.random() * diceConfig[type].max) + 1;
  }, []);

  const rollDice = useCallback(async (
    dice: Array<{ type: DiceType; count?: number; modifier?: number; label?: string }>
  ): Promise<DiceRoll[]> => {
    setIsRolling(true);
    setShowResults(false);
    setActiveRolls([]);

    // Expand dice array based on count
    const expandedDice = dice.flatMap(d => 
      Array.from({ length: d.count || 1 }, () => ({
        type: d.type,
        modifier: d.modifier,
        label: d.label,
      }))
    );

    // Create roll objects with placeholder values
    const rolls: DiceRoll[] = expandedDice.map((d, i) => ({
      id: `roll-${Date.now()}-${i}`,
      type: d.type,
      result: 0,
      isCritical: false,
      isFumble: false,
      modifier: d.modifier,
      label: d.label,
    }));

    setActiveRolls(rolls);

    // Simulate rolling animation
    const rollDuration = 1500;
    const updateInterval = 50;
    const iterations = rollDuration / updateInterval;
    let iteration = 0;

    await new Promise<void>((resolve) => {
      const interval = setInterval(() => {
        iteration++;
        
        setActiveRolls(prev => prev.map(roll => ({
          ...roll,
          result: generateRoll(roll.type),
        })));

        if (iteration >= iterations) {
          clearInterval(interval);
          
          // Final results
          const finalRolls = rolls.map(roll => {
            const result = generateRoll(roll.type);
            return {
              ...roll,
              result,
              isCritical: result === diceConfig[roll.type].max,
              isFumble: result === 1,
            };
          });

          setActiveRolls(finalRolls);
          setIsRolling(false);
          setShowResults(true);
          onRollComplete?.(finalRolls);
          
          // Clear after delay
          setTimeout(() => {
            setActiveRolls([]);
            setShowResults(false);
          }, 3000);

          resolve();
        }
      }, updateInterval);
    });

    return activeRolls;
  }, [generateRoll, onRollComplete]);

  useImperativeHandle(ref, () => ({
    roll: rollDice,
  }));

  const totalResult = activeRolls.reduce((sum, roll) => {
    return sum + roll.result + (roll.modifier || 0);
  }, 0);

  const hasAnyCritical = activeRolls.some(r => r.isCritical);
  const hasAnyFumble = activeRolls.some(r => r.isFumble);

  return (
    <AnimatePresence>
      {activeRolls.length > 0 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8, y: 20 }}
          className={`
            fixed z-50 
            ${position === "center" 
              ? "inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm" 
              : "bottom-4 right-4"
            }
          `}
        >
          <motion.div 
            className="bg-card/95 backdrop-blur-md border-2 border-border rounded-2xl p-6 shadow-2xl"
            initial={{ y: -50 }}
            animate={{ y: 0 }}
          >
            {/* Dice container */}
            <div className="flex flex-wrap justify-center gap-4 mb-4">
              {activeRolls.map((roll, index) => (
                <motion.div
                  key={roll.id}
                  initial={{ 
                    rotateX: 0, 
                    rotateY: 0, 
                    rotateZ: 0,
                    y: -100,
                    opacity: 0,
                  }}
                  animate={isRolling ? {
                    rotateX: [0, 720, 1440, 2160],
                    rotateY: [0, 540, 1080, 1620],
                    rotateZ: [0, 360, 720, 1080],
                    y: [0, -20, 10, -5, 0],
                    x: [0, 15, -10, 5, 0],
                    opacity: 1,
                  } : {
                    rotateX: 0,
                    rotateY: 0,
                    rotateZ: 0,
                    y: 0,
                    opacity: 1,
                  }}
                  transition={{
                    duration: isRolling ? 1.5 : 0.3,
                    delay: index * 0.1,
                    ease: "easeOut",
                  }}
                  className={`
                    relative w-20 h-20
                    bg-gradient-to-br ${diceConfig[roll.type].color}
                    rounded-xl flex items-center justify-center
                    shadow-lg border-2 border-white/30
                    ${showResults && roll.isCritical ? "ring-4 ring-primary animate-pulse shadow-[0_0_30px_hsl(var(--primary))]" : ""}
                    ${showResults && roll.isFumble ? "ring-4 ring-destructive shadow-[0_0_30px_hsl(var(--destructive))]" : ""}
                  `}
                  style={{
                    transformStyle: "preserve-3d",
                    perspective: "1000px",
                  }}
                >
                  <motion.span
                    className="font-display text-3xl font-bold text-white drop-shadow-lg"
                    animate={isRolling ? { opacity: [1, 0.5, 1] } : {}}
                    transition={{ duration: 0.1, repeat: isRolling ? Infinity : 0 }}
                  >
                    {roll.result || "?"}
                  </motion.span>

                  {/* Dice type label */}
                  <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[10px] font-bold text-white/80 bg-black/40 px-1.5 rounded">
                    {roll.type.toUpperCase()}
                  </span>
                </motion.div>
              ))}
            </div>

            {/* Total result */}
            {showResults && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center"
              >
                <div className="text-sm text-muted-foreground mb-1">
                  {activeRolls.map(r => `${r.result}${r.modifier ? `+${r.modifier}` : ""}`).join(" + ")}
                </div>
                <motion.div
                  className={`
                    font-display text-4xl font-bold
                    ${hasAnyCritical ? "text-primary" : ""}
                    ${hasAnyFumble && !hasAnyCritical ? "text-destructive" : ""}
                    ${!hasAnyCritical && !hasAnyFumble ? "text-foreground" : ""}
                  `}
                  animate={hasAnyCritical ? { scale: [1, 1.1, 1] } : {}}
                  transition={{ duration: 0.5, repeat: hasAnyCritical ? Infinity : 0 }}
                >
                  = {totalResult}
                </motion.div>

                {/* Critical/Fumble announcement */}
                {hasAnyCritical && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 0.5, repeat: Infinity }}
                    className="text-primary font-display font-bold text-lg mt-2"
                  >
                    ✨ CRITICAL HIT! ✨
                  </motion.div>
                )}
                {hasAnyFumble && !hasAnyCritical && (
                  <div className="text-destructive font-display font-bold text-lg mt-2">
                    💀 Critical Fail! 💀
                  </div>
                )}

                {/* Roll label */}
                {activeRolls[0]?.label && (
                  <div className="text-sm text-muted-foreground mt-2">
                    {activeRolls[0].label}
                  </div>
                )}
              </motion.div>
            )}

            {/* Rolling indicator */}
            {isRolling && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center text-muted-foreground text-sm"
              >
                <motion.span
                  animate={{ opacity: [0.5, 1, 0.5] }}
                  transition={{ duration: 0.5, repeat: Infinity }}
                >
                  Rolling...
                </motion.span>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

DiceRoller3D.displayName = "DiceRoller3D";

export default DiceRoller3D;