import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Sparkles,
  ChevronRight,
  ChevronLeft,
  Dices,
  Check,
  Loader2,
  Wand2,
  Zap,
  Shield,
  Heart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useClassGenerator } from "@/hooks/useClassGenerator";
import type { CharacterStats, GeneratedClass, GameAbility, PassiveAbility, CharacterResources } from "@/types/game";

const STAT_NAMES: (keyof CharacterStats)[] = [
  "strength",
  "dexterity", 
  "constitution",
  "intelligence",
  "wisdom",
  "charisma"
];

const STAT_DESCRIPTIONS: Record<keyof CharacterStats, string> = {
  strength: "Physical power for melee attacks",
  dexterity: "Agility, reflexes, and balance",
  constitution: "Health and stamina",
  intelligence: "Mental acuity and magical power",
  wisdom: "Perception and insight",
  charisma: "Force of personality",
};

interface CharacterCreatorProps {
  campaignId: string;
  onComplete: (character: {
    name: string;
    class: string;
    classDescription: string;
    stats: CharacterStats;
    resources: CharacterResources;
    passives: PassiveAbility[];
    abilities: Omit<GameAbility, "id">[];
    campaign_id: string;
    hitDice: string;
    baseAC: number;
  }) => void;
  onCancel?: () => void;
}

type Step = "concept" | "generated" | "customize" | "name" | "review";

