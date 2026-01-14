import { useState, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type MessageRole = "user" | "assistant";

export interface DMMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  parsed?: DMResponse;
}

export interface DMResponse {
  narration: string;
  scene?: {
    type: "exploration" | "dialogue" | "combat";
    mood: string;
    location: string;
    environment?: string;
  };
  npcs?: Array<{
    name: string;
    dialogue: string;
    attitude: "friendly" | "hostile" | "neutral";
  }>;
  combat?: {
    active: boolean;
    enemies: Array<{
      name: string;
      hp: number;
      maxHp: number;
      ac: number;
      initiative: number;
    }>;
    round: number;
    currentTurn: string;
  };
  rolls?: Array<{
    type: "attack" | "skill" | "save";
    dice: string;
    result: number;
    modifier: number;
    total: number;
    success: boolean;
  }>;
  effects?: Array<{
    target: string;
    effect: "damage" | "heal" | "buff" | "debuff";
    value: number;
    description: string;
  }>;
  loot?: Array<{
    name: string;
    type: "weapon" | "armor" | "consumable" | "treasure";
    description: string;
  }>;
  xpGained?: number;
  levelUps?: Array<{
    character: string;
    newLevel: number;
    gainedStats: {
      strength?: number;
      dexterity?: number;
      constitution?: number;
      intelligence?: number;
      wisdom?: number;
      charisma?: number;
    };
    abilitiesGained: string[];
  }>;
  suggestions?: string[];
}

interface CombatEventForDM {
  type: string;
  actor?: string;
  target?: string;
  ability?: string;
  damage?: number;
  healing?: number;
  success?: boolean;
  rolls?: Array<{
    type: string;
    result: number;
    total: number;
    isCritical?: boolean;
    isFumble?: boolean;
  }>;
  description?: string;
}

interface GameContext {
  party?: Array<{
    name: string;
    class: string;
    level: number;
    hp: number;
    maxHp: number;
  }>;
  location?: string;
  campaignName?: string;
  inCombat?: boolean;
  enemies?: Array<{
    name: string;
    hp: number;
    maxHp: number;
  }>;
  history?: string;
  combatEvents?: CombatEventForDM[];
  currentTurn?: string;
  roundNumber?: number;
}

const DM_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dungeon-master`;

export function useDungeonMaster() {
  const [messages, setMessages] = useState<DMMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");

  const parseResponse = (text: string): DMResponse | null => {
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {
      // If parsing fails, return narration-only response
    }
    return { narration: text };
  };

  const sendMessage = useCallback(async (
    content: string,
    context?: GameContext
  ) => {
    const userMessage: DMMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setCurrentResponse("");

    let assistantContent = "";

    try {
      // Get the current session token for authenticated requests
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("You must be logged in to speak with the Dungeon Master");
      }

      const response = await fetch(DM_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
          })),
          context,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              setCurrentResponse(assistantContent);
            }
          } catch {
            // Incomplete JSON, put back and wait for more
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Final flush
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) assistantContent += content;
          } catch { /* ignore */ }
        }
      }

      const parsedResponse = parseResponse(assistantContent);

      const assistantMessage: DMMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: assistantContent,
        timestamp: new Date(),
        parsed: parsedResponse || undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);
      setCurrentResponse("");

      return { message: assistantMessage, parsed: parsedResponse };
    } catch (error) {
      console.error("DM Error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to reach the Dungeon Master");
      setCurrentResponse("");
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [messages]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setCurrentResponse("");
  }, []);

  const startNewAdventure = useCallback(async (context?: GameContext) => {
    clearMessages();
    return sendMessage(
      "Begin a new adventure! Set the scene and introduce the party to their surroundings.",
      context
    );
  }, [clearMessages, sendMessage]);

  return {
    messages,
    isLoading,
    currentResponse,
    sendMessage,
    clearMessages,
    startNewAdventure,
  };
}
