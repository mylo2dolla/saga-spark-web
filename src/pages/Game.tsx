import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
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
  Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import Logo from "@/components/Logo";
import DiceRoller from "@/components/DiceRoller";

// Mock data for UI demo
const mockMessages = [
  {
    id: 1,
    type: "dm",
    content: "You find yourselves at the entrance of a dark cavern. The air is thick with the smell of sulfur, and distant echoes of something large moving can be heard from within...",
    timestamp: "10:30 AM"
  },
  {
    id: 2,
    type: "player",
    author: "Thorin",
    content: "I light my torch and peer into the darkness. What can I see?",
    timestamp: "10:31 AM"
  },
  {
    id: 3,
    type: "roll",
    author: "Thorin",
    content: "Perception Check",
    roll: { dice: "d20", result: 18, modifier: 3, total: 21 },
    timestamp: "10:31 AM"
  },
  {
    id: 4,
    type: "dm",
    content: "Your keen dwarven eyes pierce the gloom. You spot ancient dwarven runes carved into the walls, and approximately 30 feet ahead, the glint of gold coins scattered on the ground. But something moves in the shadows beyond...",
    timestamp: "10:32 AM"
  }
];

const mockParty = [
  { id: 1, name: "Thorin", class: "Fighter", hp: 45, maxHp: 52, ac: 18 },
  { id: 2, name: "Elara", class: "Wizard", hp: 22, maxHp: 24, ac: 13 },
  { id: 3, name: "Shadowmere", class: "Rogue", hp: 31, maxHp: 38, ac: 15 },
];

const Game = () => {
  const { campaignId } = useParams();
  const [messages] = useState(mockMessages);
  const [inputMessage, setInputMessage] = useState("");
  const [showDice, setShowDice] = useState(false);

  const handleSendMessage = () => {
    if (!inputMessage.trim()) return;
    // Would send to backend
    setInputMessage("");
  };

  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="glass-dark border-b border-border flex-shrink-0">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/dashboard">
              <Button variant="ghost" size="sm">
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            </Link>
            <div className="hidden sm:block">
              <h1 className="font-display text-lg text-foreground">The Dragon's Lair</h1>
              <p className="text-xs text-muted-foreground">Campaign ID: {campaignId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant={showDice ? "default" : "ghost"} 
              size="sm"
              onClick={() => setShowDice(!showDice)}
            >
              <Sparkles className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm">
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Game Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Chat Panel */}
        <div className="flex-1 flex flex-col min-w-0">
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-4 max-w-3xl mx-auto">
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`
                    ${message.type === "dm" ? "bg-primary/10 border-l-4 border-primary" : ""}
                    ${message.type === "player" ? "bg-card/50" : ""}
                    ${message.type === "roll" ? "bg-arcane/10 border border-arcane/30" : ""}
                    rounded-lg p-4
                  `}
                >
                  {message.type === "dm" && (
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      <span className="text-xs font-display text-primary uppercase tracking-wider">
                        Dungeon Master
                      </span>
                    </div>
                  )}
                  {message.type === "player" && (
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium text-foreground">{message.author}</span>
                      <span className="text-xs text-muted-foreground">{message.timestamp}</span>
                    </div>
                  )}
                  {message.type === "roll" && (
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-foreground">{message.author}</span>
                      <span className="text-xs text-muted-foreground">{message.content}</span>
                    </div>
                  )}
                  
                  {message.type === "roll" && message.roll ? (
                    <div className="flex items-center gap-4">
                      <div className="bg-arcane/20 rounded-lg px-4 py-2 text-center">
                        <div className="text-2xl font-display font-bold text-arcane">
                          {message.roll.result}
                        </div>
                        <div className="text-xs text-muted-foreground">{message.roll.dice}</div>
                      </div>
                      <div className="text-muted-foreground">+{message.roll.modifier}</div>
                      <div className="text-xl font-bold text-foreground">= {message.roll.total}</div>
                    </div>
                  ) : (
                    <p className={`${message.type === "dm" ? "font-narrative text-lg italic text-parchment" : "text-foreground"}`}>
                      {message.content}
                    </p>
                  )}
                </motion.div>
              ))}
            </div>
          </ScrollArea>

          {/* Dice Roller (collapsible) */}
          {showDice && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="border-t border-border p-4"
            >
              <div className="max-w-md mx-auto">
                <DiceRoller compact />
              </div>
            </motion.div>
          )}

          {/* Input Area */}
          <div className="border-t border-border p-4">
            <div className="max-w-3xl mx-auto flex gap-2">
              <Input
                placeholder="Describe your action..."
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                className="bg-input"
              />
              <Button onClick={handleSendMessage}>
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Party Sidebar */}
        <aside className="w-72 border-l border-border bg-card/30 hidden lg:flex flex-col">
          <div className="p-4 border-b border-border">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-primary" />
              <h2 className="font-display text-sm uppercase tracking-wider text-foreground">Party</h2>
            </div>
          </div>
          
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3">
              {mockParty.map((member) => (
                <div 
                  key={member.id}
                  className="card-parchment rounded-lg p-3 cursor-pointer hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-display text-sm text-foreground">{member.name}</span>
                    <span className="text-xs text-muted-foreground">{member.class}</span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Heart className="w-3 h-3 text-destructive" />
                      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-destructive transition-all"
                          style={{ width: `${(member.hp / member.maxHp) * 100}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {member.hp}/{member.maxHp}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Shield className="w-3 h-3" />
                      <span>AC {member.ac}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          {/* Combat Mode Button */}
          <div className="p-4 border-t border-border">
            <Button variant="combat" className="w-full">
              <Swords className="w-4 h-4 mr-2" />
              Enter Combat
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default Game;
