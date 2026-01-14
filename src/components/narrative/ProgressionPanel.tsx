/**
 * Character Progression UI - XP bar, level, stats
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Star, 
  TrendingUp, 
  Swords, 
  Shield, 
  Heart,
  Zap,
  Brain
} from "lucide-react";
import type { CharacterProgression, StatModifiers } from "@/engine/narrative/types";
import { getAccumulatedLevelBonuses } from "@/engine/narrative/Progression";

interface ProgressionPanelProps {
  progression: CharacterProgression;
  baseStats?: StatModifiers;
  equipmentStats?: StatModifiers;
  statusStats?: StatModifiers;
}

export function ProgressionPanel({ 
  progression, 
  baseStats = {},
  equipmentStats = {},
  statusStats = {},
}: ProgressionPanelProps) {
  const levelBonuses = getAccumulatedLevelBonuses(progression.level);
  
  const xpProgress = (progression.currentXp / (progression.currentXp + progression.xpToNextLevel)) * 100;

  // Calculate final stats
  const finalStats: StatModifiers = {};
  const statKeys: (keyof StatModifiers)[] = [
    "strength", "dexterity", "constitution", 
    "intelligence", "wisdom", "charisma",
    "maxHp", "ac", "attackBonus", "damageBonus", "speed", "initiative"
  ];
  
  for (const key of statKeys) {
    const base = baseStats[key] ?? 0;
    const level = levelBonuses[key] ?? 0;
    const equip = equipmentStats[key] ?? 0;
    const status = statusStats[key] ?? 0;
    const total = base + level + equip + status;
    if (total !== 0) {
      (finalStats as Record<string, number>)[key] = total;
    }
  }

  return (
    <Card className="w-full max-w-sm bg-card/95 backdrop-blur border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Star className="w-5 h-5 text-amber-500" />
            Level {progression.level}
          </CardTitle>
          <Badge variant="secondary" className="text-xs">
            {progression.totalXpEarned} total XP
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* XP Bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Experience</span>
            <span>{progression.currentXp} / {progression.currentXp + progression.xpToNextLevel}</span>
          </div>
          <Progress value={xpProgress} className="h-2" />
          <p className="text-xs text-muted-foreground text-right">
            {progression.xpToNextLevel} XP to level {progression.level + 1}
          </p>
        </div>

        {/* Core Stats */}
        <div className="grid grid-cols-3 gap-2">
          <StatBox label="STR" value={finalStats.strength ?? 10} icon={Swords} />
          <StatBox label="DEX" value={finalStats.dexterity ?? 10} icon={Zap} />
          <StatBox label="CON" value={finalStats.constitution ?? 10} icon={Heart} />
          <StatBox label="INT" value={finalStats.intelligence ?? 10} icon={Brain} />
          <StatBox label="WIS" value={finalStats.wisdom ?? 10} icon={Brain} />
          <StatBox label="CHA" value={finalStats.charisma ?? 10} icon={Star} />
        </div>

        {/* Combat Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="p-2 rounded-md bg-red-500/10 border border-red-500/20">
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-red-500" />
              <span className="text-sm font-medium">{finalStats.maxHp ?? 10} HP</span>
            </div>
          </div>
          <div className="p-2 rounded-md bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-500" />
              <span className="text-sm font-medium">{finalStats.ac ?? 10} AC</span>
            </div>
          </div>
        </div>

        {/* Ability Slots */}
        <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
          <span className="text-sm">Ability Slots</span>
          <div className="flex gap-1">
            {Array.from({ length: progression.abilitySlots }).map((_, i) => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 ${
                  i < progression.unlockedAbilities.length
                    ? "bg-primary border-primary"
                    : "border-muted-foreground"
                }`}
              />
            ))}
          </div>
        </div>

        {/* Recent XP History */}
        {progression.xpHistory.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="w-3 h-3" />
              Recent Activity
            </p>
            <div className="space-y-1">
              {progression.xpHistory.slice(-3).reverse().map((source, idx) => (
                <div 
                  key={idx}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-muted-foreground truncate">
                    {source.description}
                  </span>
                  <Badge variant="secondary" className="text-xs shrink-0">
                    +{source.amount} XP
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface StatBoxProps {
  label: string;
  value: number;
  icon: typeof Swords;
}

function StatBox({ label, value, icon: Icon }: StatBoxProps) {
  const modifier = Math.floor((value - 10) / 2);
  const modifierStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;

  return (
    <div className="p-2 rounded-md bg-muted/50 text-center">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-xs text-primary">{modifierStr}</p>
    </div>
  );
}

/**
 * Compact XP bar for HUD
 */
interface XPBarProps {
  progression: CharacterProgression;
}

export function XPBar({ progression }: XPBarProps) {
  const xpProgress = (progression.currentXp / (progression.currentXp + progression.xpToNextLevel)) * 100;

  return (
    <div className="flex items-center gap-2">
      <Badge variant="secondary" className="shrink-0">
        Lv.{progression.level}
      </Badge>
      <div className="flex-1">
        <Progress value={xpProgress} className="h-1.5" />
      </div>
      <span className="text-xs text-muted-foreground">
        {progression.xpToNextLevel} XP
      </span>
    </div>
  );
}
