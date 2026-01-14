import { useState } from "react";
import { motion } from "framer-motion";
import { Heart, Shield, Zap, Skull, Crown, Sparkles } from "lucide-react";

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
  showDetails = true 
}: CombatMiniatureProps) => {
  const [isHovered, setIsHovered] = useState(false);
  
  const hpPercentage = (character.hp / character.maxHp) * 100;
  const isLowHp = hpPercentage <= 25;
  const isCriticalHp = hpPercentage <= 10;
  const isDead = character.hp <= 0;

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
    >
      {/* Active Turn Indicator */}
      {character.isActive && (
        <motion.div
          className="absolute -inset-2 rounded-full"
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
          ${isDead ? "opacity-40 grayscale" : ""}
          flex items-center justify-center
          shadow-lg
          border-2 border-white/20
          overflow-hidden
        `}
        animate={character.isActive ? {
          boxShadow: [
            "0 0 20px hsl(var(--primary) / 0.3)",
            "0 0 40px hsl(var(--primary) / 0.5)",
            "0 0 20px hsl(var(--primary) / 0.3)",
          ],
        } : {}}
        transition={{ duration: 1.5, repeat: Infinity }}
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
        {isDead && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Skull className="w-6 h-6 text-destructive" />
          </div>
        )}
      </motion.div>

      {/* HP Bar */}
      {showDetails && !isDead && (
        <div className="w-full mt-1 px-1">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${
                isCriticalHp ? "bg-destructive" :
                isLowHp ? "bg-orange-500" :
                "bg-success"
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${hpPercentage}%` }}
              transition={{ type: "spring", stiffness: 100 }}
            />
          </div>
        </div>
      )}

      {/* Name Label */}
      {showDetails && (
        <motion.div
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1 text-center"
        >
          <span className={`text-xs font-medium ${character.isEnemy ? "text-destructive" : "text-foreground"}`}>
            {character.name}
          </span>
        </motion.div>
      )}

      {/* Status Effects */}
      {character.statusEffects && character.statusEffects.length > 0 && (
        <div className="absolute -top-2 -right-2 flex gap-0.5">
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
      {isHovered && showDetails && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
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
    </motion.div>
  );
};

export default CombatMiniature;
