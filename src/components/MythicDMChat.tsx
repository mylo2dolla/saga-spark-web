import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MythicDMMessage } from "@/hooks/useMythicDungeonMaster";
import { MythicActionChips } from "@/components/mythic/MythicActionChips";

interface Props {
  messages: MythicDMMessage[];
  isLoading: boolean;
  currentResponse: string;
  onSendMessage: (message: string, actionTags?: string[]) => Promise<void> | void;
  error?: string | null;
}

export function MythicDMChat({ messages, isLoading, currentResponse, onSendMessage, error }: Props) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, currentResponse]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    void onSendMessage(input);
    setInput("");
  };

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 p-3" ref={scrollRef}>
        <div className="space-y-3">
          {error ? <div className="text-sm text-destructive">{error}</div> : null}

          <AnimatePresence mode="popLayout">
            {messages.map((m) => (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className={
                  m.role === "assistant"
                    ? "rounded-lg border border-primary/30 bg-primary/10 p-3"
                    : "ml-10 rounded-lg border border-border bg-card/40 p-3"
                }
              >
                {m.role === "assistant" ? (
                  <div className="mb-2 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="text-xs font-display text-primary uppercase">Mythic DM</span>
                  </div>
                ) : null}
                <div className="whitespace-pre-wrap text-sm text-foreground/90">
                  {m.role === "assistant" ? (m.parsed?.narration ?? m.content) : m.content}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && currentResponse ? (
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 animate-pulse text-primary" />
                <span className="text-xs font-display text-primary uppercase">Mythic DM</span>
              </div>
              <div className="whitespace-pre-wrap text-sm text-foreground/90">
                {currentResponse}
                <span className="inline-block h-4 w-2 bg-primary align-middle" />
              </div>
            </div>
          ) : null}

          {isLoading && !currentResponse ? (
            <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>The DM is sharpening a pencil with a knife.</span>
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-3">
        <div className="mb-2">
          <MythicActionChips
            disabled={isLoading}
            onSelect={(prompt, tags) => {
              void onSendMessage(prompt, tags);
            }}
          />
        </div>
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Say something to the DM..."
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
          />
          <Button onClick={handleSend} disabled={isLoading}>
            Send
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          DB is truth: the DM must narrate from mythic state and events.
        </div>
      </div>
    </div>
  );
}
