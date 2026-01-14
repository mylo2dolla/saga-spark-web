import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { 
  Sword, 
  Wand2, 
  Eye, 
  Heart, 
  Shield, 
  Axe,
  ChevronRight,
  ChevronLeft,
  Dices,
  Sparkles,
  Check
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  CHARACTER_CLASSES, 
  CharacterClassName, 
  CharacterStats,
  getModifier,
  calculateHP,
  calculateAC,
  CreateCharacterData
} from "@/hooks/useCharacter";

const CLASS_ICONS: Record<CharacterClassName, React.ReactNode> = {
  Fighter: <Sword className="w-8 h-8" />,
  Wizard: <Wand2 className="w-8 h-8" />,
  Rogue: <Eye className="w-8 h-8" />,
  Cleric: <Heart className="w-8 h-8" />,
  Barbarian: <Axe className="w-8 h-8" />,
  Ranger: <Shield className="w-8 h-8" />,
};

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
  onComplete: (character: CreateCharacterData) => void;
  onCancel?: () => void;
}

type Step = "class" | "stats" | "name" | "review";

export function CharacterCreator({ campaignId, onComplete, onCancel }: CharacterCreatorProps) {
  const [step, setStep] = useState<Step>("class");
  const [selectedClass, setSelectedClass] = useState<CharacterClassName | null>(null);
  const [characterName, setCharacterName] = useState("");
  const [stats, setStats] = useState<CharacterStats>({
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  });
  const [pointsRemaining, setPointsRemaining] = useState(27); // Point buy system

  const rollStats = () => {
    const rollStat = () => {
      // Roll 4d6, drop lowest
      const rolls = Array.from({ length: 4 }, () => Math.floor(Math.random() * 6) + 1);
      rolls.sort((a, b) => b - a);
      return rolls[0] + rolls[1] + rolls[2];
    };

    const newStats: CharacterStats = {
      strength: rollStat(),
      dexterity: rollStat(),
      constitution: rollStat(),
      intelligence: rollStat(),
      wisdom: rollStat(),
      charisma: rollStat(),
    };

    setStats(newStats);
    setPointsRemaining(0); // Disable point buy after rolling
  };

  const adjustStat = (stat: keyof CharacterStats, delta: number) => {
    const current = stats[stat];
    const newValue = current + delta;
    
    // Point buy costs
    const getCost = (value: number) => {
      if (value <= 13) return value - 8;
      if (value === 14) return 7;
      if (value === 15) return 9;
      return 0;
    };

    if (newValue < 8 || newValue > 15) return;
    
    const oldCost = getCost(current);
    const newCost = getCost(newValue);
    const costDelta = newCost - oldCost;

    if (pointsRemaining - costDelta < 0) return;

    setStats(prev => ({ ...prev, [stat]: newValue }));
    setPointsRemaining(prev => prev - costDelta);
  };

  const handleComplete = () => {
    if (!selectedClass || !characterName.trim()) return;
    
    onComplete({
      name: characterName,
      class: selectedClass,
      stats,
      campaign_id: campaignId,
    });
  };

  const canProceed = () => {
    switch (step) {
      case "class": return selectedClass !== null;
      case "stats": return true;
      case "name": return characterName.trim().length >= 2;
      case "review": return true;
    }
  };

  const nextStep = () => {
    if (step === "class") setStep("stats");
    else if (step === "stats") setStep("name");
    else if (step === "name") setStep("review");
  };

  const prevStep = () => {
    if (step === "stats") setStep("class");
    else if (step === "name") setStep("stats");
    else if (step === "review") setStep("name");
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
          {(["class", "stats", "name", "review"] as Step[]).map((s, i) => (
            <div 
              key={s}
              className={`w-3 h-3 rounded-full transition-colors ${
                s === step ? "bg-primary" : 
                (["class", "stats", "name", "review"].indexOf(step) > i ? "bg-primary/50" : "bg-muted")
              }`}
            />
          ))}
        </div>

        <div className="card-parchment rounded-xl p-8">
          <AnimatePresence mode="wait">
            {/* Step 1: Class Selection */}
            {step === "class" && (
              <motion.div
                key="class"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="font-display text-2xl text-center mb-2">Choose Your Class</h2>
                <p className="text-muted-foreground text-center mb-8">Select the path your hero will follow</p>
                
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {(Object.keys(CHARACTER_CLASSES) as CharacterClassName[]).map((className) => {
                    const classData = CHARACTER_CLASSES[className];
                    const isSelected = selectedClass === className;
                    
                    return (
                      <motion.button
                        key={className}
                        onClick={() => setSelectedClass(className)}
                        className={`p-6 rounded-xl border-2 transition-all text-left ${
                          isSelected 
                            ? "border-primary bg-primary/10" 
                            : "border-border hover:border-primary/50 bg-card/50"
                        }`}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className={`mb-3 ${isSelected ? "text-primary" : "text-muted-foreground"}`}>
                          {CLASS_ICONS[className]}
                        </div>
                        <h3 className="font-display text-lg mb-1">{className}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {classData.description}
                        </p>
                      </motion.button>
                    );
                  })}
                </div>

                {selectedClass && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-4 rounded-lg bg-primary/5 border border-primary/20"
                  >
                    <h4 className="font-display text-sm mb-2">Starting Abilities</h4>
                    <div className="flex flex-wrap gap-2">
                      {CHARACTER_CLASSES[selectedClass].startingAbilities.map(ability => (
                        <span 
                          key={ability.id}
                          className="px-3 py-1 rounded-full text-xs bg-primary/20 text-primary"
                        >
                          {ability.name}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* Step 2: Stats */}
            {step === "stats" && (
              <motion.div
                key="stats"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
              >
                <h2 className="font-display text-2xl text-center mb-2">Assign Abilities</h2>
                <p className="text-muted-foreground text-center mb-4">
                  Distribute your ability scores
                </p>
                
                <div className="flex justify-center gap-4 mb-6">
                  <Button onClick={rollStats} variant="outline" className="gap-2">
                    <Dices className="w-4 h-4" />
                    Roll Stats (4d6 drop lowest)
                  </Button>
                  {pointsRemaining === 0 && (
                    <Button 
                      onClick={() => {
                        setStats({ strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 });
                        setPointsRemaining(27);
                      }} 
                      variant="ghost"
                    >
                      Reset to Point Buy
                    </Button>
                  )}
                </div>

                {pointsRemaining > 0 && (
                  <div className="text-center mb-6">
                    <span className="text-sm text-muted-foreground">Points remaining: </span>
                    <span className="font-display text-lg text-primary">{pointsRemaining}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {STAT_NAMES.map((stat) => {
                    const value = stats[stat];
                    const modifier = getModifier(value);
                    const isPrimary = selectedClass && (CHARACTER_CLASSES[selectedClass].primaryStats as readonly string[]).includes(stat);

                    return (
                      <div 
                        key={stat}
                        className={`p-4 rounded-lg border ${isPrimary ? "border-primary bg-primary/5" : "border-border bg-card/50"}`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-display text-sm capitalize">
                            {stat}
                            {isPrimary && <Sparkles className="w-3 h-3 inline ml-1 text-primary" />}
                          </span>
                          <span className={`text-sm font-bold ${modifier >= 0 ? "text-green-500" : "text-destructive"}`}>
                            {modifier >= 0 ? `+${modifier}` : modifier}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => adjustStat(stat, -1)}
                            disabled={pointsRemaining === 0 || value <= 8}
                          >
                            -
                          </Button>
                          <span className="font-display text-2xl">{value}</span>
                          <Button 
                            size="sm" 
                            variant="ghost" 
                            onClick={() => adjustStat(stat, 1)}
                            disabled={pointsRemaining === 0 || value >= 15}
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
              </motion.div>
            )}

            {/* Step 3: Name */}
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
                    {["Thorin", "Elara", "Shadowmere", "Grimjaw", "Lyra", "Vex"].map(name => (
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

            {/* Step 4: Review */}
            {step === "review" && selectedClass && (
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
                        {CLASS_ICONS[selectedClass]}
                      </div>
                      <div>
                        <h3 className="font-display text-2xl">{characterName}</h3>
                        <p className="text-muted-foreground">Level 1 {selectedClass}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-6">
                      <div className="text-center p-3 rounded-lg bg-destructive/10">
                        <div className="text-2xl font-display text-destructive">
                          {calculateHP(selectedClass, stats.constitution)}
                        </div>
                        <div className="text-xs text-muted-foreground">HP</div>
                      </div>
                      <div className="text-center p-3 rounded-lg bg-primary/10">
                        <div className="text-2xl font-display text-primary">
                          {calculateAC(selectedClass, stats.dexterity)}
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
                          <div className="text-lg font-display">{stats[stat]}</div>
                          <div className="text-xs text-muted-foreground uppercase">{stat.slice(0, 3)}</div>
                        </div>
                      ))}
                    </div>

                    <div>
                      <h4 className="font-display text-sm mb-2">Abilities</h4>
                      <div className="space-y-2">
                        {CHARACTER_CLASSES[selectedClass].startingAbilities.map(ability => (
                          <div key={ability.id} className="flex items-center justify-between p-2 rounded bg-card/50">
                            <span className="font-medium text-sm">{ability.name}</span>
                            <span className="text-xs text-muted-foreground">{ability.type}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex justify-between mt-8">
            <Button
              variant="ghost"
              onClick={step === "class" ? onCancel : prevStep}
              className="gap-2"
            >
              <ChevronLeft className="w-4 h-4" />
              {step === "class" ? "Cancel" : "Back"}
            </Button>

            {step === "review" ? (
              <Button onClick={handleComplete} className="gap-2">
                <Check className="w-4 h-4" />
                Create Character
              </Button>
            ) : (
              <Button onClick={nextStep} disabled={!canProceed()} className="gap-2">
                Continue
                <ChevronRight className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
