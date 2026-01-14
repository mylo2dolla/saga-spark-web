import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

type DiceType = "d4" | "d6" | "d8" | "d10" | "d12" | "d20";

interface Dice3DProps {
  onRoll?: (dice: DiceType, result: number) => void;
  size?: "sm" | "md" | "lg";
}

const diceConfig: Record<DiceType, { max: number; sides: number; shape: string }> = {
  d4: { max: 4, sides: 4, shape: "tetrahedron" },
  d6: { max: 6, sides: 6, shape: "cube" },
  d8: { max: 8, sides: 8, shape: "octahedron" },
  d10: { max: 10, sides: 10, shape: "pentagonal" },
  d12: { max: 12, sides: 12, shape: "dodecahedron" },
  d20: { max: 20, sides: 20, shape: "icosahedron" },
};

const diceColors: Record<DiceType, string> = {
  d4: "from-emerald-600 to-emerald-800",
  d6: "from-blue-600 to-blue-800",
  d8: "from-purple-600 to-purple-800",
  d10: "from-orange-600 to-orange-800",
  d12: "from-rose-600 to-rose-800",
  d20: "from-primary to-amber-600",
};

const Dice3D = ({ onRoll, size = "md" }: Dice3DProps) => {
  const [selectedDice, setSelectedDice] = useState<DiceType | null>(null);
  const [isRolling, setIsRolling] = useState(false);
  const [result, setResult] = useState<{ dice: DiceType; value: number } | null>(null);
  const [showResult, setShowResult] = useState(false);

  const sizeClasses = {
    sm: "w-10 h-10 text-xs",
    md: "w-14 h-14 text-sm",
    lg: "w-20 h-20 text-base",
  };

  const resultSizeClasses = {
    sm: "w-16 h-16 text-2xl",
    md: "w-24 h-24 text-4xl",
    lg: "w-32 h-32 text-5xl",
  };

  const rollDice = useCallback((dice: DiceType) => {
    if (isRolling) return;

    setSelectedDice(dice);
    setIsRolling(true);
    setShowResult(false);

    // Simulate physics-based rolling with multiple intermediate values
    const rollDuration = 1500;
    const intervalDuration = 100;
    const iterations = rollDuration / intervalDuration;
    let currentIteration = 0;

    const rollInterval = setInterval(() => {
      const tempValue = Math.floor(Math.random() * diceConfig[dice].max) + 1;
      setResult({ dice, value: tempValue });
      currentIteration++;

      if (currentIteration >= iterations) {
        clearInterval(rollInterval);
        const finalValue = Math.floor(Math.random() * diceConfig[dice].max) + 1;
        setResult({ dice, value: finalValue });
        setIsRolling(false);
        setShowResult(true);
        onRoll?.(dice, finalValue);
      }
    }, intervalDuration);
  }, [isRolling, onRoll]);

  const isCritical = result && result.value === diceConfig[result.dice]?.max;
  const isFumble = result && result.value === 1;

  return (
    <div className="p-4 bg-card/80 backdrop-blur-sm rounded-xl border border-border">
      {/* Dice Selection */}
      <div className="flex items-center justify-center gap-2 mb-4">
        {(Object.keys(diceConfig) as DiceType[]).map((dice) => (
          <motion.button
            key={dice}
            whileHover={{ scale: 1.1, y: -2 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => rollDice(dice)}
            disabled={isRolling}
            className={`
              ${sizeClasses[size]}
              bg-gradient-to-br ${diceColors[dice]}
              rounded-lg flex items-center justify-center
              font-display font-bold text-white
              shadow-lg hover:shadow-xl
              border border-white/20
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              ${selectedDice === dice && isRolling ? "ring-2 ring-white/50" : ""}
            `}
          >
            {dice.toUpperCase()}
          </motion.button>
        ))}
      </div>

      {/* Rolling Area - 3D Animated Dice */}
      <div className="relative h-40 flex items-center justify-center overflow-hidden rounded-lg bg-gradient-to-b from-muted/50 to-muted border border-border/50">
        {/* Table surface texture */}
        <div className="absolute inset-0 opacity-30">
          <div className="w-full h-full" style={{
            backgroundImage: `radial-gradient(circle at 50% 50%, hsl(var(--primary) / 0.1) 0%, transparent 70%)`,
          }} />
        </div>

        <AnimatePresence mode="wait">
          {selectedDice && (
            <motion.div
              key={`${selectedDice}-${result?.value}-${isRolling}`}
              initial={{ 
                scale: 0.3, 
                rotateX: 0, 
                rotateY: 0, 
                rotateZ: 0,
                y: -100,
                opacity: 0 
              }}
              animate={isRolling ? {
                scale: [0.8, 1.2, 0.9, 1.1, 1],
                rotateX: [0, 720, 1440, 2160, 2520],
                rotateY: [0, 540, 1080, 1620, 1980],
                rotateZ: [0, 360, 720, 1080, 1260],
                y: [0, -30, 10, -10, 0],
                x: [0, 20, -15, 10, 0],
                opacity: 1,
              } : {
                scale: 1,
                rotateX: 0,
                rotateY: 0,
                rotateZ: 0,
                y: 0,
                opacity: 1,
              }}
              exit={{ scale: 0.5, opacity: 0, y: 20 }}
              transition={isRolling ? {
                duration: 1.5,
                ease: "easeOut",
              } : {
                duration: 0.3,
                type: "spring",
                stiffness: 300,
                damping: 20,
              }}
              className={`
                ${resultSizeClasses[size]}
                bg-gradient-to-br ${diceColors[selectedDice]}
                rounded-xl flex items-center justify-center
                font-display font-bold text-white
                shadow-2xl border-2 border-white/30
                ${isCritical && showResult ? "ring-4 ring-primary animate-pulse shadow-[0_0_30px_hsl(var(--primary))]" : ""}
                ${isFumble && showResult ? "ring-4 ring-destructive shadow-[0_0_30px_hsl(var(--destructive))]" : ""}
              `}
              style={{
                transformStyle: "preserve-3d",
                perspective: "1000px",
              }}
            >
              <motion.span
                animate={isRolling ? { opacity: [1, 0.5, 1] } : { opacity: 1 }}
                transition={{ duration: 0.1, repeat: isRolling ? Infinity : 0 }}
              >
                {result?.value || "?"}
              </motion.span>
            </motion.div>
          )}

          {!selectedDice && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-muted-foreground text-sm font-medium"
            >
              Select a die to roll
            </motion.div>
          )}
        </AnimatePresence>

        {/* Critical/Fumble Effects */}
        <AnimatePresence>
          {showResult && isCritical && (
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 pointer-events-none"
            >
              {/* Sparkle effects */}
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ 
                    opacity: [0, 1, 0],
                    scale: [0, 1.5, 0],
                    x: Math.cos(i * 45 * Math.PI / 180) * 60,
                    y: Math.sin(i * 45 * Math.PI / 180) * 60,
                  }}
                  transition={{ delay: i * 0.05, duration: 0.8 }}
                  className="absolute left-1/2 top-1/2 w-2 h-2 bg-primary rounded-full"
                  style={{ 
                    boxShadow: "0 0 10px hsl(var(--primary))",
                    transform: "translate(-50%, -50%)",
                  }}
                />
              ))}
            </motion.div>
          )}

          {showResult && isFumble && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: [0.5, 0.2, 0.5] }}
              transition={{ repeat: 2, duration: 0.2 }}
              className="absolute inset-0 bg-destructive/20 pointer-events-none rounded-lg"
            />
          )}
        </AnimatePresence>
      </div>

      {/* Result Label */}
      <AnimatePresence>
        {showResult && result && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mt-4 text-center"
          >
            <span className="text-xs text-muted-foreground uppercase tracking-wider">
              {result.dice.toUpperCase()} Roll
            </span>
            {isCritical && (
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: [1, 1.1, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
                className="text-primary font-display font-bold text-lg mt-1"
              >
                ✨ CRITICAL HIT! ✨
              </motion.div>
            )}
            {isFumble && (
              <div className="text-destructive font-display font-bold text-lg mt-1">
                💀 Critical Fail 💀
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Dice3D;
