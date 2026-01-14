import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Swords,
  MessageSquare,
  Users,
  Settings,
  ChevronLeft,
  Send,
  Heart,
  Shield,
  Zap,
  Sparkles,
  Map,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import Logo from "@/components/Logo";
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

// Mock data for UI demo
const mockMessages = [
  { id: 1, type: "dm", content: "You find yourselves at the entrance of a dark cavern. The air is thick with the smell of sulfur...", timestamp: "10:30 AM" },
  { id: 2, type: "player", author: "Thorin", content: "I light my torch and peer into the darkness.", timestamp: "10:31 AM" },
  { id: 3, type: "roll", author: "Thorin", content: "Perception Check", roll: { dice: "d20", result: 18, modifier: 3, total: 21 }, timestamp: "10:31 AM" },
  { id: 4, type: "dm", content: "Your keen dwarven eyes spot ancient runes on the walls, and gold coins scattered ahead...", timestamp: "10:32 AM" }
];

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
  const [messages] = useState(mockMessages);
  const [inputMessage, setInputMessage] = useState("");
  const [showDice, setShowDice] = useState(false);
  const [inCombat, setInCombat] = useState(false);
  const [currentTurn, setCurrentTurn] = useState(0);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [selectedAbility, setSelectedAbility] = useState<Ability | null>(null);
  const { damages, addDamage, removeDamage } = useFloatingDamage();

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    setInputMessage("");
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
        {/* Left: Chat Panel */}
        <div className={`${inCombat ? "w-1/3 hidden lg:flex" : "flex-1"} flex-col min-w-0 flex`}>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4 max-w-3xl mx-auto">
              {messages.map((message) => (
                <motion.div key={message.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                  className={`${message.type === "dm" ? "bg-primary/10 border-l-4 border-primary" : message.type === "roll" ? "bg-arcane/10 border border-arcane/30" : "bg-card/50"} rounded-lg p-4`}>
                  {message.type === "dm" && <div className="flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-primary" /><span className="text-xs font-display text-primary uppercase">Dungeon Master</span></div>}
                  {message.type === "player" && <div className="flex items-center gap-2 mb-2"><span className="text-sm font-medium">{message.author}</span></div>}
                  {message.type === "roll" && message.roll ? (
                    <div className="flex items-center gap-4">
                      <div className="bg-arcane/20 rounded-lg px-4 py-2 text-center">
                        <div className="text-2xl font-display font-bold text-arcane">{message.roll.result}</div>
                        <div className="text-xs text-muted-foreground">{message.roll.dice}</div>
                      </div>
                      <div className="text-muted-foreground">+{message.roll.modifier}</div>
                      <div className="text-xl font-bold">= {message.roll.total}</div>
                    </div>
                  ) : <p className={message.type === "dm" ? "font-narrative text-lg italic text-parchment" : ""}>{message.content}</p>}
                </motion.div>
              ))}
            </div>
          </ScrollArea>

          {showDice && <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} className="border-t border-border p-4"><Dice3D size="md" /></motion.div>}

          <div className="border-t border-border p-4">
            <div className="max-w-3xl mx-auto flex gap-2">
              <Input placeholder="Describe your action..." value={inputMessage} onChange={(e) => setInputMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSendMessage()} className="bg-input" />
              <Button onClick={handleSendMessage}><Send className="w-4 h-4" /></Button>
            </div>
          </div>
        </div>

        {/* Center: Combat Grid (when in combat) */}
        {inCombat && (
          <div className="flex-1 flex flex-col p-4 gap-4">
            <TurnTracker characters={mockCharacters} currentTurnIndex={currentTurn} roundNumber={1} onEndTurn={() => setCurrentTurn((currentTurn + 1) % mockCharacters.length)} />
            <div className="flex-1 relative">
              <CombatGrid characters={mockCharacters} selectedCharacterId={selectedCharacter?.id} onCharacterClick={setSelectedCharacter} />
              <FloatingDamage damages={damages} onComplete={removeDamage} />
            </div>
            <AbilityBar abilities={mockAbilities} selectedAbilityId={selectedAbility?.id} onAbilitySelect={setSelectedAbility} />
          </div>
        )}

        {/* Right: Party Sidebar */}
        <aside className="w-72 border-l border-border bg-card/30 hidden lg:flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2"><Users className="w-4 h-4 text-primary" /><h2 className="font-display text-sm uppercase">Party</h2></div>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3">
              {mockCharacters.filter(c => !c.isEnemy).map((member) => (
                <div key={member.id} onClick={() => setSelectedCharacter(member)} className="card-parchment rounded-lg p-3 cursor-pointer hover:border-primary/50 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-display text-sm">{member.name}</span>
                    <span className="text-xs text-muted-foreground">{member.class}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Heart className="w-3 h-3 text-destructive" />
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-destructive" style={{ width: `${(member.hp / member.maxHp) * 100}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">{member.hp}/{member.maxHp}</span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="p-4 border-t border-border">
            <Button variant={inCombat ? "destructive" : "combat"} className="w-full" onClick={() => setInCombat(!inCombat)}>
              <Swords className="w-4 h-4 mr-2" />{inCombat ? "Exit Combat" : "Enter Combat"}
            </Button>
          </div>
        </aside>

        {/* Character Sheet Modal */}
        <AnimatePresence>
          {selectedCharacter && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80">
              <CharacterSheet character={{ ...selectedCharacter, stats: { strength: 16, dexterity: 14, constitution: 15, intelligence: 10, wisdom: 12, charisma: 8 }, xp: 2400, xpToNext: 6500, abilities: mockAbilities }} onClose={() => setSelectedCharacter(null)} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Game;
