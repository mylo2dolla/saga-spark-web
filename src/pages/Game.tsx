import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Swords,
  Users,
  Settings,
  ChevronLeft,
  Heart,
  Sparkles,
  Play
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Dice3D, 
  CombatGrid, 
  TurnTracker, 
  AbilityBar, 
  CharacterSheet,
  FloatingDamage,
  useFloatingDamage,
  type Character,
  type Ability
} from "@/components/combat";
import { DMChat } from "@/components/DMChat";
import { useDungeonMaster } from "@/hooks/useDungeonMaster";

// Mock data for UI demo
const mockCharacters: Character[] = [
  { id: "1", name: "Thorin", class: "Fighter", level: 5, hp: 45, maxHp: 52, ac: 18, initiative: 14, position: { x: 2, y: 3 } },
  { id: "2", name: "Elara", class: "Wizard", level: 5, hp: 22, maxHp: 24, ac: 13, initiative: 18, position: { x: 3, y: 4 } },
  { id: "3", name: "Shadowmere", class: "Rogue", level: 5, hp: 31, maxHp: 38, ac: 15, initiative: 20, position: { x: 4, y: 3 }, statusEffects: ["blessed"] },
  { id: "e1", name: "Goblin", class: "Monster", level: 2, hp: 12, maxHp: 15, ac: 12, initiative: 10, isEnemy: true, position: { x: 6, y: 2 } },
  { id: "e2", name: "Orc", class: "Monster", level: 4, hp: 28, maxHp: 30, ac: 14, initiative: 8, isEnemy: true, position: { x: 7, y: 4 } },
];

const mockAbilities: Ability[] = [
  { id: "1", name: "Strike", type: "attack", description: "A basic melee attack", damage: "1d8+3", range: 1 },
  { id: "2", name: "Fireball", type: "spell", description: "Hurl a ball of fire", damage: "8d6", range: 20, manaCost: 15, cooldown: 2 },
  { id: "3", name: "Shield", type: "defense", description: "Increase AC by 5", manaCost: 5 },
  { id: "4", name: "Heal", type: "heal", description: "Restore 2d8+3 HP", manaCost: 10 },
];

