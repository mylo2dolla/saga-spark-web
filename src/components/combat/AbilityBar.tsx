import { useState } from "react";
import { motion } from "framer-motion";
import { Sword, Shield, Wand2, Heart, Zap, Move, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface Ability {
  id: string;
  name: string;
  type: "attack" | "spell" | "defense" | "heal" | "movement" | "special";
  description: string;
  damage?: string;
  range?: number;
  cooldown?: number;
  currentCooldown?: number;
  manaCost?: number;
  icon?: string;
}

interface AbilityBarProps {
  abilities: Ability[];
  onAbilitySelect: (ability: Ability) => void;
  selectedAbilityId?: string;
  disabled?: boolean;
  mana?: number;
  maxMana?: number;
}

const abilityIcons: Record<Ability["type"], typeof Sword> = {
  attack: Sword,
  spell: Wand2,
  defense: Shield,
  heal: Heart,
  movement: Move,
  special: Zap,
};

const abilityColors: Record<Ability["type"], string> = {
  attack: "from-destructive to-red-700 hover:from-red-600 hover:to-red-800",
  spell: "from-arcane to-purple-700 hover:from-purple-600 hover:to-purple-800",
  defense: "from-accent to-blue-700 hover:from-blue-600 hover:to-blue-800",
  heal: "from-success to-emerald-700 hover:from-emerald-600 hover:to-emerald-800",
  movement: "from-amber-600 to-amber-800 hover:from-amber-500 hover:to-amber-700",
  special: "from-primary to-yellow-700 hover:from-yellow-600 hover:to-yellow-800",
};

const AbilityBar = ({
  abilities,
  onAbilitySelect,
  selectedAbilityId,
  disabled = false,
  mana = 100,
  maxMana = 100,
}: AbilityBarProps) => {
  const [hoveredAbility, setHoveredAbility] = useState<string | null>(null);

  const canUseAbility = (ability: Ability) => {
    if (ability.currentCooldown && ability.currentCooldown > 0) return false;
    if (ability.manaCost && ability.manaCost > mana) return false;
    return true;
  };

  return (
    <div className="bg-card/80 backdrop-blur-sm border border-border rounded-lg p-3">
      {/* Mana Bar */}
      <div className="flex items-center gap-2 mb-3">
        <Wand2 className="w-4 h-4 text-arcane" />
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-arcane to-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${(mana / maxMana) * 100}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground w-12 text-right">
          {mana}/{maxMana}
        </span>
      </div>

      {/* Abilities Grid */}
      <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap sm:gap-2">
        {abilities.map((ability, index) => {
          const Icon = abilityIcons[ability.type];
          const isSelected = selectedAbilityId === ability.id;
          const isOnCooldown = (ability.currentCooldown || 0) > 0;
          const canUse = canUseAbility(ability);
          const isHovered = hoveredAbility === ability.id;

          return (
            <div key={ability.id} className="relative">
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: canUse && !disabled ? 1.1 : 1 }}
                whileTap={{ scale: canUse && !disabled ? 0.95 : 1 }}
                onMouseEnter={() => setHoveredAbility(ability.id)}
                onMouseLeave={() => setHoveredAbility(null)}
                onClick={() => canUse && !disabled && onAbilitySelect(ability)}
                disabled={disabled || !canUse}
                className={`
                  w-14 h-14 rounded-lg
                  bg-gradient-to-br ${abilityColors[ability.type]}
                  flex flex-col items-center justify-center gap-0.5
                  border-2 transition-all duration-200
                  ${isSelected 
                    ? "border-white ring-2 ring-white/50 ring-offset-2 ring-offset-background" 
                    : "border-white/20"
                  }
                  ${!canUse || disabled ? "opacity-50 cursor-not-allowed grayscale" : "cursor-pointer"}
                  shadow-lg
                `}
              >
                <Icon className="w-5 h-5 text-white" />
                <span className="text-[9px] text-white/80 font-medium truncate max-w-full px-1">
                  {ability.name}
                </span>

                {/* Cooldown Overlay */}
                {isOnCooldown && (
                  <div className="absolute inset-0 bg-background/70 rounded-lg flex items-center justify-center">
                    <span className="font-display font-bold text-foreground">
                      {ability.currentCooldown}
                    </span>
                  </div>
                )}
              </motion.button>

              {/* Ability Tooltip */}
              {isHovered && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 pointer-events-none"
                >
                  <div className="bg-popover border border-border rounded-lg p-3 shadow-xl min-w-[180px]">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${
                        ability.type === "attack" ? "text-destructive" :
                        ability.type === "spell" ? "text-arcane" :
                        ability.type === "heal" ? "text-success" :
                        "text-primary"
                      }`} />
                      <span className="font-display font-medium text-sm">{ability.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">
                      {ability.description}
                    </p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {ability.damage && (
                        <span className="text-destructive">⚔️ {ability.damage}</span>
                      )}
                      {ability.range && (
                        <span className="text-muted-foreground">📏 {ability.range} tiles</span>
                      )}
                      {ability.manaCost && (
                        <span className="text-arcane">💧 {ability.manaCost} MP</span>
                      )}
                      {ability.cooldown && (
                        <span className="text-muted-foreground">⏱️ {ability.cooldown} turns</span>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          );
        })}

        {/* More Abilities Button */}
        {abilities.length > 6 && (
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-14 h-14"
            disabled={disabled}
          >
            <MoreHorizontal className="w-5 h-5" />
          </Button>
        )}
      </div>
    </div>
  );
};

export default AbilityBar;
