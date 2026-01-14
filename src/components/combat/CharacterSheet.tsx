import { motion } from "framer-motion";
import { 
  Heart, 
  Shield, 
  Zap, 
  Sword, 
  Wand2, 
  Footprints,
  Star,
  Package,
  Scroll,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Character } from "./CombatMiniature";
import type { Ability } from "./AbilityBar";

interface Equipment {
  id: string;
  name: string;
  slot: "head" | "chest" | "legs" | "feet" | "hands" | "weapon" | "offhand" | "accessory";
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  stats?: Record<string, number>;
  imageUrl?: string;
}

interface CharacterSheetProps {
  character: Character & {
    stats?: {
      strength: number;
      dexterity: number;
      constitution: number;
      intelligence: number;
      wisdom: number;
      charisma: number;
    };
    xp?: number;
    xpToNext?: number;
    abilities?: Ability[];
    equipment?: Equipment[];
    inventory?: { id: string; name: string; quantity: number }[];
  };
  onClose?: () => void;
  isOpen?: boolean;
}

const rarityColors: Record<Equipment["rarity"], string> = {
  common: "text-muted-foreground border-muted",
  uncommon: "text-success border-success",
  rare: "text-accent border-accent",
  epic: "text-arcane border-arcane",
  legendary: "text-primary border-primary",
};

const CharacterSheet = ({ character, onClose, isOpen = true }: CharacterSheetProps) => {
  if (!isOpen) return null;

  const hpPercentage = (character.hp / character.maxHp) * 100;
  const xpPercentage = character.xp && character.xpToNext 
    ? (character.xp / character.xpToNext) * 100 
    : 0;

  const stats = character.stats || {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="bg-card/95 backdrop-blur-sm border border-border rounded-lg overflow-hidden w-80"
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
              <span className="font-display text-2xl font-bold text-white">
                {character.name.charAt(0)}
              </span>
            )}
          </div>
          <div>
            <h3 className="font-display text-lg text-foreground">{character.name}</h3>
            <p className="text-sm text-muted-foreground">
              Level {character.level} {character.class}
            </p>
            {character.xp !== undefined && (
              <div className="mt-1">
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Star className="w-3 h-3 text-primary" />
                  <span>{character.xp}/{character.xpToNext} XP</span>
                </div>
                <div className="w-32 h-1 bg-muted rounded-full mt-1">
                  <div 
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${xpPercentage}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="p-4 border-b border-border">
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <Heart className="w-4 h-4 text-destructive" />
              <span className="font-display text-lg">{character.hp}/{character.maxHp}</span>
            </div>
            <div className="h-1.5 bg-muted rounded-full mt-1">
              <div 
                className={`h-full rounded-full transition-all ${
                  hpPercentage <= 25 ? "bg-destructive" : "bg-success"
                }`}
                style={{ width: `${hpPercentage}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground">HP</span>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <Shield className="w-4 h-4 text-accent" />
              <span className="font-display text-lg">{character.ac}</span>
            </div>
            <span className="text-xs text-muted-foreground">AC</span>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1">
              <Zap className="w-4 h-4 text-primary" />
              <span className="font-display text-lg">{character.initiative}</span>
            </div>
            <span className="text-xs text-muted-foreground">Init</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="stats" className="w-full">
        <TabsList className="w-full grid grid-cols-3 bg-muted/50">
          <TabsTrigger value="stats" className="text-xs">Stats</TabsTrigger>
          <TabsTrigger value="abilities" className="text-xs">Abilities</TabsTrigger>
          <TabsTrigger value="gear" className="text-xs">Gear</TabsTrigger>
        </TabsList>

        <ScrollArea className="h-[280px]">
          {/* Stats Tab */}
          <TabsContent value="stats" className="p-4 space-y-2">
            {Object.entries(stats).map(([stat, value]) => (
              <div key={stat} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground capitalize">{stat}</span>
                <div className="flex items-center gap-2">
                  <span className="font-display text-foreground">{value}</span>
                  <span className="text-xs text-muted-foreground">
                    ({value >= 10 ? "+" : ""}{Math.floor((value - 10) / 2)})
                  </span>
                </div>
              </div>
            ))}
          </TabsContent>

          {/* Abilities Tab */}
          <TabsContent value="abilities" className="p-4 space-y-2">
            {(character.abilities || []).length > 0 ? (
              character.abilities?.map((ability) => (
                <div 
                  key={ability.id}
                  className="p-2 bg-muted/30 rounded-lg border border-border"
                >
                  <div className="flex items-center gap-2">
                    {ability.type === "attack" && <Sword className="w-4 h-4 text-destructive" />}
                    {ability.type === "spell" && <Wand2 className="w-4 h-4 text-arcane" />}
                    {ability.type === "heal" && <Heart className="w-4 h-4 text-success" />}
                    <span className="font-medium text-sm">{ability.name}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {ability.description}
                  </p>
                </div>
              ))
            ) : (
              <div className="text-center text-muted-foreground text-sm py-8">
                <Scroll className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No abilities learned yet
              </div>
            )}
          </TabsContent>

          {/* Gear Tab */}
          <TabsContent value="gear" className="p-4 space-y-2">
            {(character.equipment || []).length > 0 ? (
              character.equipment?.map((item) => (
                <div 
                  key={item.id}
                  className={`p-2 rounded-lg border ${rarityColors[item.rarity]} bg-muted/20`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{item.name}</span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {item.slot}
                    </span>
                  </div>
                  {item.stats && (
                    <div className="flex gap-2 mt-1">
                      {Object.entries(item.stats).map(([stat, value]) => (
                        <span key={stat} className="text-xs text-muted-foreground">
                          +{value} {stat}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center text-muted-foreground text-sm py-8">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                No equipment equipped
              </div>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </motion.div>
  );
};

export default CharacterSheet;
