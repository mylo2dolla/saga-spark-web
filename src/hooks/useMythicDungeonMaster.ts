import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunctionRaw } from "@/lib/edge";
import { runOperation } from "@/lib/ops/runOperation";
import type { OperationState } from "@/lib/ops/operationState";
import { createLogger } from "@/lib/observability/logger";

type MessageRole = "user" | "assistant";

export type MythicUiIntent =
  | "town"
  | "travel"
  | "dungeon"
  | "combat_start"
  | "shop"
  | "focus_target"
  | "open_panel"
  | "dm_prompt"
  | "refresh";

export interface MythicUiAction {
  id: string;
  label: string;
  intent: MythicUiIntent;
  prompt?: string;
  boardTarget?: "town" | "travel" | "dungeon" | "combat";
  panel?: "character" | "gear" | "skills" | "loadouts" | "progression" | "quests" | "commands" | "settings";
  payload?: Record<string, unknown>;
}

export interface MythicDmParsedPayload {
  narration: string;
  ui_actions?: MythicUiAction[];
  scene?: Record<string, unknown>;
  effects?: Record<string, unknown>;
}

export interface MythicDMMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  parsed?: MythicDmParsedPayload;
}

interface SendOptions {
  appendUser?: boolean;
  actionContext?: Record<string, unknown>;
}

const MAX_HISTORY_MESSAGES = 16;
const MAX_MESSAGE_CONTENT = 1800;

const trimMessage = (content: string) =>
  content.length <= MAX_MESSAGE_CONTENT ? content : `${content.slice(0, MAX_MESSAGE_CONTENT)}...`;

const logger = createLogger("mythic-dm-hook");
const JSON_BLOCK_REGEX = /\{[\s\S]*\}/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeIntent(raw: string): MythicUiIntent | null {
  const key = raw.trim().toLowerCase();
  if (
    key === "town" ||
    key === "travel" ||
    key === "dungeon" ||
    key === "combat_start" ||
    key === "shop" ||
    key === "focus_target" ||
    key === "open_panel" ||
    key === "dm_prompt" ||
    key === "refresh"
  ) {
    return key;
  }
  return null;
}

function normalizeUiAction(entry: unknown, index: number): MythicUiAction | null {
  const raw = asRecord(entry);
  if (!raw) return null;
  const intent = normalizeIntent(String(raw.intent ?? ""));
  if (!intent) return null;
  const panelRaw = String(raw.panel ?? "").toLowerCase();
  const panel = panelRaw === "character" || panelRaw === "gear" || panelRaw === "skills" || panelRaw === "loadouts" || panelRaw === "progression" || panelRaw === "quests" || panelRaw === "commands" || panelRaw === "settings"
    ? panelRaw
    : undefined;
  const boardTargetRaw = String(raw.boardTarget ?? raw.board_target ?? "").toLowerCase();
  const boardTarget = boardTargetRaw === "town" || boardTargetRaw === "travel" || boardTargetRaw === "dungeon" || boardTargetRaw === "combat"
    ? boardTargetRaw
    : undefined;
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `dm-action-${index + 1}`,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : `Action ${index + 1}`,
    intent,
    prompt: typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : undefined,
    boardTarget,
    panel,
    payload: asRecord(raw.payload) ?? undefined,
  };
}

function fallbackActionFromLine(line: string, index: number): MythicUiAction | null {
  const clean = line
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/^\s*\d+[.)]\s*/, "")
    .trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (/(inventory|gear|equipment|loadout|skill|skills|progression|quest|character)/.test(lower)) {
    const panel: MythicUiAction["panel"] =
      /gear|equipment|inventory/.test(lower)
        ? "gear"
        : /loadout/.test(lower)
          ? "loadouts"
          : /skill/.test(lower)
            ? "skills"
            : /progression|level/.test(lower)
              ? "progression"
              : /quest/.test(lower)
                ? "quests"
                : "character";
    return {
      id: `fallback-panel-${index + 1}`,
      label: `Open ${panel[0].toUpperCase()}${panel.slice(1)}`,
      intent: "open_panel",
      panel,
      prompt: clean,
    };
  }
  if (/(travel|journey|depart|route|road)/.test(lower)) {
    return { id: `fallback-travel-${index + 1}`, label: "Travel", intent: "travel", boardTarget: "travel", prompt: clean };
  }
  if (/(town|market|vendor|inn|restock)/.test(lower)) {
    return { id: `fallback-town-${index + 1}`, label: "Town", intent: "town", boardTarget: "town", prompt: clean };
  }
  if (/(dungeon|ruin|cave|crypt|explore)/.test(lower)) {
    return { id: `fallback-dungeon-${index + 1}`, label: "Dungeon", intent: "dungeon", boardTarget: "dungeon", prompt: clean };
  }
  if (/(combat|fight|battle|attack|engage)/.test(lower)) {
    return { id: `fallback-combat-${index + 1}`, label: "Start Combat", intent: "combat_start", boardTarget: "combat", prompt: clean };
  }
  if (/(shop|vendor|merchant|blacksmith|armorer|alchemist)/.test(lower)) {
    return { id: `fallback-shop-${index + 1}`, label: "Shop", intent: "shop", prompt: clean };
  }
  if (/(talk|speak|ask|investigate|scout|rumor|faction|plan)/.test(lower)) {
    return { id: `fallback-prompt-${index + 1}`, label: clean.slice(0, 36), intent: "dm_prompt", prompt: clean };
  }
  return null;
}

function parseAssistantPayload(text: string): MythicDmParsedPayload {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(JSON_BLOCK_REGEX);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const raw = asRecord(parsed);
      if (raw) {
        const narration = typeof raw.narration === "string" && raw.narration.trim()
          ? raw.narration.trim()
          : trimmed;
        const actions = Array.isArray(raw.ui_actions)
          ? raw.ui_actions
            .map((entry, index) => normalizeUiAction(entry, index))
            .filter((entry): entry is MythicUiAction => Boolean(entry))
            .slice(0, 8)
          : [];
        const scene = asRecord(raw.scene) ?? undefined;
        const effects = asRecord(raw.effects) ?? undefined;
        return {
          narration,
          ui_actions: actions.length > 0 ? actions : undefined,
          scene,
          effects,
        };
      }
    } catch {
      // Fall through to deterministic text parser.
    }
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
  const fallbackActions = lines
    .map((line, index) => fallbackActionFromLine(line, index))
    .filter((entry): entry is MythicUiAction => Boolean(entry))
    .slice(0, 6);
  return {
    narration: trimmed || "The scene shifts. Describe your next move.",
    ui_actions: fallbackActions.length > 0 ? fallbackActions : undefined,
  };
}

export function useMythicDungeonMaster(campaignId: string | undefined) {
  const [messages, setMessages] = useState<MythicDMMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [operation, setOperation] = useState<OperationState | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
                actionContext: options?.actionContext ?? null,
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

        const parsedResponse = parseAssistantPayload(assistantContent);
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
