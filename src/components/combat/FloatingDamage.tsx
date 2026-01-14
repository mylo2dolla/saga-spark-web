import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface DamageNumber {
  id: string;
  value: number;
  type: "damage" | "heal" | "critical" | "miss";
  position: { x: number; y: number };
}

interface FloatingDamageProps {
  damages: DamageNumber[];
  onComplete?: (id: string) => void;
}

const FloatingDamage = ({ damages, onComplete }: FloatingDamageProps) => {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      <AnimatePresence>
        {damages.map((damage) => (
          <motion.div
            key={damage.id}
            initial={{ 
              opacity: 1, 
              scale: 0.5, 
              x: damage.position.x, 
              y: damage.position.y 
            }}
            animate={{ 
              opacity: 0, 
              scale: 1.5, 
              y: damage.position.y - 80,
              x: damage.position.x + (Math.random() - 0.5) * 40,
            }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            onAnimationComplete={() => onComplete?.(damage.id)}
            className={`
              absolute font-display font-bold text-2xl
              ${damage.type === "damage" ? "text-destructive" : ""}
              ${damage.type === "heal" ? "text-success" : ""}
              ${damage.type === "critical" ? "text-primary text-3xl" : ""}
              ${damage.type === "miss" ? "text-muted-foreground text-lg italic" : ""}
            `}
            style={{
              textShadow: damage.type === "critical" 
                ? "0 0 20px hsl(var(--primary)), 0 2px 4px rgba(0,0,0,0.8)" 
                : "0 2px 4px rgba(0,0,0,0.8)",
            }}
          >
            {damage.type === "miss" ? "MISS" : (
              <>
                {damage.type === "heal" ? "+" : "-"}
                {damage.value}
                {damage.type === "critical" && " ⚔️"}
              </>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default FloatingDamage;

// Hook to manage floating damage numbers
export function useFloatingDamage() {
  const [damages, setDamages] = useState<DamageNumber[]>([]);

  const addDamage = (
    value: number, 
    type: DamageNumber["type"], 
    position: { x: number; y: number }
  ) => {
    const id = `${Date.now()}-${Math.random()}`;
    setDamages(prev => [...prev, { id, value, type, position }]);
  };

  const removeDamage = (id: string) => {
    setDamages(prev => prev.filter(d => d.id !== id));
  };

  return { damages, addDamage, removeDamage };
}