function getModifier(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

export function AICharacterCreator({ campaignId, onComplete, onCancel }: CharacterCreatorProps) {
  const [step, setStep] = useState<Step>("concept");
  const [classDescription, setClassDescription] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [generatedData, setGeneratedData] = useState<GeneratedClass | null>(null);
  const [customizedStats, setCustomizedStats] = useState<CharacterStats | null>(null);
  
  const { isGenerating, generateClass, clearClass } = useClassGenerator();

  const handleGenerate = async () => {
    const result = await generateClass(classDescription);
    if (result) {
      setGeneratedData(result);
      setCustomizedStats(result.stats);
      setStep("generated");
    }
  };

  const handleRegenerate = async () => {
    clearClass();
    const result = await generateClass(classDescription);
    if (result) {
      setGeneratedData(result);
      setCustomizedStats(result.stats);
    }
  };

  const handleComplete = () => {
    if (!generatedData || !characterName.trim() || !customizedStats) return;
    
    onComplete({
      name: characterName,
      class: generatedData.className,
      classDescription: generatedData.description,
      stats: customizedStats,
      resources: generatedData.resources,
      passives: generatedData.passives,
      abilities: generatedData.abilities,
      campaign_id: campaignId,
      hitDice: generatedData.hitDice,
      baseAC: generatedData.baseAC,
    });
  };

  const canProceed = () => {
    switch (step) {
      case "concept": return classDescription.trim().length >= 5;
      case "generated": return generatedData !== null;
      case "customize": return true;
      case "name": return characterName.trim().length >= 2;
      case "review": return true;
    }
  };

  const nextStep = () => {
    if (step === "concept") handleGenerate();
    else if (step === "generated") setStep("customize");
    else if (step === "customize") setStep("name");
    else if (step === "name") setStep("review");
  };

  const prevStep = () => {
    if (step === "generated") {
      clearClass();
      setGeneratedData(null);
      setStep("concept");
    }
    else if (step === "customize") setStep("generated");
    else if (step === "name") setStep("customize");
    else if (step === "review") setStep("name");
  };

  const calculateHP = (): number => {
    if (!generatedData || !customizedStats) return 10;
    const hitDie = parseInt(generatedData.hitDice.replace("d", ""));
    const conMod = getModifier(customizedStats.constitution);
    return hitDie + conMod;
  };

  const calculateAC = (): number => {
    if (!generatedData || !customizedStats) return 10;
    const dexMod = getModifier(customizedStats.dexterity);
    return generatedData.baseAC + dexMod;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div 
        className="w-full max-w-4xl"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Progress indicator */}
        <div className="flex justify-center mb-8 gap-2">
          {(["concept", "generated", "customize", "name", "review"] as Step[]).map((s, i) => (
            <div 
              key={s}
              className={`w-3 h-3 rounded-full transition-colors ${
                s === step ? "bg-primary" : 
                (["concept", "generated", "customize", "name", "review"].indexOf(step) > i ? "bg-primary/50" : "bg-muted")
              }`}
            />
          ))}
        </div>

        <div className="card-parchment rounded-xl p-8">
          <AnimatePresence mode="wait">
            {/* Step 1: Class Concept */}
            {step === "concept" && (
              <motion.div
                key="concept"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-lg mx-auto"
              >
                <div className="text-center mb-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/20 flex items-center justify-center">
                    <Wand2 className="w-8 h-8 text-primary" />
                  </div>
                  <h2 className="font-display text-2xl mb-2">Describe Your Character</h2>
                  <p className="text-muted-foreground">
                    Tell us your fantasy. AI will generate a unique class with abilities and stats.
                  </p>
                </div>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="classDesc">Class Concept</Label>
                    <Textarea
                      id="classDesc"
                      value={classDescription}
                      onChange={(e) => setClassDescription(e.target.value)}
                      placeholder='e.g., "A werewolf ninja who uses shadow magic and rage" or "An elven druid who shapeshifts into storm elementals"'
                      className="min-h-[120px] bg-input border-border"
                    />
                    <p className="text-xs text-muted-foreground">
                      Be creative! Mix archetypes, add themes, describe playstyle.
                    </p>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs text-muted-foreground">Ideas:</span>
                    {[
                      "Shadow assassin monk",
                      "Arcane gunslinger",
                      "Necromancer bard",
                      "Holy berserker",
                      "Chronomancer rogue",
                    ].map(idea => (
                      <Button
                        key={idea}
                        variant="outline"
                        size="sm"
                        onClick={() => setClassDescription(idea)}
                        className="text-xs"
                      >
                        <Dices className="w-3 h-3 mr-1" />
                        {idea}
                      </Button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 2: Generated Class */}
            {step === "generated" && generatedData && (
              <motion.div
                key="generated"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <div className="text-center mb-6">
                  <h2 className="font-display text-2xl mb-2">{generatedData.className}</h2>
                  <p className="text-muted-foreground">{generatedData.description}</p>
                </div>
                
                <div className="grid md:grid-cols-2 gap-6">
                  {/* Stats */}
                  <div className="space-y-4">
                    <h3 className="font-display text-sm flex items-center gap-2">
                      <Shield className="w-4 h-4 text-primary" />
                      Base Stats
                    </h3>
                    <div className="grid grid-cols-3 gap-2">
                      {STAT_NAMES.map(stat => (
                        <div key={stat} className="p-3 rounded-lg bg-card/50 border border-border text-center">
                          <div className="text-lg font-display">{generatedData.stats[stat]}</div>
                          <div className="text-xs text-muted-foreground capitalize">{stat.slice(0, 3)}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Resources */}
                  <div className="space-y-4">
                    <h3 className="font-display text-sm flex items-center gap-2">
                      <Zap className="w-4 h-4 text-arcane" />
                      Resources
                    </h3>
                    <div className="space-y-2">
                      {Object.entries(generatedData.resources)
                        .filter(([key, value]) => key.startsWith("max") && value > 0)
                        .map(([key, value]) => (
                          <div key={key} className="flex items-center justify-between p-2 rounded bg-card/50">
                            <span className="text-sm capitalize">{key.replace("max", "")}</span>
                            <span className="font-display">{value}</span>
                          </div>
                        ))}
                      <div className="flex items-center justify-between p-2 rounded bg-primary/10">
                        <span className="text-sm">Hit Dice</span>
                        <span className="font-display">{generatedData.hitDice}</span>
                      </div>
                    </div>
                  </div>

                  {/* Passives */}
                  <div className="space-y-4">
                    <h3 className="font-display text-sm flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-accent" />
                      Passive Abilities
                    </h3>
                    <ScrollArea className="h-32">
                      <div className="space-y-2">
                        {generatedData.passives.map((passive, i) => (
                          <div key={i} className="p-3 rounded-lg bg-accent/10 border border-accent/20">
                            <div className="font-medium text-sm">{passive.name}</div>
                            <div className="text-xs text-muted-foreground">{passive.description}</div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>

                  {/* Abilities */}
                  <div className="space-y-4">
                    <h3 className="font-display text-sm flex items-center gap-2">
                      <Zap className="w-4 h-4 text-destructive" />
                      Active Abilities
                    </h3>
                    <ScrollArea className="h-32">
                      <div className="space-y-2">
                        {generatedData.abilities.map((ability, i) => (
                          <div key={i} className="p-3 rounded-lg bg-card/50 border border-border">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-sm">{ability.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {ability.damage || ability.healing || "Utility"}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground line-clamp-2">
                              {ability.description}
                            </div>
                            <div className="flex gap-2 mt-1">
                              <span className="text-xs px-2 py-0.5 rounded bg-muted">
                                Range: {ability.range}
                              </span>
                              {ability.cost > 0 && (
                                <span className="text-xs px-2 py-0.5 rounded bg-muted">
                                  {ability.cost} {ability.costType}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                </div>

                <div className="mt-6 flex justify-center">
                  <Button 
                    variant="outline" 
                    onClick={handleRegenerate} 
                    disabled={isGenerating}
                    className="gap-2"
                  >
                    {isGenerating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Dices className="w-4 h-4" />
                    )}
                    Regenerate
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Step 3: Customize Stats */}
            {step === "customize" && customizedStats && generatedData && (
              <motion.div
                key="customize"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="font-display text-2xl text-center mb-2">Fine-tune Your Stats</h2>
                <p className="text-muted-foreground text-center mb-6">
                  Adjust your ability scores (total must equal {Object.values(generatedData.stats).reduce((a, b) => a + b, 0)})
                </p>
                
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-w-2xl mx-auto">
                  {STAT_NAMES.map((stat) => {
                    const value = customizedStats[stat];
                    const modifier = getModifier(value);

                    return (
                      <div 
                        key={stat}
                        className="p-4 rounded-lg border border-border bg-card/50"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-display text-sm capitalize">{stat}</span>
                          <span className={`text-sm font-bold ${modifier >= 0 ? "text-green-500" : "text-destructive"}`}>
                            {modifier >= 0 ? `+${modifier}` : modifier}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => setCustomizedStats(prev => prev ? { ...prev, [stat]: Math.max(3, value - 1) } : null)}
                            disabled={value <= 3}
                          >
                            -
                          </Button>
                          <span className="font-display text-2xl">{value}</span>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => setCustomizedStats(prev => prev ? { ...prev, [stat]: Math.min(20, value + 1) } : null)}
                            disabled={value >= 20}
                          >
                            +
                          </Button>
                        </div>
                        <p className="text-xs text-muted-foreground mt-2 text-center">
                          {STAT_DESCRIPTIONS[stat]}
                        </p>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-6 text-center text-sm text-muted-foreground">
                  Current total: {Object.values(customizedStats).reduce((a, b) => a + b, 0)}
                </div>
              </motion.div>
            )}

            {/* Step 4: Name */}
            {step === "name" && (
              <motion.div
                key="name"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="max-w-md mx-auto"
              >
                <h2 className="font-display text-2xl text-center mb-2">Name Your Hero</h2>
                <p className="text-muted-foreground text-center mb-8">
                  What shall the bards sing of?
                </p>
                
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Character Name</Label>
                    <Input
                      id="name"
                      value={characterName}
                      onChange={(e) => setCharacterName(e.target.value)}
                      placeholder="Enter a name..."
                      className="text-lg text-center font-display"
                      autoFocus
                    />
                  </div>
                  
                  <div className="flex flex-wrap gap-2 justify-center">
                    {["Shadowfang", "Azura", "Grimrock", "Kira", "Valdris", "Zephyr"].map(name => (
                      <Button
                        key={name}
                        variant="ghost"
                        size="sm"
                        onClick={() => setCharacterName(name)}
                        className="text-xs"
                      >
                        {name}
                      </Button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {/* Step 5: Review */}
            {step === "review" && generatedData && customizedStats && (
              <motion.div
                key="review"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="font-display text-2xl text-center mb-2">Review Your Character</h2>
                <p className="text-muted-foreground text-center mb-8">
                  Ready to begin your adventure?
                </p>
                
                <div className="max-w-lg mx-auto">
                  <div className="card-parchment rounded-xl p-6 border-primary/30">
                    <div className="flex items-center gap-4 mb-6">
                      <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                        <Sparkles className="w-8 h-8" />
                      </div>
                      <div>
                        <h3 className="font-display text-2xl">{characterName}</h3>
                        <p className="text-muted-foreground">Level 1 {generatedData.className}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="text-center p-3 rounded-lg bg-destructive/10">
                        <div className="text-2xl font-display text-destructive">
                          {calculateHP()}
                        </div>
                        <div className="text-xs text-muted-foreground">HP</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-primary/10">
                        <div className="text-2xl font-display text-primary">
                          {calculateAC()}
                        </div>
                        <div className="text-xs text-muted-foreground">AC</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-arcane/10">
                        <div className="text-2xl font-display text-arcane">1</div>
                        <div className="text-xs text-muted-foreground">Level</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-6 gap-2 mb-6">
                      {STAT_NAMES.map(stat => (
                        <div key={stat} className="text-center">
                          <div className="text-lg font-display">{customizedStats[stat]}</div>
                          <div className="text-xs text-muted-foreground uppercase">{stat.slice(0, 3)}</div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-4">
                      <div>
                        <h4 className="font-display text-sm mb-2">Passives</h4>
                        <div className="flex flex-wrap gap-2">
                          {generatedData.passives.map((passive, i) => (
                            <span 
                              key={i}
                              className="px-3 py-1 rounded-full text-xs bg-accent/20 text-accent-foreground"
                            >
                              {passive.name}
                            </span>
                          ))}
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-display text-sm mb-2">Abilities</h4>
                        <div className="space-y-2">
                          {generatedData.abilities.map((ability, i) => (
                            <div key={i} className="flex items-center justify-between p-2 rounded bg-card/50">
                              <span className="font-medium text-sm">{ability.name}</span>
                              <span className="text-xs text-muted-foreground">{ability.abilityType}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Loading state */}
            {isGenerating && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-12"
              >
                <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                <p className="text-muted-foreground">Weaving your destiny...</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation */}
          {!isGenerating && (
            <div className="flex justify-between mt-8">
              <Button
                variant="ghost"
                onClick={step === "concept" ? onCancel : prevStep}
                className="gap-2"
              >
                <ChevronLeft className="w-4 h-4" />
                {step === "concept" ? "Cancel" : "Back"}
              </Button>

              {step === "review" ? (
                <Button onClick={handleComplete} className="gap-2">
                  <Check className="w-4 h-4" />
                  Create Character
                </Button>
              ) : (
                <Button onClick={nextStep} disabled={!canProceed()} className="gap-2">
                  {step === "concept" ? "Generate Class" : "Continue"}
                  <ChevronRight className="w-4 h-4" />
                </Button>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

export default AICharacterCreator;
