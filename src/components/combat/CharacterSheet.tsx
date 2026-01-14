import { motion, AnimatePresence } from "framer-motion";
import { 
  Heart, 
  Shield, 
  Zap, 
  Sword, 
  Wand2, 
  Star,
  Package,
  Scroll,
  X,
  Sparkles,
  Crown,
  User
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import type { 
  CharacterStats, 
  CharacterResources, 
  PassiveAbility, 
  GameAbility, 
  InventoryItem, 
  EquipmentSlots 
} from "@/types/game";

// Legacy types for backwards compatibility
interface LegacyAbility {
  id: string;
  name: string;
  type: string;
  description: string;
  damage?: string;
  range?: number;
  manaCost?: number;
  cooldown?: number;
}

interface CharacterSheetProps {
  character: {
    id?: string;
    name: string;
    class: string;
    class_description?: string;
    level: number;
    hp: number;
    maxHp?: number;
    max_hp?: number;
    ac: number;
    initiative?: number;
    xp?: number;
    xpToNext?: number;
    xp_to_next?: number;
    imageUrl?: string;
    stats?: CharacterStats;
    resources?: CharacterResources;
    passives?: PassiveAbility[];
    abilities?: (GameAbility | LegacyAbility)[];
    equipment?: EquipmentSlots | Record<string, InventoryItem | null>;
    backpack?: InventoryItem[];
    inventory?: { id: string; name: string; quantity: number }[];
  };
  onClose?: () => void;
  isOpen?: boolean;
}

const rarityColors: Record<string, string> = {
  common: "text-muted-foreground border-muted",
  uncommon: "text-green-400 border-green-500/50",
  rare: "text-blue-400 border-blue-500/50",
  epic: "text-purple-400 border-purple-500/50",
  legendary: "text-amber-400 border-amber-500/50",
};

const statIcons: Record<string, string> = {
  strength: "💪",
  dexterity: "🏃",
  constitution: "🛡️",
  intelligence: "📚",
  wisdom: "🔮",
  charisma: "✨",
};

const getModifier = (stat: number) => {
  const mod = Math.floor((stat - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
};

const slotLabels: Record<string, string> = {
  weapon: "Main Hand",
  armor: "Chest",
  shield: "Off Hand",
  helmet: "Head",
  boots: "Feet",
  gloves: "Hands",
  ring1: "Ring",
  ring2: "Ring",
  trinket1: "Trinket",
  trinket2: "Trinket",
  trinket3: "Trinket",
};

const abilityTypeIcons: Record<string, React.ReactNode> = {
  active: <Sword className="w-4 h-4" />,
  passive: <Sparkles className="w-4 h-4" />,
  reaction: <Zap className="w-4 h-4" />,
  attack: <Sword className="w-4 h-4 text-destructive" />,
  spell: <Wand2 className="w-4 h-4 text-purple-400" />,
  defense: <Shield className="w-4 h-4 text-blue-400" />,
  heal: <Heart className="w-4 h-4 text-green-400" />,
  utility: <Sparkles className="w-4 h-4 text-amber-400" />,
};

const CharacterSheet = ({ character, onClose, isOpen = true }: CharacterSheetProps) => {
  if (!isOpen) return null;

  const maxHp = character.max_hp || character.maxHp || 1;
  const hpPercentage = (character.hp / maxHp) * 100;
  const xpToNext = character.xp_to_next || character.xpToNext || 300;
  const xpPercentage = character.xp ? (character.xp / xpToNext) * 100 : 0;

  const stats = character.stats || {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  };

  const resources = character.resources || {
    mana: 0,
    maxMana: 0,
    rage: 0,
    maxRage: 0,
    stamina: 0,
    maxStamina: 0,
  };

  const passives = character.passives || [];
  const abilities = character.abilities || [];
  const equipment = character.equipment || {};
  const backpack = character.backpack || [];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="bg-card/95 backdrop-blur-sm border border-border rounded-lg overflow-hidden w-96"
      >
        {/* Header */}
        <div className="relative p-4 bg-gradient-to-r from-primary/20 to-secondary/20 border-b border-border">
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="absolute top-2 right-2 w-8 h-8 p-0"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
          
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center border-2 border-primary/50">
              {character.imageUrl ? (
                <img 
                  src={character.imageUrl} 
                  alt={character.name}
                  className="w-full h-full rounded-full object-cover"
                />
              ) : (
                <User className="w-8 h-8 text-primary-foreground" />
              )}
            </div>
            <div className="flex-1">
              <h3 className="font-display text-lg text-foreground">{character.name}</h3>
              <p className="text-sm text-muted-foreground">
                Level {character.level} {character.class}
              </p>
              {character.class_description && (
                <p className="text-xs text-muted-foreground italic mt-1 line-clamp-2">
                  {character.class_description}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Vitals */}
        <div className="p-4 border-b border-border space-y-3">
          {/* HP Bar */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Heart className="w-4 h-4 text-destructive" />
                <span className="text-sm font-medium">Health</span>
              </div>
              <span className="text-sm font-display">{character.hp}/{maxHp}</span>
            </div>
            <Progress 
              value={hpPercentage} 
              className="h-2"
            />
          </div>

          {/* XP Bar */}
          {character.xp !== undefined && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Crown className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-medium">Experience</span>
                </div>
                <span className="text-sm font-display">{character.xp}/{xpToNext}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${xpPercentage}%` }}
                />
              </div>
            </div>
          )}

          {/* Resource Bars */}
          {resources.maxMana > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-medium">Mana</span>
                </div>
                <span className="text-sm font-display">{resources.mana}/{resources.maxMana}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all"
                  style={{ width: `${(resources.mana / resources.maxMana) * 100}%` }}
                />
              </div>
            </div>
          )}
          {resources.maxRage > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Zap className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-medium">Rage</span>
                </div>
                <span className="text-sm font-display">{resources.rage}/{resources.maxRage}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-red-500 transition-all"
                  style={{ width: `${(resources.rage / resources.maxRage) * 100}%` }}
                />
              </div>
            </div>
          )}
          {resources.maxStamina > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Sparkles className="w-4 h-4 text-green-400" />
                  <span className="text-sm font-medium">Stamina</span>
                </div>
                <span className="text-sm font-display">{resources.stamina}/{resources.maxStamina}</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${(resources.stamina / resources.maxStamina) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Quick Stats */}
          <div className="flex justify-between pt-2">
            <div className="flex items-center gap-1">
              <Shield className="w-4 h-4 text-primary" />
              <span className="text-sm">AC {character.ac}</span>
            </div>
            {character.initiative !== undefined && (
              <div className="flex items-center gap-1">
                <Zap className="w-4 h-4 text-amber-500" />
                <span className="text-sm">Init +{character.initiative}</span>
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="stats" className="w-full">
          <TabsList className="w-full grid grid-cols-3 bg-muted/50">
            <TabsTrigger value="stats" className="text-xs">Stats</TabsTrigger>
            <TabsTrigger value="abilities" className="text-xs">Abilities</TabsTrigger>
            <TabsTrigger value="gear" className="text-xs">Gear</TabsTrigger>
          </TabsList>

          <ScrollArea className="h-[320px]">
            {/* Stats Tab */}
            <TabsContent value="stats" className="p-4 space-y-4 m-0">
              <div className="grid grid-cols-2 gap-3">
                {Object.entries(stats).map(([stat, value]) => (
                  <div 
                    key={stat}
                    className="p-3 rounded-lg bg-muted/50 border border-border"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-2xl">{statIcons[stat]}</span>
                      <div className="text-right">
                        <span className="text-xl font-bold text-foreground">{value}</span>
                        <span className="text-sm text-muted-foreground ml-1">
                          ({getModifier(value)})
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground capitalize mt-1">{stat}</p>
                  </div>
                ))}
              </div>

              {/* Passives Section */}
              {passives.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
                      <Sparkles className="h-4 w-4 text-primary" />
                      Passive Abilities
                    </h3>
                    <div className="space-y-2">
                      {passives.map((passive, index) => (
                        <div 
                          key={index}
                          className="p-3 rounded-lg bg-primary/10 border border-primary/20"
                        >
                          <h4 className="font-medium text-sm text-foreground">{passive.name}</h4>
                          <p className="text-xs text-muted-foreground mt-1">{passive.description}</p>
                          {passive.effect && (
                            <Badge variant="outline" className="mt-2 text-xs">
                              {passive.effect}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>

            {/* Abilities Tab */}
            <TabsContent value="abilities" className="p-4 space-y-3 m-0">
              {abilities.length > 0 ? (
                abilities.map((ability, index) => {
                  const abilityType = (ability as GameAbility).abilityType || (ability as LegacyAbility).type;
                  return (
                    <div 
                      key={(ability as GameAbility).id || index}
                      className="p-3 rounded-lg bg-muted/30 border border-border hover:border-primary/50 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded bg-primary/20 text-primary">
                            {abilityTypeIcons[abilityType] || <Star className="w-4 h-4" />}
                          </div>
                          <div>
                            <span className="font-medium text-sm">{ability.name}</span>
                            <Badge 
                              variant="outline" 
                              className="text-xs capitalize ml-2"
                            >
                              {abilityType}
                            </Badge>
                          </div>
                        </div>
                        {ability.cooldown && ability.cooldown > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            {ability.cooldown}t CD
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">
                        {ability.description}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {ability.damage && (
                          <Badge variant="destructive" className="text-xs">
                            {ability.damage} dmg
                          </Badge>
                        )}
                        {(ability as GameAbility).healing && (
                          <Badge className="text-xs bg-green-600">
                            {(ability as GameAbility).healing} heal
                          </Badge>
                        )}
                        {ability.range !== undefined && ability.range > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {ability.range} range
                          </Badge>
                        )}
                        {((ability as GameAbility).cost || (ability as LegacyAbility).manaCost) && (
                          <Badge variant="outline" className="text-xs">
                            {(ability as GameAbility).cost || (ability as LegacyAbility).manaCost} {(ability as GameAbility).costType || "MP"}
                          </Badge>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center text-muted-foreground text-sm py-8">
                  <Scroll className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  No abilities learned yet
                </div>
              )}
            </TabsContent>

            {/* Gear Tab */}
            <TabsContent value="gear" className="p-4 space-y-4 m-0">
              {/* Equipment Slots */}
              <div>
                <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
                  <Shield className="h-4 w-4 text-primary" />
                  Equipped
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(slotLabels).map(([slot, label]) => {
                    const item = (equipment as Record<string, InventoryItem | null>)[slot];
                    return (
                      <div 
                        key={slot}
                        className={`p-2 rounded-lg border ${
                          item 
                            ? rarityColors[item.rarity] 
                            : "border-dashed border-muted-foreground/30 bg-muted/20"
                        }`}
                      >
                        <p className="text-xs text-muted-foreground">{label}</p>
                        {item ? (
                          <div>
                            <p className={`text-sm font-medium ${rarityColors[item.rarity]?.split(' ')[0]}`}>
                              {item.name}
                            </p>
                            {item.statModifiers && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {Object.entries(item.statModifiers).map(([stat, value]) => (
                                  value !== undefined && typeof value === "number" && value !== 0 && (
                                    <span 
                                      key={stat} 
                                      className="text-xs text-green-400"
                                    >
                                      +{value} {stat.slice(0, 3)}
                                    </span>
                                  )
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground italic">Empty</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <Separator />

              {/* Backpack */}
              <div>
                <h3 className="font-semibold text-foreground flex items-center gap-2 mb-3">
                  <Package className="h-4 w-4 text-primary" />
                  Backpack ({backpack.length})
                </h3>
                {backpack.length > 0 ? (
                  <div className="space-y-2">
                    {backpack.map((item, index) => (
                      <div 
                        key={item.id || index}
                        className={`p-2 rounded-lg border ${rarityColors[item.rarity]}`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <p className={`text-sm font-medium ${rarityColors[item.rarity]?.split(' ')[0]}`}>
                              {item.name}
                              {item.quantity && item.quantity > 1 && (
                                <span className="text-muted-foreground"> x{item.quantity}</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{item.description}</p>
                          </div>
                          <Badge variant="outline" className="text-xs capitalize">
                            {item.itemType}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground text-sm py-4">
                    <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                    Backpack is empty
                  </div>
                )}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </motion.div>
    </AnimatePresence>
  );
};

export default CharacterSheet;
