import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Sword, 
  Footprints, 
  Sparkles, 
  Shield, 
  Package, 
  MessageSquare,
  X,
  Target,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Ability } from "./AbilityBar";

type ActionType = "move" | "attack" | "spell" | "defend" | "item" | "special";

interface ActionPanelProps {
  abilities: Ability[];
  onActionSelect: (action: { type: ActionType; ability?: Ability }) => void;
  onCancel: () => void;
  canMove: boolean;
  canAttack: boolean;
  currentMana?: number;
  maxMana?: number;
  disabled?: boolean;
  selectedAction?: ActionType;
}

const ActionPanel = ({
  abilities,
  onActionSelect,
  onCancel,
  canMove,
  canAttack,
  currentMana = 100,
  maxMana = 100,
  disabled = false,
  selectedAction,
}: ActionPanelProps) => {
  const [showAbilities, setShowAbilities] = useState(false);
  const [activeTab, setActiveTab] = useState<"actions" | "spells" | "items">("actions");

  const primaryActions = [
    { 
      type: "move" as ActionType, 
      icon: Footprints, 
      label: "Move", 
      color: "text-accent",
      bgColor: "bg-accent/20 hover:bg-accent/30",
      available: canMove,
    },
    { 
      type: "attack" as ActionType, 
      icon: Sword, 
      label: "Attack", 
      color: "text-destructive",
      bgColor: "bg-destructive/20 hover:bg-destructive/30",
      available: canAttack,
    },
    { 
      type: "spell" as ActionType, 
      icon: Sparkles, 
      label: "Cast Spell", 
      color: "text-arcane",
      bgColor: "bg-arcane/20 hover:bg-arcane/30",
      available: true,
    },
    { 
      type: "defend" as ActionType, 
      icon: Shield, 
      label: "Defend", 
      color: "text-primary",
      bgColor: "bg-primary/20 hover:bg-primary/30",
      available: true,
    },
  ];

  const spellAbilities = abilities.filter(a => a.type === "spell" || a.type === "heal");
  const attackAbilities = abilities.filter(a => a.type === "attack" || a.type === "movement");
  const utilityAbilities = abilities.filter(a => a.type === "defense" || a.type === "special");

  const handleActionClick = (type: ActionType) => {
    if (type === "spell") {
      setShowAbilities(true);
      setActiveTab("spells");
    } else if (type === "attack") {
      if (attackAbilities.length > 0) {
        setShowAbilities(true);
        setActiveTab("actions");
      } else {
        onActionSelect({ type });
      }
    } else {
      onActionSelect({ type });
    }
  };

  const handleAbilitySelect = (ability: Ability) => {
    const type: ActionType = ability.type === "spell" || ability.type === "heal" ? "spell" : "attack";
    onActionSelect({ type, ability });
    setShowAbilities(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
        <h3 className="font-display text-sm font-medium flex items-center gap-2">
          <Target className="w-4 h-4 text-primary" />
          Choose Action
        </h3>
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-7 w-7 p-0">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Mana Bar */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-arcane" />
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-arcane to-primary"
              initial={{ width: 0 }}
              animate={{ width: `${(currentMana / maxMana) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{currentMana}/{maxMana}</span>
        </div>
      </div>

      {/* Main Actions */}
      {!showAbilities && (
        <div className="p-3">
          <div className="grid grid-cols-2 gap-2">
            {primaryActions.map((action) => {
              const Icon = action.icon;
              const isSelected = selectedAction === action.type;
              
              return (
                <motion.button
                  key={action.type}
                  onClick={() => handleActionClick(action.type)}
                  disabled={disabled || !action.available}
                  whileHover={{ scale: action.available ? 1.02 : 1 }}
                  whileTap={{ scale: action.available ? 0.98 : 1 }}
                  className={`
                    flex flex-col items-center justify-center gap-1 p-3 rounded-lg
                    transition-all duration-200
                    ${action.bgColor}
                    ${!action.available ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
                    ${isSelected ? "ring-2 ring-white" : ""}
                  `}
                >
                  <Icon className={`w-6 h-6 ${action.color}`} />
                  <span className="text-xs font-medium">{action.label}</span>
                </motion.button>
              );
            })}
          </div>

          {/* Secondary Actions */}
          <div className="flex gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-2"
              onClick={() => {
                setShowAbilities(true);
                setActiveTab("items");
              }}
            >
              <Package className="w-4 h-4" />
              Items
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-2"
              onClick={() => onActionSelect({ type: "special" })}
            >
              <MessageSquare className="w-4 h-4" />
              Other
            </Button>
          </div>
        </div>
      )}

      {/* Abilities Panel */}
      <AnimatePresence>
        {showAbilities && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-border"
          >
            {/* Tabs */}
            <div className="flex border-b border-border">
              {[
                { id: "actions" as const, label: "Attacks", icon: Sword },
                { id: "spells" as const, label: "Spells", icon: Sparkles },
                { id: "items" as const, label: "Items", icon: Package },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium
                    transition-colors
                    ${activeTab === tab.id 
                      ? "bg-muted text-foreground border-b-2 border-primary" 
                      : "text-muted-foreground hover:text-foreground"
                    }
                  `}
                >
                  <tab.icon className="w-3 h-3" />
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Ability List */}
            <ScrollArea className="h-48">
              <div className="p-2 space-y-1">
                {(activeTab === "actions" ? attackAbilities : 
                  activeTab === "spells" ? spellAbilities : 
                  utilityAbilities).map((ability) => {
                  const canAfford = !ability.manaCost || currentMana >= ability.manaCost;
                  
                  return (
                    <motion.button
                      key={ability.id}
                      onClick={() => canAfford && handleAbilitySelect(ability)}
                      disabled={!canAfford}
                      whileHover={{ x: canAfford ? 4 : 0 }}
                      className={`
                        w-full flex items-center gap-3 p-2 rounded-lg text-left
                        transition-colors
                        ${canAfford 
                          ? "hover:bg-muted cursor-pointer" 
                          : "opacity-50 cursor-not-allowed"
                        }
                      `}
                    >
                      <div className={`
                        w-10 h-10 rounded-lg flex items-center justify-center
                        ${ability.type === "spell" ? "bg-arcane/20" : ""}
                        ${ability.type === "attack" ? "bg-destructive/20" : ""}
                        ${ability.type === "heal" ? "bg-green-500/20" : ""}
                        ${ability.type === "defense" ? "bg-primary/20" : ""}
                        ${ability.type === "special" ? "bg-amber-500/20" : ""}
                      `}>
                        {ability.type === "spell" && <Sparkles className="w-5 h-5 text-arcane" />}
                        {ability.type === "attack" && <Sword className="w-5 h-5 text-destructive" />}
                        {ability.type === "heal" && <Shield className="w-5 h-5 text-green-500" />}
                        {ability.type === "defense" && <Shield className="w-5 h-5 text-primary" />}
                        {ability.type === "special" && <Zap className="w-5 h-5 text-amber-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{ability.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {ability.description}
                        </div>
                      </div>
                      <div className="text-right">
                        {ability.damage && (
                          <div className="text-xs text-destructive font-medium">{ability.damage}</div>
                        )}
                        {ability.manaCost && (
                          <div className="text-xs text-arcane">{ability.manaCost} MP</div>
                        )}
                      </div>
                    </motion.button>
                  );
                })}

                {/* Empty state */}
                {(activeTab === "actions" ? attackAbilities : 
                  activeTab === "spells" ? spellAbilities : 
                  utilityAbilities).length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    No {activeTab} available
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Back button */}
            <div className="p-2 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setShowAbilities(false)}
              >
                Back to Actions
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

export default ActionPanel;