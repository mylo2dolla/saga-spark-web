import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MythicDMMessage } from "@/hooks/useMythicDungeonMaster";
import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";

interface Props {
  messages: MythicDMMessage[];
  isLoading: boolean;
  currentResponse: string;
  onSendMessage: (message: string) => void;
  actions?: MythicUiAction[];
  onAction?: (action: MythicUiAction) => void;
  voiceEnabled?: boolean;
  voiceSupported?: boolean;
  voiceBlocked?: boolean;
  onToggleVoice?: (enabled: boolean) => void;
  onSpeakLatest?: () => void;
  onStopVoice?: () => void;
  autoFollow?: boolean;
  error?: string | null;
}

export function MythicDMChat({
  messages,
  isLoading,
  currentResponse,
  onSendMessage,
  actions,
  onAction,
  voiceEnabled,
  voiceSupported,
  voiceBlocked,
  onToggleVoice,
  onSpeakLatest,
  onStopVoice,
  autoFollow = true,
  error,
}: Props) {
  const [input, setInput] = useState("");
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasUnread, setHasUnread] = useState(false);

  const resolveViewport = useCallback(() => {
    if (viewportRef.current && viewportRef.current.isConnected) {
      return viewportRef.current;
    }
    const root = scrollRootRef.current;
    if (!root) return null;
    const viewport = root.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null;
    if (viewport) viewportRef.current = viewport;
    return viewport;
  }, []);

  const computeNearBottom = useCallback(() => {
    const viewport = resolveViewport();
    if (!viewport) return true;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    return distanceFromBottom <= 64;
  }, [resolveViewport]);

  const jumpToLatest = useCallback((behavior: ScrollBehavior = "smooth") => {
    const viewport = resolveViewport();
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    setIsNearBottom(true);
    setHasUnread(false);
  }, [resolveViewport]);

  useEffect(() => {
    let detach: (() => void) | null = null;
    let raf = 0;
    const bind = () => {
      const viewport = resolveViewport();
      if (!viewport) {
        raf = window.requestAnimationFrame(bind);
        return;
      }
      const onScroll = () => {
        const nearBottom = computeNearBottom();
        setIsNearBottom(nearBottom);
        if (nearBottom) setHasUnread(false);
      };
      onScroll();
      viewport.addEventListener("scroll", onScroll, { passive: true });
      detach = () => viewport.removeEventListener("scroll", onScroll);
    };
    bind();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      detach?.();
    };
  }, [computeNearBottom, resolveViewport]);

  useEffect(() => {
    const viewport = resolveViewport();
    if (!viewport) return;
    if (!autoFollow) {
      setHasUnread(true);
      return;
    }
    if (isNearBottom) {
      const behavior: ScrollBehavior = isLoading ? "auto" : "smooth";
      jumpToLatest(behavior);
      return;
    }
    setHasUnread(true);
  }, [autoFollow, currentResponse, isLoading, isNearBottom, jumpToLatest, messages, resolveViewport]);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSendMessage(input);
    setInput("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative min-h-0 flex-1">
        <ScrollArea className="h-full min-h-0 p-3" ref={scrollRootRef}>
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

        {hasUnread ? (
          <div className="absolute bottom-3 right-3 z-20">
            <Button size="sm" variant="secondary" onClick={() => jumpToLatest("smooth")}>
              Jump to latest
            </Button>
          </div>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        {actions && actions.length > 0 ? (
          <div className="mb-2 flex max-h-[68px] flex-wrap gap-2 overflow-hidden">
            {actions.slice(0, 6).map((action) => (
              <Button
                key={action.id}
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 max-w-[210px] justify-start overflow-hidden text-ellipsis whitespace-nowrap border border-amber-200/25 bg-amber-100/10 text-amber-50 hover:bg-amber-100/15"
                onClick={() => {
                  if (!onAction) return;
                  onAction(action);
                }}
                disabled={isLoading}
              >
                {action.label}
              </Button>
            ))}
          </div>
        ) : null}

        {typeof voiceEnabled === "boolean" ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <Button
              type="button"
              size="sm"
              variant={voiceEnabled ? "secondary" : "outline"}
              onClick={() => onToggleVoice?.(!voiceEnabled)}
              disabled={!voiceSupported}
            >
              Voice: {voiceEnabled ? "On" : "Off"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onSpeakLatest?.()} disabled={!voiceSupported}>
              Speak Latest
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onStopVoice?.()} disabled={!voiceSupported}>
              Stop
            </Button>
            {voiceSupported === false ? (
              <span className="text-muted-foreground">Voice unavailable in this browser.</span>
            ) : null}
            {voiceBlocked ? (
              <span className="text-amber-300">Audio is ready; click Speak Latest to play.</span>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
              }
            }}
            placeholder="Say something to the DM..."
            className="w-full"
            disabled={isLoading}
          />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={handleSend} disabled={isLoading || !input.trim()}>
            Send
          </Button>
          {!isNearBottom ? (
            <Button variant="ghost" size="sm" onClick={() => jumpToLatest("smooth")}>
              Latest
            </Button>
          ) : null}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          DB is truth: the DM must narrate from mythic state and events.
        </div>
      </div>
    </div>
  );
}
