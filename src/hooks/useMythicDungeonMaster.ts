import { useCallback, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunction } from "@/lib/edge";
import type { MythicDmTurnResponse } from "@/types/mythicDm";
import { applyMythicE2ETurn, isMythicE2E } from "@/ui/e2e/mythicState";

type MessageRole = "user" | "assistant";

export interface MythicDMMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  parsed?: MythicDmTurnResponse;
}

export interface MythicUiAction {
  id: string;
  label: string;
  intent?: string;
  prompt?: string;
  actionTags?: string[];
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

interface SendOptions {
  appendUser?: boolean;
  actionTags?: string[];
}

interface MythicDungeonMasterResult {
  ok: boolean;
  turn?: MythicDmTurnResponse;
  error?: string;
}

export function useMythicDungeonMaster(campaignId: string | undefined) {
  const [messages, setMessages] = useState<MythicDMMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");

  const sendMessage = useCallback(
    async (content: string, options?: SendOptions) => {
      if (!campaignId) throw new Error("Missing campaignId");

      const userMessage: MythicDMMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date(),
      };

      const shouldAppendUser = options?.appendUser !== false;
      if (shouldAppendUser) setMessages((prev) => [...prev, userMessage]);

      setIsLoading(true);
      setCurrentResponse("");

      try {
        if (isMythicE2E(campaignId)) {
          const inferredMood =
            options?.actionTags?.includes("mercy")
              ? "merciful"
              : options?.actionTags?.includes("retreat")
                ? "chaotic-patron"
                : options?.actionTags?.includes("threaten")
                  ? "predatory"
                  : "taunting";
          const parsedResponse: MythicDmTurnResponse = {
            narration: `The DM snaps at you, then smirks. "${content}" twists the scene, and the world answers in kind.`,
            suggestions: [
              "Press the advantage before the mood shifts.",
              "Cash in the temporary opening or brace for punishment.",
              "Decide whether this arc ends in dominance or restraint.",
            ],
            quest_ops: [
              {
                type: "upsert_arc",
                arc_key: "e2e-pressure-arc",
                title: "E2E Pressure Arc",
                summary: "Survive the DM's mood swings while staying dangerous.",
                state: "active",
                priority: 4,
              },
              {
                type: "upsert_objective",
                arc_key: "e2e-pressure-arc",
                objective_key: "e2e-endure",
                objective_description: "Endure three volatile turns.",
                objective_target_count: 3,
                objective_state: "active",
              },
              {
                type: "progress_objective",
                arc_key: "e2e-pressure-arc",
                objective_key: "e2e-endure",
                objective_delta: 1,
              },
            ],
            story_beat: {
              beat_type: "dm_turn",
              title: "Mood swing in motion",
              narrative: `Action received: ${content}`,
              emphasis: "high",
              metadata: { action_tags: options?.actionTags ?? [] },
            },
            dm_deltas: { menace: 0.04, amusement: 0.02 },
            tension_deltas: { tension: 0.03, spectacle: 0.02 },
            memory_events: [
              {
                category: "e2e_turn",
                severity: 2,
                payload: { action: content },
              },
            ],
            ui_hints: { e2e: true },
            mood_before: "taunting",
            mood_after: inferredMood,
            action_tags: options?.actionTags ?? [],
            applied: {
              quest_arcs_updated: 1,
              quest_objectives_updated: 2,
              story_beats_created: 1,
              dm_memory_events_created: 1,
              mood_after: inferredMood,
            },
          };

          applyMythicE2ETurn(campaignId, parsedResponse, content);
          const assistantMessage: MythicDMMessage = {
            id: crypto.randomUUID(),
            role: "assistant",
            content: parsedResponse.narration,
            timestamp: new Date(),
            parsed: parsedResponse,
          };
          setMessages((prev) => [...prev, assistantMessage]);
          setCurrentResponse("");
          return { message: assistantMessage, parsed: parsedResponse };
        }

        const payloadMessages = [...messages, userMessage].map((m) => ({ role: m.role, content: m.content }));
        const response = await callEdgeFunction<MythicDungeonMasterResult>("mythic-dungeon-master", {
          requireAuth: true,
          body: {
            campaignId,
            messages: payloadMessages,
            actionTags: options?.actionTags ?? [],
          },
        });

        if (response.error) {
          throw response.error;
        }
        if (!response.data?.ok || !response.data.turn) {
          throw new Error(response.data?.error ?? "Mythic DM returned no turn payload");
        }

        const parsedResponse = response.data.turn;
        const assistantContent = parsedResponse.narration;
        setCurrentResponse(assistantContent);

        const assistantMessage: MythicDMMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantContent,
          timestamp: new Date(),
          parsed: parsedResponse,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setCurrentResponse("");

        return { message: assistantMessage, parsed: parsedResponse };
      } catch (error) {
        console.error("Mythic DM Error:", error);
        toast.error(error instanceof Error ? error.message : "Failed to reach Mythic DM");
        setCurrentResponse("");
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [campaignId, messages],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setCurrentResponse("");
  }, []);

  return {
    messages,
    isLoading,
    currentResponse,
    sendMessage,
    clearMessages,
  };
}
