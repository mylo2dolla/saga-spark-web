import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Loader2, Sword, Heart, Gift, Star, Dices } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DMMessage, DMResponse } from "@/hooks/useDungeonMaster";

interface DMChatProps {
  messages: DMMessage[];
  isLoading: boolean;
  currentResponse: string;
  onSendMessage: (message: string) => void;
  suggestions?: string[];
}

const RollDisplay = ({ roll }: { roll: DMResponse["rolls"][0] }) => (
  <motion.div
    initial={{ scale: 0.8, opacity: 0 }}
    animate={{ scale: 1, opacity: 1 }}
    className="inline-flex items-center gap-2 bg-arcane/20 border border-arcane/40 rounded-lg px-3 py-2"
  >
    <Dices className="w-4 h-4 text-arcane" />
    <span className="text-2xl font-display font-bold text-arcane">{roll.result}</span>
    <span className="text-muted-foreground">{roll.dice}</span>
    {roll.modifier !== 0 && (
      <>
        <span className="text-muted-foreground">+{roll.modifier}</span>
        <span className="text-foreground font-bold">= {roll.total}</span>
      </>
    )}
    <span className={`text-xs px-2 py-0.5 rounded ${roll.success ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
      {roll.success ? "Success" : "Fail"}
    </span>
  </motion.div>
);

const EffectDisplay = ({ effect }: { effect: DMResponse["effects"][0] }) => {
  const icons = {
    damage: <Sword className="w-4 h-4 text-destructive" />,
    heal: <Heart className="w-4 h-4 text-green-400" />,
    buff: <Star className="w-4 h-4 text-primary" />,
    debuff: <Star className="w-4 h-4 text-orange-400" />,
  };

  const colors = {
    damage: "border-destructive/40 bg-destructive/10",
    heal: "border-green-500/40 bg-green-500/10",
    buff: "border-primary/40 bg-primary/10",
    debuff: "border-orange-500/40 bg-orange-500/10",
  };

  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      className={`inline-flex items-center gap-2 border rounded-lg px-3 py-1 ${colors[effect.effect]}`}
    >
      {icons[effect.effect]}
      <span className="font-medium">{effect.target}</span>
      <span className="text-muted-foreground">{effect.description}</span>
      <span className="font-bold">{effect.effect === "damage" ? "-" : "+"}{effect.value}</span>
    </motion.div>
  );
};

const LootDisplay = ({ loot }: { loot: DMResponse["loot"][0] }) => (
  <motion.div
    initial={{ y: 10, opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/40 rounded-lg px-3 py-1"
  >
    <Gift className="w-4 h-4 text-amber-400" />
    <span className="font-medium text-amber-200">{loot.name}</span>
    <span className="text-xs text-muted-foreground">({loot.type})</span>
  </motion.div>
);

const MessageContent = ({ message }: { message: DMMessage }) => {
  const { parsed } = message;

  if (message.role === "user") {
    return <p>{message.content}</p>;
  }

  if (!parsed) {
    return <p className="font-narrative text-lg italic text-parchment whitespace-pre-wrap">{message.content}</p>;
  }

  return (
    <div className="space-y-4">
      {/* Main narration */}
      <p className="font-narrative text-lg italic text-parchment whitespace-pre-wrap">
        {parsed.narration}
      </p>

      {/* NPC Dialogue */}
      {parsed.npcs && parsed.npcs.length > 0 && (
        <div className="space-y-2">
          {parsed.npcs.map((npc, i) => (
            <div key={i} className="pl-4 border-l-2 border-muted">
              <span className="font-display text-sm text-muted-foreground">{npc.name}:</span>
              <p className="italic">"{npc.dialogue}"</p>
            </div>
          ))}
        </div>
      )}

      {/* Dice Rolls */}
      {parsed.rolls && parsed.rolls.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {parsed.rolls.map((roll, i) => (
            <RollDisplay key={i} roll={roll} />
          ))}
        </div>
      )}

      {/* Effects */}
      {parsed.effects && parsed.effects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {parsed.effects.map((effect, i) => (
            <EffectDisplay key={i} effect={effect} />
          ))}
        </div>
      )}

      {/* Loot */}
      {parsed.loot && parsed.loot.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {parsed.loot.map((item, i) => (
            <LootDisplay key={i} loot={item} />
          ))}
        </div>
      )}

      {/* XP Gained */}
      {parsed.xpGained && parsed.xpGained > 0 && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="inline-flex items-center gap-2 bg-primary/20 border border-primary/40 rounded-full px-4 py-1"
        >
          <Star className="w-4 h-4 text-primary" />
          <span className="font-display text-primary">+{parsed.xpGained} XP</span>
        </motion.div>
      )}
    </div>
  );
};

export function DMChat({ messages, isLoading, currentResponse, onSendMessage, suggestions }: DMChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentResponse]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSendMessage(input);
    setInput("");
  };

  const handleSuggestion = (suggestion: string) => {
    if (isLoading) return;
    onSendMessage(suggestion);
  };

  return (
    <div className="flex flex-col h-full">
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4 max-w-3xl mx-auto">
          <AnimatePresence mode="popLayout">
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`rounded-lg p-4 ${
                  message.role === "assistant"
                    ? "bg-primary/10 border-l-4 border-primary"
                    : "bg-card/50 ml-8"
                }`}
              >
                {message.role === "assistant" && (
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-xs font-display text-primary uppercase">Dungeon Master</span>
                  </div>
                )}
                <MessageContent message={message} />
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Streaming response */}
          {isLoading && currentResponse && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-primary/10 border-l-4 border-primary rounded-lg p-4"
            >
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-primary animate-pulse" />
                <span className="text-xs font-display text-primary uppercase">Dungeon Master</span>
              </div>
              <p className="font-narrative text-lg italic text-parchment whitespace-pre-wrap">
                {currentResponse}
                <span className="inline-block w-2 h-4 ml-1 bg-primary animate-pulse" />
              </p>
            </motion.div>
          )}

          {/* Loading indicator */}
          {isLoading && !currentResponse && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center justify-center gap-2 py-4 text-muted-foreground"
            >
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="font-narrative italic">The Dungeon Master contemplates...</span>
            </motion.div>
          )}
        </div>
      </ScrollArea>

      {/* Suggestions */}
      {suggestions && suggestions.length > 0 && !isLoading && (
        <div className="border-t border-border px-4 py-2">
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion, i) => (
              <Button
                key={i}
                variant="outline"
                size="sm"
                onClick={() => handleSuggestion(suggestion)}
                className="text-xs"
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Input
            ref={inputRef}
            placeholder="Describe your action..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            className="bg-input"
            disabled={isLoading}
          />
          <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
