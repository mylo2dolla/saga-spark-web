import { motion } from "framer-motion";

type EffectType = "fire" | "ice" | "lightning" | "heal" | "arcane" | "physical";

interface SpellEffectProps {
  type: EffectType;
  position: { x: number; y: number };
  targetPosition?: { x: number; y: number };
  onComplete?: () => void;
}

const effectColors: Record<EffectType, { primary: string; secondary: string; glow: string }> = {
  fire: { 
    primary: "hsl(25 90% 50%)", 
    secondary: "hsl(15 85% 45%)", 
    glow: "hsl(25 100% 60% / 0.6)" 
  },
  ice: { 
    primary: "hsl(200 70% 60%)", 
    secondary: "hsl(190 80% 70%)", 
    glow: "hsl(200 80% 70% / 0.6)" 
  },
  lightning: { 
    primary: "hsl(55 90% 60%)", 
    secondary: "hsl(45 100% 50%)", 
    glow: "hsl(55 100% 70% / 0.8)" 
  },
  heal: { 
    primary: "hsl(140 50% 50%)", 
    secondary: "hsl(120 60% 60%)", 
    glow: "hsl(140 60% 60% / 0.6)" 
  },
  arcane: { 
    primary: "hsl(270 60% 55%)", 
    secondary: "hsl(280 70% 65%)", 
    glow: "hsl(270 80% 65% / 0.6)" 
  },
  physical: { 
    primary: "hsl(0 0% 80%)", 
    secondary: "hsl(0 0% 60%)", 
    glow: "hsl(0 0% 90% / 0.4)" 
  },
};

const SpellEffect = ({ type, position, targetPosition, onComplete }: SpellEffectProps) => {
  const colors = effectColors[type];

  // Particle explosion effect
  if (!targetPosition) {
    return (
      <motion.div
        className="absolute pointer-events-none"
        style={{ left: position.x, top: position.y }}
        initial={{ opacity: 1 }}
        animate={{ opacity: 0 }}
        transition={{ duration: 0.8 }}
        onAnimationComplete={onComplete}
      >
        {/* Central burst */}
        <motion.div
          initial={{ scale: 0, opacity: 1 }}
          animate={{ scale: 3, opacity: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="absolute w-20 h-20 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{
            background: `radial-gradient(circle, ${colors.primary} 0%, ${colors.secondary} 50%, transparent 100%)`,
            boxShadow: `0 0 40px ${colors.glow}`,
          }}
        />

        {/* Particles */}
        {[...Array(12)].map((_, i) => {
          const angle = (i * 30) * Math.PI / 180;
          const distance = 60 + Math.random() * 40;
          return (
            <motion.div
              key={i}
              initial={{ 
                x: 0, 
                y: 0, 
                scale: 1, 
                opacity: 1 
              }}
              animate={{ 
                x: Math.cos(angle) * distance, 
                y: Math.sin(angle) * distance,
                scale: 0,
                opacity: 0,
              }}
              transition={{ 
                duration: 0.5 + Math.random() * 0.3, 
                ease: "easeOut",
                delay: Math.random() * 0.1,
              }}
              className="absolute w-3 h-3 rounded-full -translate-x-1/2 -translate-y-1/2"
              style={{ backgroundColor: colors.primary }}
            />
          );
        })}

        {/* Ring effect */}
        <motion.div
          initial={{ scale: 0.5, opacity: 1, borderWidth: 4 }}
          animate={{ scale: 2.5, opacity: 0, borderWidth: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="absolute w-16 h-16 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{ borderColor: colors.primary, borderStyle: "solid" }}
        />
      </motion.div>
    );
  }

  // Projectile effect
  const dx = targetPosition.x - position.x;
  const dy = targetPosition.y - position.y;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  return (
    <motion.div
      className="absolute pointer-events-none"
      style={{ left: position.x, top: position.y }}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ delay: 0.4, duration: 0.2 }}
      onAnimationComplete={onComplete}
    >
      {/* Projectile */}
      <motion.div
        initial={{ x: 0, y: 0, scale: 0.5 }}
        animate={{ 
          x: dx, 
          y: dy,
          scale: [0.5, 1, 1, 0.8],
        }}
        transition={{ duration: 0.4, ease: "easeInOut" }}
        className="absolute w-6 h-6 rounded-full -translate-x-1/2 -translate-y-1/2"
        style={{
          background: `radial-gradient(circle, ${colors.primary} 0%, ${colors.secondary} 100%)`,
          boxShadow: `0 0 20px ${colors.glow}, 0 0 40px ${colors.glow}`,
          transform: `rotate(${angle}deg)`,
        }}
      >
        {/* Trail */}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: [0, 1, 0] }}
          transition={{ duration: 0.4 }}
          className="absolute right-full top-1/2 -translate-y-1/2 w-20 h-2 origin-right"
          style={{
            background: `linear-gradient(to left, ${colors.primary}, transparent)`,
          }}
        />
      </motion.div>
    </motion.div>
  );
};

export default SpellEffect;
