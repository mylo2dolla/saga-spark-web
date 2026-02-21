import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunctionRaw } from "@/lib/edge";
import { parseEdgeError } from "@/lib/edgeError";
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
  panel?: "status" | "character" | "loadout" | "loadouts" | "gear" | "equipment" | "skills" | "progression" | "quests" | "combat" | "companions" | "shop" | "commands" | "settings";
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
  suppressErrorToast?: boolean;
  abortPrevious?: boolean;
}

export type MythicDmErrorKind =
  | "timeout"
  | "turn_conflict"
  | "turn_commit_failed"
  | "validation_recovery"
  | "network"
  | "unknown";

export interface MythicDmErrorInfo {
  kind: MythicDmErrorKind;
  message: string;
  code: string | null;
  requestId: string | null;
}

export interface MythicDmLastResponseMeta {
  requestId: string | null;
  validationAttempts: number | null;
  recoveryUsed: boolean;
  recoveryReason: string | null;
}

export type MythicDmPhase = "assembling_context" | "resolving_narration" | "committing_turn";

const MAX_HISTORY_MESSAGES = 16;
const MAX_MESSAGE_CONTENT = 1800;
const DEFAULT_DM_TIMEOUT_MS = 95_000;
const LOW_SIGNAL_ACTION_LABEL = /^(action\s+\d+|narrative\s+update)$/i;
const LOW_SIGNAL_ACTION_TEXT = /^(continue|proceed|next(\s+step|\s+move)?|press\s+on|advance|do\s+that|do\s+this|work\s+a\s+lead|refresh(\s+state)?|check\s+status)$/i;
const LOW_SIGNAL_ACTION_PROMPT = /^(continue|proceed|advance|refresh|narrate|describe)(\b|[\s.,])/i;

const trimMessage = (content: string) =>
  content.length <= MAX_MESSAGE_CONTENT ? content : `${content.slice(0, MAX_MESSAGE_CONTENT)}...`;

const logger = createLogger("mythic-dm-hook");