const Game = () => {
  const { campaignId } = useParams();
  const [showDice, setShowDice] = useState(false);
  const [inCombat, setInCombat] = useState(false);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [selectedAbility, setSelectedAbility] = useState<Ability | null>(null);
  const [characters, setCharacters] = useState(mockCharacters);
  const { damages, addDamage, removeDamage } = useFloatingDamage();
  
  const { 
    messages, 
    isLoading, 
    currentResponse, 
    sendMessage, 
    startNewAdventure 
  } = useDungeonMaster();

  // Get last suggestions from DM
  const lastDMMessage = messages.filter(m => m.role === "assistant").pop();
  const suggestions = lastDMMessage?.parsed?.suggestions;

  // Handle effects from DM response
  useEffect(() => {
    if (lastDMMessage?.parsed?.effects) {
      lastDMMessage.parsed.effects.forEach(effect => {
        const targetChar = characters.find(c => c.name.toLowerCase() === effect.target.toLowerCase());
        if (targetChar && targetChar.position) {
          // Generate random screen position based on character grid position
          const screenX = targetChar.position.x * 50 + 200;
          const screenY = targetChar.position.y * 50 + 100;
          
          addDamage(
            effect.value,
            effect.effect === "heal" ? "heal" : "damage",
            { x: screenX, y: screenY }
          );

          // Update character HP
          setCharacters(prev => prev.map(c => {
            if (c.id === targetChar.id) {
              const newHp = effect.effect === "heal" 
                ? Math.min(c.maxHp, c.hp + effect.value)
                : Math.max(0, c.hp - effect.value);
              return { ...c, hp: newHp };
            }
            return c;
          }));
        }
      });
    }

    // Handle combat state from DM
    if (lastDMMessage?.parsed?.combat) {
      setInCombat(lastDMMessage.parsed.combat.active);
    }
  }, [lastDMMessage]);

  const handleSendMessage = (message: string) => {
    const context = {
      party: characters.filter(c => !c.isEnemy).map(c => ({
        name: c.name,
        class: c.class,
        level: c.level,
        hp: c.hp,
        maxHp: c.maxHp,
      })),
      location: "The Dragon's Lair Cavern",
      campaignName: "The Dragon's Lair",
      inCombat,
      enemies: inCombat ? characters.filter(c => c.isEnemy).map(c => ({
        name: c.name,
        hp: c.hp,
        maxHp: c.maxHp,
      })) : undefined,
    };
    sendMessage(message, context);
  };

  const handleStartAdventure = () => {
    const context = {
      party: characters.filter(c => !c.isEnemy).map(c => ({
        name: c.name,
        class: c.class,
        level: c.level,
        hp: c.hp,
        maxHp: c.maxHp,
      })),
      location: "Unknown",
      campaignName: "The Dragon's Lair",
    };
    startNewAdventure(context);
  };

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="glass-dark border-b border-border flex-shrink-0">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm"><ChevronLeft className="w-4 h-4 mr-1" />Back</Button>
            </Link>
            <div className="hidden sm:block">
              <h1 className="font-display text-lg text-foreground">The Dragon's Lair</h1>
              <p className="text-xs text-muted-foreground">Campaign ID: {campaignId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant={showDice ? "default" : "ghost"} size="sm" onClick={() => setShowDice(!showDice)}>
              <Sparkles className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm"><Settings className="w-4 h-4" /></Button>
          </div>
        </div>
      </header>

      {/* Main Game Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: AI DM Chat Panel */}
        <div className={`${inCombat ? "w-1/3 hidden lg:flex" : "flex-1"} flex-col min-w-0 flex`}>
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="max-w-md"
              >
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/20 flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-primary" />
                </div>
                <h2 className="font-display text-2xl mb-4">Welcome, Adventurer</h2>
                <p className="text-muted-foreground mb-8">
                  The AI Dungeon Master awaits to guide you through perilous dungeons, 
                  ancient mysteries, and epic battles. Your story begins now.
                </p>
                <Button onClick={handleStartAdventure} size="lg" className="gap-2">
                  <Play className="w-5 h-5" />
                  Begin Your Adventure
                </Button>
              </motion.div>
            </div>
          ) : (
            <>
              <DMChat
                messages={messages}
                isLoading={isLoading}
                currentResponse={currentResponse}
                onSendMessage={handleSendMessage}
                suggestions={suggestions}
              />
              {showDice && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} className="border-t border-border p-4">
                  <Dice3D size="md" />
                </motion.div>
              )}
            </>
          )}
        </div>

        {/* Center: Combat Grid (when in combat) */}
        {inCombat && (
          <div className="flex-1 flex flex-col p-4 gap-4">
            <TurnTracker 
              characters={characters} 
              currentTurnIndex={currentTurn} 
              roundNumber={1} 
              onEndTurn={() => setCurrentTurn((currentTurn + 1) % characters.length)} 
            />
            <div className="flex-1 relative">
              <CombatGrid 
                characters={characters} 
                selectedCharacterId={selectedCharacter?.id} 
                onCharacterClick={setSelectedCharacter} 
              />
              <FloatingDamage damages={damages} onComplete={removeDamage} />
            </div>
            <AbilityBar 
              abilities={mockAbilities} 
              selectedAbilityId={selectedAbility?.id} 
              onAbilitySelect={setSelectedAbility} 
            />
          </div>
        )}

        {/* Right: Party Sidebar */}
        <aside className="w-72 border-l border-border bg-card/30 hidden lg:flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-primary" />
              <h2 className="font-display text-sm uppercase">Party</h2>
            </div>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3">
              {characters.filter(c => !c.isEnemy).map((member) => (
                <div 
                  key={member.id} 
                  onClick={() => setSelectedCharacter(member)} 
                  className="card-parchment rounded-lg p-3 cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-display text-sm">{member.name}</span>
                    <span className="text-xs text-muted-foreground">{member.class}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Heart className="w-3 h-3 text-destructive" />
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-destructive" 
                        initial={false}
                        animate={{ width: `${(member.hp / member.maxHp) * 100}%` }}
                        transition={{ type: "spring", stiffness: 300, damping: 30 }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground">{member.hp}/{member.maxHp}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="p-4 border-t border-border">
            <Button 
              variant={inCombat ? "destructive" : "combat"} 
              className="w-full" 
              onClick={() => setInCombat(!inCombat)}
            >
              <Swords className="w-4 h-4 mr-2" />
              {inCombat ? "Exit Combat" : "Enter Combat"}
            </Button>
          </div>
        </aside>

        {/* Character Sheet Modal */}
        <AnimatePresence>
          {selectedCharacter && (
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80"
            >
              <CharacterSheet 
                character={{ 
                  ...selectedCharacter, 
                  stats: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 8 }, 
                  xp: 2400, 
                  xpToNext: 6500, 
                  abilities: mockAbilities 
                }} 
                onClose={() => setSelectedCharacter(null)} 
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Game;
