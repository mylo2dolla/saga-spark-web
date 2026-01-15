import { useCallback, useEffect, useRef, useState } from "react";
import type { GameEvent } from "@/engine/types";
import type { WorldEvent } from "@/engine/narrative/types";
import { createNarrationEntry, type NarrationEntry } from "@/engine/narrative/Narrator";
import type { NarrationSettings } from "@/hooks/useSettings";

interface UseNarratorOptions {
  settings: NarrationSettings;
}

export function useNarrator({ settings }: UseNarratorOptions) {
  const [entries, setEntries] = useState<NarrationEntry[]>([]);
  const lastSpokenIdRef = useRef<string | null>(null);

  const appendFromEvent = useCallback((event: GameEvent | WorldEvent) => {
    const entry = createNarrationEntry(event);
    if (!entry) return;
    setEntries(prev => [...prev, entry]);
  }, []);

  useEffect(() => {
    if (!settings.readAloudEnabled) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (entries.length === 0) return;

    const latest = entries[entries.length - 1];
    if (latest.id === lastSpokenIdRef.current) return;
    lastSpokenIdRef.current = latest.id;

    const utterance = new SpeechSynthesisUtterance(latest.text);
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;
    window.speechSynthesis.speak(utterance);
  }, [entries, settings.readAloudEnabled, settings.rate, settings.pitch, settings.volume]);

  const clearNarration = useCallback(() => {
    setEntries([]);
    lastSpokenIdRef.current = null;
  }, []);

  return {
    entries,
    appendFromEvent,
    clearNarration,
  };
}
