import { useCallback, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunctionRaw } from "@/lib/edge";

type MessageRole = "user" | "assistant";

export interface MythicDMMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  parsed?: { narration: string; [k: string]: unknown };
}

interface SendOptions {
  appendUser?: boolean;
}

export function useMythicDungeonMaster(campaignId: string | undefined) {
  const [messages, setMessages] = useState<MythicDMMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");

  const parseResponse = (text: string): { narration: string; [k: string]: unknown } | null => {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    } catch {
      // ignore
    }
    return { narration: text };
  };

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

      let assistantContent = "";
      try {
        const response = await callEdgeFunctionRaw("mythic-dungeon-master", {
          requireAuth: true,
          body: {
            campaignId,
            messages: [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })),
          },
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Request failed: ${response.status}`);
        }

        if (!response.body) throw new Error("No response body");

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
            if (line.startsWith(":")) continue;
            if (!line.startsWith("data: ")) continue;

            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;

            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                assistantContent += delta;
                setCurrentResponse(assistantContent);
              }
            } catch {
              // Incomplete chunk; put back.
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }

        const parsedResponse = parseResponse(assistantContent);
        const assistantMessage: MythicDMMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: assistantContent,
          timestamp: new Date(),
          parsed: parsedResponse || undefined,
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
