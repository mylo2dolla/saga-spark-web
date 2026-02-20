import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunctionRaw } from "@/lib/edge";
import { runOperation } from "@/lib/ops/runOperation";
import type { OperationState } from "@/lib/ops/operationState";
import { createLogger } from "@/lib/observability/logger";
import type { MythicDmResponseMeta } from "@/types/mythic";

type MessageRole = "user" | "assistant";

export type MythicUiIntent =
  | "quest_action"
  | "town"
  | "travel"
  | "dungeon"
  | "combat_start"
  | "combat_action"
  | "shop_action"
  | "loadout_action"
  | "companion_action"
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
  hint_key?: string;
  boardTarget?: "town" | "travel" | "dungeon" | "combat";
  panel?: "status" | "character" | "loadout" | "gear" | "skills" | "loadouts" | "progression" | "quests" | "combat" | "companions" | "shop" | "commands" | "settings";
  payload?: Record<string, unknown>;
}

export interface MythicDmParsedPayload {
  narration: string;
  ui_actions?: MythicUiAction[];
  scene?: Record<string, unknown>;
  effects?: Record<string, unknown>;
  meta?: MythicDmResponseMeta;
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
  idempotencyKey?: string;
  timeoutMs?: number;
}

const MAX_HISTORY_MESSAGES = 16;
const MAX_MESSAGE_CONTENT = 1800;
const DEFAULT_DM_TIMEOUT_MS = 95_000;
const LOW_SIGNAL_ACTION_LABEL = /^(action\s+\d+|narrative\s+update)$/i;

const trimMessage = (content: string) =>
  content.length <= MAX_MESSAGE_CONTENT ? content : `${content.slice(0, MAX_MESSAGE_CONTENT)}...`;

const logger = createLogger("mythic-dm-hook");

function isLowSignalActionLabel(value: string): boolean {
  return LOW_SIGNAL_ACTION_LABEL.test(value.trim());
}

