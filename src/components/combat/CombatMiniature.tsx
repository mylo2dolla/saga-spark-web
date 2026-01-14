import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Heart, Shield, Zap, Skull, Crown, Sparkles, Swords } from "lucide-react";

export interface Character {
  id: string;
  name: string;
  class: string;
  level: number;
  hp: number;
  maxHp: number;
  ac: number;
  initiative: number;
  isEnemy?: boolean;
  isActive?: boolean;
  statusEffects?: string[];
  position?: { x: number; y: number };
  imageUrl?: string;
}

interface CombatMiniatureProps {
  character: Character;
  onClick?: () => void;
  onMove?: (position: { x: number; y: number }) => void;
  size?: "sm" | "md" | "lg";
  showDetails?: boolean;
  isTargeted?: boolean;
  showHitAnimation?: boolean;
  showDeathAnimation?: boolean;
}

const statusIcons: Record<string, { icon: typeof Sparkles; color: string }> = {
  poisoned: { icon: Skull, color: "text-green-500" },
  blessed: { icon: Sparkles, color: "text-primary" },
  stunned: { icon: Zap, color: "text-yellow-500" },
  protected: { icon: Shield, color: "text-blue-500" },
};

const CombatMiniature = ({ 
  character, 
  onClick, 
  size = "md",
  showDetails = true,
  isTargeted = false,
  showHitAnimation = false,
  showDeathAnimation = false,
}: CombatMiniatureProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showHit, setShowHit] = useState(false);
  const [showDeath, setShowDeath] = useState(false);
  const [prevHp, setPrevHp] = useState(character.hp);
  
  const hpPercentage = (character.hp / character.maxHp) * 100;
  const isLowHp = hpPercentage <= 25;
  const isCriticalHp = hpPercentage <= 10;
  const isDead = character.hp <= 0;

  // Detect HP changes for hit animation
  useEffect(() => {
    if (character.hp < prevHp && character.hp > 0) {
      setShowHit(true);
      const timeout = setTimeout(() => setShowHit(false), 500);
      return () => clearTimeout(timeout);
    }
    setPrevHp(character.hp);
  }, [character.hp, prevHp]);

  // Death animation trigger
  useEffect(() => {
    if (isDead && !showDeath) {
      setShowDeath(true);
    }
  }, [isDead, showDeath]);

  // External animation triggers
  useEffect(() => {
    if (showHitAnimation) {
      setShowHit(true);
      const timeout = setTimeout(() => setShowHit(false), 500);
      return () => clearTimeout(timeout);
    }
  }, [showHitAnimation]);

  useEffect(() => {
    if (showDeathAnimation) {
      setShowDeath(true);
    }
  }, [showDeathAnimation]);

  const sizeClasses = {
    sm: "w-12 h-12",
    md: "w-16 h-16",
    lg: "w-20 h-20",
  };

  const baseSizes = {
    sm: "w-14 h-14",
    md: "w-20 h-20",
    lg: "w-24 h-24",
  };

  return (
    <motion.div
      className={`relative ${baseSizes[size]} flex flex-col items-center cursor-pointer`}
      onClick={onClick}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      whileHover={{ scale: 1.1, y: -4 }}
      whileTap={{ scale: 0.95 }}
      animate={showHit ? { 
        x: [0, -5, 5, -5, 5, 0],
        filter: ["brightness(1)", "brightness(1.5)", "brightness(1)"]
      } : {}}
      transition={{ duration: 0.3 }}
    >
      {/* Target Indicator */}
      <AnimatePresence>
        {isTargeted && !isDead && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="absolute -inset-4 z-0"
          >
            <motion.div
              className="w-full h-full rounded-full border-4 border-dashed border-destructive"
              animate={{ rotate: 360 }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            />
            <Swords className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-5 h-5 text-destructive" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Turn Indicator */}
      {character.isActive && (
        <motion.div
          className="absolute -inset-2 rounded-full z-0"
          initial={{ opacity: 0 }}
          animate={{ 
            opacity: [0.3, 0.7, 0.3],
            scale: [1, 1.1, 1],
          }}
          transition={{ duration: 1.5, repeat: Infinity }}
          style={{
            background: character.isEnemy 
              ? "radial-gradient(circle, hsl(var(--destructive) / 0.5) 0%, transparent 70%)"
              : "radial-gradient(circle, hsl(var(--primary) / 0.5) 0%, transparent 70%)",
          }}
        />
      )}

      {/* Hit Flash Effect */}
      <AnimatePresence>
        {showHit && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0, 1, 0], scale: [0.8, 1.5, 1.2] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0 z-20 pointer-events-none"
          >
            <div className="absolute inset-0 bg-destructive/50 rounded-full blur-md" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Swords className="w-8 h-8 text-destructive drop-shadow-lg" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Base/Pedestal */}
      <motion.div
        className={`
          ${sizeClasses[size]}
          rounded-full
          ${character.isEnemy 
            ? "bg-gradient-to-br from-destructive/80 to-destructive" 
            : "bg-gradient-to-br from-primary/80 to-primary"
          }
          ${character.isActive ? "ring-2 ring-white ring-offset-2 ring-offset-background" : ""}
          flex items-center justify-center
          shadow-lg
          border-2 border-white/20
          overflow-hidden
          relative z-10
        `}
        animate={
          showDeath && isDead 
            ? { opacity: 0.4, scale: 0.8, filter: "grayscale(100%)" }
            : character.isActive 
              ? {
                  boxShadow: [
                    "0 0 20px hsl(var(--primary) / 0.3)",
                    "0 0 40px hsl(var(--primary) / 0.5)",
                    "0 0 20px hsl(var(--primary) / 0.3)",
                  ],
                }
              : {}
        }
        transition={showDeath ? { duration: 0.5 } : { duration: 1.5, repeat: Infinity }}
      >
        {character.imageUrl ? (
          <img 
            src={character.imageUrl} 
            alt={character.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="font-display font-bold text-white text-lg">
            {character.name.charAt(0)}
          </span>
        )}

        {/* Death overlay */}
        <AnimatePresence>
          {isDead && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center bg-background/60"
            >
              <motion.div
                initial={{ scale: 0, rotate: -180 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 200 }}
              >
                <Skull className="w-6 h-6 text-destructive" />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* HP Bar */}
      {showDetails && !isDead && (
        <div className="w-full mt-1 px-1 relative z-10">
          <div className="h-2 bg-muted rounded-full overflow-hidden border border-border/50">
            <motion.div
              className={`h-full rounded-full ${
                isCriticalHp ? "bg-destructive" :
                isLowHp ? "bg-orange-500" :
                "bg-success"
              }`}
              initial={false}
              animate={{ width: `${hpPercentage}%` }}
              transition={{ type: "spring", stiffness: 100 }}
            />
          </div>
          {/* HP Text */}
          <div className="text-[10px] text-center text-muted-foreground mt-0.5">
            {character.hp}/{character.maxHp}
          </div>
        </div>
      )}

      {/* Name Label */}
      {showDetails && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-0.5 text-center z-10"
        >
          <span className={`text-xs font-medium ${character.isEnemy ? "text-destructive" : "text-foreground"}`}>
            {character.name}
          </span>
        </motion.div>
      )}

      {/* Status Effects */}
      {character.statusEffects && character.statusEffects.length > 0 && (
        <div className="absolute -top-2 -right-2 flex gap-0.5 z-20">
          {character.statusEffects.slice(0, 3).map((effect, i) => {
            const status = statusIcons[effect.toLowerCase()];
            const IconComponent = status?.icon || Sparkles;
            return (
              <motion.div
                key={effect}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className={`w-4 h-4 rounded-full bg-background border border-border flex items-center justify-center`}
              >
                <IconComponent className={`w-2.5 h-2.5 ${status?.color || "text-muted-foreground"}`} />
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Hover Tooltip */}
      <AnimatePresence>
        {isHovered && showDetails && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.95 }}
            className="absolute bottom-full mb-2 z-50 pointer-events-none"
          >
            <div className="bg-popover border border-border rounded-lg p-3 shadow-xl min-w-[140px]">
              <div className="flex items-center gap-2 mb-2">
                {character.isEnemy ? (
                  <Skull className="w-4 h-4 text-destructive" />
                ) : (
                  <Crown className="w-4 h-4 text-primary" />
                )}
                <span className="font-display font-medium text-sm">{character.name}</span>
              </div>
              <div className="text-xs text-muted-foreground mb-2">
                Lvl {character.level} {character.class}
              </div>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <Heart className="w-3 h-3 text-destructive" />
                  <span>{character.hp}/{character.maxHp}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full ${isCriticalHp ? "bg-destructive" : isLowHp ? "bg-orange-500" : "bg-success"}`}
                      style={{ width: `${hpPercentage}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="w-3 h-3 text-accent" />
                  <span>AC {character.ac}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Zap className="w-3 h-3 text-primary" />
                  <span>Init {character.initiative}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default CombatMiniature;
