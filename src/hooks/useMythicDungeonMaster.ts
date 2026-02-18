import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunctionRaw } from "@/lib/edge";
import { runOperation } from "@/lib/ops/runOperation";
import type { OperationState } from "@/lib/ops/operationState";
import { createLogger } from "@/lib/observability/logger";

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

const MAX_HISTORY_MESSAGES = 16;
const MAX_MESSAGE_CONTENT = 1800;

const trimMessage = (content: string) =>
  content.length <= MAX_MESSAGE_CONTENT ? content : `${content.slice(0, MAX_MESSAGE_CONTENT)}...`;

const logger = createLogger("mythic-dm-hook");

export function useMythicDungeonMaster(campaignId: string | undefined) {
  const [messages, setMessages] = useState<MythicDMMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [operation, setOperation] = useState<OperationState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setIsLoading(true);
      setCurrentResponse("");

      let assistantContent = "";
      try {
        const { result: response } = await runOperation({
          name: "mythic.dm.send",
          signal: controller.signal,
          timeoutMs: 30_000,
          maxRetries: 1,
          onUpdate: setOperation,
          run: async ({ signal }) =>
            await callEdgeFunctionRaw("mythic-dungeon-master", {
              requireAuth: true,
              signal,
              idempotencyKey: `${campaignId}:${crypto.randomUUID()}`,
              body: {
                campaignId,
                messages: [...messages, userMessage]
                  .slice(-MAX_HISTORY_MESSAGES)
                  .map((m) => ({ role: m.role, content: trimMessage(m.content) })),
              },
            }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({} as Record<string, unknown>));
          const baseMessage =
            (typeof errorData.error === "string" && errorData.error) ||
            (typeof errorData.message === "string" && errorData.message) ||
            `Request failed: ${response.status}`;
          const code = typeof errorData.code === "string" ? errorData.code : null;
          throw new Error(code ? `${baseMessage} [${code}]` : baseMessage);
        }

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (controller.signal.aborted) {
            await reader.cancel();
            throw new Error("DM request cancelled");
          }
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
        logger.error("mythic.dm.send.failed", error);
        toast.error(error instanceof Error ? error.message : "Failed to reach Mythic DM");
        setCurrentResponse("");
        throw error;
      } finally {
        abortRef.current = null;
        setIsLoading(false);
      }
    },
    [campaignId, messages],
  );

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setCurrentResponse("");
  }, []);

  const cancelMessage = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    isLoading,
    currentResponse,
    operation,
    sendMessage,
    clearMessages,
    cancelMessage,
  };
}