function titleCaseWords(input: string): string {
  return input
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function defaultLabelForIntent(intent: MythicUiIntent): string {
  if (intent === "quest_action") return "Advance Quest";
  if (intent === "combat_start") return "Start Combat";
  if (intent === "combat_action") return "Combat Action";
  if (intent === "shop_action") return "Open Shop";
  if (intent === "loadout_action") return "Open Loadout";
  if (intent === "companion_action") return "Companion Follow-Up";
  if (intent === "open_panel") return "Open Panel";
  if (intent === "dm_prompt") return "Press The Scene";
  if (intent === "focus_target") return "Focus Target";
  if (intent === "refresh") return "Refresh State";
  return `Go ${titleCaseWords(intent)}`;
}

function compactLabel(input: string, maxLen = 42): string {
  const clean = input.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.length > maxLen ? `${clean.slice(0, maxLen).trim()}...` : clean;
}

function normalizeActionLabel(args: {
  labelRaw: unknown;
  prompt: string | undefined;
  intent: MythicUiIntent;
}): string {
  const candidate = typeof args.labelRaw === "string" ? compactLabel(args.labelRaw, 80) : "";
  if (candidate && !isLowSignalActionLabel(candidate)) return candidate;

  const promptLabel = compactLabel(args.prompt ?? "");
  if (promptLabel && !isLowSignalActionLabel(promptLabel)) return promptLabel;

  return defaultLabelForIntent(args.intent);
}

function extractBalancedJsonObject(text: string): string | null {
  const source = text.trim();
  if (!source) return null;
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (start === -1) {
      if (ch === "{") {
        start = i;
        depth = 1;
      }
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeIntent(raw: string): MythicUiIntent | null {
  const key = raw.trim().toLowerCase();
  if (key === "quest_action" || key === "quest" || key === "objective") return "quest_action";
  if (key === "combat_start" || key === "combat_begin" || key === "engage") return "combat_start";
  if (key === "combat_action" || key === "combat" || key === "attack" || key === "use_skill" || key === "focus_target") return "combat_action";
  if (key === "shop_action" || key === "shop" || key === "vendor") return "shop_action";
  if (key === "loadout_action" || key === "open_panel" || key === "panel" || key === "open_menu" || key === "gear" || key === "loadout") return "loadout_action";
  if (key === "companion_action" || key === "companion") return "companion_action";
  if (key === "dm_prompt" || key === "prompt" || key === "narrate") return "dm_prompt";
  if (key === "refresh") return "refresh";
  // One-release ingress normalization for legacy board intents.
  if (key === "town" || key === "travel" || key === "dungeon") return "quest_action";
  return null;
}

function normalizeUiAction(entry: unknown, index: number): MythicUiAction | null {
  const raw = asRecord(entry);
  if (!raw) return null;
  const intent = normalizeIntent(String(raw.intent ?? ""));
  if (!intent) return null;
  const prompt = typeof raw.prompt === "string" && raw.prompt.trim() ? raw.prompt.trim() : undefined;
  const panelRaw = String(raw.panel ?? "").toLowerCase();
  const panel = panelRaw === "status" || panelRaw === "character" || panelRaw === "loadout" || panelRaw === "gear" || panelRaw === "skills" || panelRaw === "loadouts" || panelRaw === "progression" || panelRaw === "quests" || panelRaw === "combat" || panelRaw === "companions" || panelRaw === "shop" || panelRaw === "commands" || panelRaw === "settings"
    ? panelRaw
    : undefined;
  const boardTargetRaw = String(raw.boardTarget ?? raw.board_target ?? "").toLowerCase();
  const boardTarget = boardTargetRaw === "town" || boardTargetRaw === "travel" || boardTargetRaw === "dungeon" || boardTargetRaw === "combat"
    ? boardTargetRaw
    : undefined;
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `mythic-action-${index + 1}`,
    label: normalizeActionLabel({
      labelRaw: raw.label,
      prompt,
      intent,
    }),
    intent,
    prompt,
    hint_key: typeof raw.hint_key === "string" && raw.hint_key.trim().length > 0 ? raw.hint_key.trim() : undefined,
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
  const label = compactLabel(clean);
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
      id: `mythic-panel-${index + 1}`,
      label,
      intent: "loadout_action",
      panel,
      prompt: clean,
    };
  }
  if (/(travel|journey|depart|route|road)/.test(lower)) {
    return { id: `mythic-travel-${index + 1}`, label, intent: "quest_action", boardTarget: "travel", payload: { mode: "travel" }, prompt: clean };
  }
  if (/(town|market|vendor|inn|restock)/.test(lower)) {
    return { id: `mythic-town-${index + 1}`, label, intent: "quest_action", boardTarget: "town", payload: { mode: "town" }, prompt: clean };
  }
  if (/(dungeon|ruin|cave|crypt|explore)/.test(lower)) {
    return { id: `mythic-dungeon-${index + 1}`, label, intent: "quest_action", boardTarget: "dungeon", payload: { mode: "dungeon" }, prompt: clean };
  }
  if (/(combat|fight|battle|attack|engage)/.test(lower)) {
    return { id: `mythic-combat-${index + 1}`, label, intent: "combat_start", boardTarget: "combat", payload: { mode: "combat" }, prompt: clean };
  }
  if (/(shop|vendor|merchant|blacksmith|armorer|alchemist)/.test(lower)) {
    return { id: `mythic-shop-${index + 1}`, label, intent: "shop_action", prompt: clean };
  }
  if (/(companion|ally|sidekick)/.test(lower)) {
    return { id: `mythic-companion-${index + 1}`, label, intent: "companion_action", prompt: clean };
  }
  if (/(talk|speak|ask|investigate|scout|rumor|faction|plan)/.test(lower)) {
    return { id: `mythic-quest-${index + 1}`, label, intent: "quest_action", prompt: clean };
  }
  return null;
}

function parseAssistantPayload(text: string): MythicDmParsedPayload {
  const trimmed = text.trim();
  const jsonText = extractBalancedJsonObject(trimmed);

  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
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
        const meta = asRecord(raw.meta) as MythicDmResponseMeta | undefined;
        return {
          narration,
          ui_actions: actions.length > 0
            ? actions.filter((entry) => !isLowSignalActionLabel(entry.label))
            : undefined,
          scene,
          effects,
          meta,
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
    .filter((entry) => !isLowSignalActionLabel(entry.label))
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
      const actionTraceId = typeof options?.actionContext?.action_trace_id === "string"
        ? options.actionContext.action_trace_id
        : null;
      logger.info("mythic.dm.send.start", {
        campaign_id: campaignId,
        action_trace_id: actionTraceId,
        append_user: shouldAppendUser,
      });

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
          timeoutMs: Math.max(30_000, Math.min(120_000, options?.timeoutMs ?? DEFAULT_DM_TIMEOUT_MS)),
          maxRetries: 0,
          onUpdate: setOperation,
          run: async ({ signal }) =>
            await callEdgeFunctionRaw("mythic-dungeon-master", {
              requireAuth: true,
              signal,
              timeoutMs: Math.max(30_000, Math.min(120_000, options?.timeoutMs ?? DEFAULT_DM_TIMEOUT_MS)),
              maxRetries: 0,
              idempotencyKey: options?.idempotencyKey ?? `${campaignId}:${crypto.randomUUID()}`,
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
        logger.info("mythic.dm.send.complete", {
          campaign_id: campaignId,
          action_trace_id: actionTraceId,
          content_chars: assistantContent.length,
        });

        return { message: assistantMessage, parsed: parsedResponse };
      } catch (error) {
        logger.error("mythic.dm.send.failed", error, {
          campaign_id: campaignId,
          action_trace_id: actionTraceId,
        });
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