function dedupeUiActions(actions: MythicUiAction[], maxActions = 8): MythicUiAction[] {
  const seen = new Set<string>();
  const out: MythicUiAction[] = [];
  for (const entry of actions) {
    const labelKey = entry.label.trim().toLowerCase().replace(/\s+/g, " ");
    const promptKey = (entry.prompt ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const key = `${entry.intent}:${entry.hint_key ?? ""}:${labelKey}:${promptKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= maxActions) break;
  }
  return out;
}

function isLowSignalActionLabel(value: string): boolean {
  return LOW_SIGNAL_ACTION_LABEL.test(value.trim());
}

function isLowSignalPrompt(value: string): boolean {
  const clean = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!clean) return true;
  if (clean.length < 18 && /^(continue|proceed|advance|next|narrate|describe)/.test(clean)) return true;
  if (/^(continue|proceed|advance|next (step|move)|narrate what happens|describe what happens)$/.test(clean)) return true;
  if (LOW_SIGNAL_ACTION_PROMPT.test(clean) && clean.length < 48) return true;
  return false;
}

function isLowSignalAction(entry: MythicUiAction): boolean {
  const label = entry.label.trim();
  if (!label || isLowSignalActionLabel(label) || LOW_SIGNAL_ACTION_TEXT.test(label)) return true;
  if (entry.intent === "dm_prompt") {
    const prompt = entry.prompt ?? "";
    if (isLowSignalPrompt(prompt)) return true;
  }
  return false;
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
  if (intent === "companion_action") return "Companion Follow-Up";
  if (intent === "open_panel") return "Open Panel";
  if (intent === "dm_prompt") return "Press The Lead";
  if (intent === "focus_target") return "Focus Target";
  if (intent === "refresh") return "Recheck Board State";
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
  if (key === "open_panel" || key === "panel" || key === "open_menu") return "open_panel";
  if (key === "loadout_action" || key === "gear" || key === "loadout") return "open_panel";
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
  const panel = panelRaw === "status" || panelRaw === "character" || panelRaw === "loadout" || panelRaw === "loadouts" || panelRaw === "gear" || panelRaw === "equipment" || panelRaw === "skills" || panelRaw === "progression" || panelRaw === "quests" || panelRaw === "combat" || panelRaw === "companions" || panelRaw === "shop" || panelRaw === "commands" || panelRaw === "settings"
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
  if (/(inventory|gear|equipment|loadout|skill|skills|progression|quest|character|profile|sheet)/.test(lower)) {
    const panel: MythicUiAction["panel"] =
      /character|profile|sheet/.test(lower)
        ? "character"
        : /gear|equipment|inventory/.test(lower)
          ? "equipment"
          : /loadout/.test(lower)
            ? "skills"
            : /skill/.test(lower)
              ? "skills"
              : /progression|level/.test(lower)
                ? "progression"
                : /quest/.test(lower)
                  ? "quests"
                  : "status";
    return {
      id: `mythic-panel-${index + 1}`,
      label,
      intent: "open_panel",
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

function buildDeterministicFallbackAction(args: {
  narration: string;
  scene?: Record<string, unknown>;
}): MythicUiAction {
  const scene = args.scene ?? {};
  const focus = typeof scene.focus === "string" && scene.focus.trim().length > 0
    ? scene.focus.trim()
    : typeof scene.travel_goal === "string" && scene.travel_goal.trim().length > 0
      ? scene.travel_goal.trim()
      : "";
  const label = focus
    ? compactLabel(`Press ${focus}`, 52)
    : "Press Tactical Lead";
  const prompt = focus
    ? `I press ${focus} and commit the next concrete step from board state.`
    : `I press the strongest tactical lead from this state: ${compactLabel(args.narration, 120)}`;
  return {
    id: "mythic-fallback-1",
    label,
    intent: "dm_prompt",
    prompt,
  };
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
        const sanitizedActions = actions.length > 0
          ? dedupeUiActions(actions.filter((entry) => !isLowSignalAction(entry)))
          : [];
        const uiActions = sanitizedActions.length > 0
          ? sanitizedActions
          : [buildDeterministicFallbackAction({ narration, scene })];
        return {
          narration,
          ui_actions: uiActions,
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
    .filter((entry) => !isLowSignalAction(entry))
    .slice(0, 8);
  return {
    narration: trimmed || "The scene shifts. Describe your next move.",
    ui_actions: fallbackActions.length > 0
      ? dedupeUiActions(fallbackActions, 6)
      : [buildDeterministicFallbackAction({ narration: trimmed || "The scene shifts." })],
  };
}

function classifyDmError(message: string, code: string | null): MythicDmErrorKind {
  const normalized = message.toLowerCase();
  if (code === "turn_conflict") return "turn_conflict";
  if (code === "turn_commit_failed") return "turn_commit_failed";
  if (code === "validation_recovery" || normalized.includes("validation_recovery")) return "validation_recovery";
  if (normalized.includes("timed out") || normalized.includes("timeout") || normalized.includes("upstream_timeout")) return "timeout";
  if (normalized.includes("failed to fetch") || normalized.includes("network") || normalized.includes("unreachable")) return "network";
  return "unknown";
}

export function useMythicDungeonMaster(campaignId: string | undefined) {
  const [messages, setMessages] = useState<MythicDMMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentResponse, setCurrentResponse] = useState("");
  const [phase, setPhase] = useState<MythicDmPhase | null>(null);
  const [operation, setOperation] = useState<OperationState | null>(null);
  const [lastError, setLastError] = useState<MythicDmErrorInfo | null>(null);
  const [lastResponseMeta, setLastResponseMeta] = useState<MythicDmLastResponseMeta | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const activeSeqRef = useRef(0);

  const sendMessage = useCallback(
    async (content: string, options?: SendOptions) => {
      if (!campaignId) throw new Error("Missing campaignId");
      const requestSeq = requestSeqRef.current + 1;
      requestSeqRef.current = requestSeq;
      activeSeqRef.current = requestSeq;

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

      const shouldAbortPrevious = options?.abortPrevious !== false;
      if (shouldAbortPrevious) {
        abortRef.current?.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const phaseTimers: number[] = [];
      const clearPhaseTimers = () => {
        while (phaseTimers.length > 0) {
          const timer = phaseTimers.pop();
          if (typeof timer === "number" && typeof window !== "undefined") {
            window.clearTimeout(timer);
          }
        }
      };
      const schedulePhase = (nextPhase: MythicDmPhase, delayMs: number) => {
        if (typeof window === "undefined") return;
        const timer = window.setTimeout(() => {
          if (requestSeq !== activeSeqRef.current) return;
          if (controller.signal.aborted) return;
          setPhase((prev) => {
            if (prev === "committing_turn") return prev;
            return nextPhase;
          });
        }, delayMs);
        phaseTimers.push(timer);
      };
      setIsLoading(true);
      setCurrentResponse("");
      setOperation(null);
      setLastError(null);
      setPhase("assembling_context");
      schedulePhase("resolving_narration", 1_200);
      schedulePhase("committing_turn", 5_800);

      let assistantContent = "";
      try {
        const { result: response } = await runOperation({
          name: "mythic.dm.send",
          signal: controller.signal,
          timeoutMs: Math.max(30_000, Math.min(120_000, options?.timeoutMs ?? DEFAULT_DM_TIMEOUT_MS)),
          maxRetries: 0,
          onUpdate: (next) => {
            if (requestSeq !== activeSeqRef.current) return;
            setOperation(next);
          },
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
          const requestId = response.headers.get("x-request-id")
            ?? (typeof errorData.requestId === "string" ? errorData.requestId : null);
          const withCode = code ? `${baseMessage} [${code}]` : baseMessage;
          throw new Error(requestId ? `${withCode} (requestId: ${requestId})` : withCode);
        }

        if (!response.body) throw new Error("No response body");
        const requestId = response.headers.get("x-request-id");
        if (requestSeq === activeSeqRef.current) {
          setPhase("resolving_narration");
        }

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
                if (requestSeq === activeSeqRef.current) {
                  setCurrentResponse(assistantContent);
                }
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

        if (requestSeq === activeSeqRef.current) {
          setPhase("committing_turn");
          setMessages((prev) => [...prev, assistantMessage]);
          setCurrentResponse("");
          setLastResponseMeta({
            requestId,
            validationAttempts: Number.isFinite(Number(parsedResponse?.meta?.dm_validation_attempts))
              ? Number(parsedResponse?.meta?.dm_validation_attempts)
              : null,
            recoveryUsed: parsedResponse?.meta?.dm_recovery_used === true,
            recoveryReason: typeof parsedResponse?.meta?.dm_recovery_reason === "string"
              ? parsedResponse.meta.dm_recovery_reason
              : null,
          });
        } else {
          logger.info("mythic.dm.send.stale_ignored", {
            campaign_id: campaignId,
            action_trace_id: actionTraceId,
            request_seq: requestSeq,
          });
        }
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
        const message = error instanceof Error ? error.message : "Failed to reach Mythic DM";
        const normalized = message.toLowerCase();
        const isExpectedCancel = normalized.includes("cancelled") || normalized.includes("aborted");
        if (requestSeq === activeSeqRef.current && !isExpectedCancel) {
          const parsed = parseEdgeError(error, "Failed to reach Mythic DM");
          setLastError({
            kind: classifyDmError(parsed.message, parsed.code),
            message: parsed.message,
            code: parsed.code,
            requestId: parsed.requestId,
          });
        }
        if (!options?.suppressErrorToast && !isExpectedCancel) {
          toast.error(message);
        }
        if (requestSeq === activeSeqRef.current) {
          setCurrentResponse("");
          setPhase(null);
        }
        throw error;
      } finally {
        clearPhaseTimers();
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
        if (requestSeq === activeSeqRef.current) {
          setIsLoading(false);
          setPhase(null);
        }
      }
    },
    [campaignId, messages],
  );

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setCurrentResponse("");
    setLastError(null);
    setLastResponseMeta(null);
    setPhase(null);
  }, []);

  const cancelMessage = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return {
    messages,
    isLoading,
    currentResponse,
    phase,
    operation,
    lastError,
    lastResponseMeta,
    sendMessage,
    clearMessages,
    cancelMessage,
  };
}
