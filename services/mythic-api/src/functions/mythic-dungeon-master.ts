import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { assertCampaignAccess } from "../shared/authz.js";
import { mythicOpenAIChatCompletionsStream } from "../shared/ai_provider.js";
import {
  enforceRateLimit,
  getIdempotentResponse,
  idempotencyKeyFromRequest,
  storeIdempotentResponse,
} from "../shared/request_guard.js";
import { sanitizeError } from "../shared/redact.js";
import { computeTurnSeed } from "../shared/turn_seed.js";
import { createTurnPrng } from "../shared/turn_prng.js";
import { pickLootRarity, rarityBudget, rollLootItem } from "../shared/loot_roll.js";
import {
  normalizeWorldPatches,
  parseDmNarratorOutput,
  type DmNarratorOutput,
} from "../shared/turn_contract.js";
import { getConfig } from "../shared/env.js";
import {
  coerceCampaignContextFromProfile,
  summarizeWorldContext,
  WORLD_FORGE_VERSION,
} from "../lib/worldforge/index.js";
import {
  BANNED_PLAYER_PHRASES,
  buildBoardNarration,
  buildNarrativeLinesFromEvents,
  buildReputationTitle,
  hashLine,
  selectToneMode,
  toneSeedLine,
  type EnemyPersonalityTraits,
  type PresentationState,
  type ToneMode,
} from "../lib/presentation/index.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().max(8000),
});

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  messages: z.array(MessageSchema).max(80),
  actionContext: z.record(z.unknown()).nullable().optional(),
});

const config = getConfig();

function errMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim().length > 0) return msg;
  }
  return fallback;
}

function errCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.trim().length > 0) return code;
  }
  return null;
}

function errDetails(error: unknown): unknown {
  if (error && typeof error === "object") {
    const payload = error as Record<string, unknown>;
    const details = payload.details ?? payload.hint ?? null;
    return details;
  }
  return null;
}

function errStatus(error: unknown): number | null {
  if (error && typeof error === "object" && "status" in error) {
    const value = Number((error as { status?: unknown }).status);
    if (Number.isFinite(value) && value >= 400 && value <= 599) return value;
  }
  return null;
}

function jsonOnlyContract() {
  return `
OUTPUT CONTRACT (STRICT)
- Respond with ONE JSON object ONLY. No markdown. No backticks. No prose outside JSON.
- Your JSON must include: {"narration": string, "scene": object, "runtime_delta": object, "ui_actions": array}.
- "scene" must include board-synced hints when applicable: "environment", "mood", "focus", "travel_goal".
- "runtime_delta" must be an object containing only supported keys:
  - rumors: array
  - objectives: array
  - discovery_log: array
  - discovery_flags: object
  - scene_cache: object
  - companion_checkins: array of { companion_id, line, mood, urgency, hook_type }
  - action_chips: array of action chip objects (same shape as ui_actions)
  - reward_hints: array of { key, detail?, weight? } for deterministic micro-reward scoring
- "ui_actions" must contain 2-4 concrete intent suggestions for the current board state.
  Action labels must start with a strong verb and a concrete object (target, room, route, vendor, gate).
  Each action item must be an object with:
  - id (string), label (string), intent (enum), optional hint_key (string), optional prompt (string), optional payload (object).
  - intent must be one of: quest_action, combat_start, combat_action, shop_action, open_panel, companion_action, dm_prompt, refresh.
  When suggesting a shop/vendor in town:
  - intent MUST be "shop_action"
  - payload MUST include {"vendorId": "<id from board.state_summary.vendors>"}.
- Optional:
  - "effects": object with optional ambient/comic effect hints.
  - "patches": array of world patch objects (may be empty). Supported patch ops:
    - FACT_CREATE / FACT_SUPERSEDE (fact_key, data)
    - ENTITY_UPSERT (entity_key, entity_type, data, tags[])
    - REL_SET (subject_key, object_key, rel_type, data)
    - QUEST_UPSERT (quest_key, data)
    - LOCATION_STATE_UPDATE (location_key, data)
  - "roll_log": array of deterministic roll log entries (may be empty).
- Optional keys: npcs, suggestions, loot, persistentData.
- Allowed: gore/violence/profanity, mild sexuality and playful sexy banter.
- Forbidden: sexual violence, coercion, rape, underage sexual content, pornographic explicit content.
- Harsh language allowed. Gore allowed.
`;
}

const MAX_TEXT_FIELD_LEN = 900;
const NARRATION_MIN_WORDS = 52;
const NARRATION_MAX_WORDS = 110;
const DM_IDEMPOTENCY_TTL_MS = 20_000;
const MAX_PROMPT_MESSAGES = 8;
const MAX_PROMPT_MESSAGE_CHARS = 420;
const GENERIC_ACTION_LABEL_RX = /^(action\s+\d+|narrative\s+update|fallback\s+action|default\s+action)$/i;
const LOW_SIGNAL_ACTION_LABEL_RX = /^(continue|proceed|advance|next(\s+(step|move))?|do\s+(that|this)|refresh(\s+state)?|check\s+status)$/i;
const LOW_SIGNAL_ACTION_PROMPT_RX = /^(continue|proceed|advance|refresh|narrate|describe)(\b|[\s.,])/i;
const DM_STYLE_PROFILE = {
  id: "dark_tactical_with_bite.v1",
  tone: "dark tactical with bite",
  directives: [
    "Voice is sharp, predatory, and immediate. Every line should imply consequence.",
    "Narrate in second-person pressure with mythic noir edge, not sterile summary.",
    "Use concrete board nouns (gate, segment, room, target, flank) instead of abstract filler.",
    "Keep momentum brutal and compact. No sterile recap language.",
    "Favor active verbs and tactical stakes over exposition.",
    "Use dark wit when it helps pressure and clarity, never fluff.",
    "End on a tactical hook, never a generic filler close.",
  ],
} as const;

type NarratorUiAction = NonNullable<DmNarratorOutput["ui_actions"]>[number];
const NON_PLAYER_NARRATION_PATTERNS: RegExp[] = [
  /\bcommand:unknown\b/gi,
  /\bopening move\b/gi,
  /\bthe\s+[a-z ]*board answers with hard state, not fog:[^.]*\.?/gi,
  /\b(board already committed|committed the pressure lines)[^.]*\.?/gi,
  /\bcommit one decisive move and keep pressure on the nearest fault line\.?/gi,
  /\bcampaign_intro_opening_[a-z0-9_]*\b/gi,
  /\bresolved\s+\d+\s+non-player turn steps\b/gi,
];

const BANNED_PLAYER_FRAGMENT_PATTERNS: RegExp[] = BANNED_PLAYER_PHRASES.map((phrase) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\s+/g, "\\s+");
  return new RegExp(escaped, "gi");
});

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function compactNarration(text: string, maxWords = NARRATION_MAX_WORDS): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text.trim();
  const sliced = words.slice(0, maxWords).join(" ").trim();
  return `${sliced}...`;
}

function sanitizeNarrationForPlayer(text: string, boardType: string): string {
  const normalizedBoard = boardType.trim().toLowerCase();
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const sanitizedLines = lines
    .filter((line) => !/^\s*resolved\s+\d+\s+non-player turn steps\b/i.test(line))
    .map((line) => {
      let clean = line
        .replace(/\bcampaign_[a-z0-9_]+\b/gi, "")
        .replace(/\b[a-z0-9]+(?:_[a-z0-9]+){2,}_v\d+\b/gi, "")
        .replace(/\bA combatant\b/gi, "A fighter")
        .replace(/\btags?\s+the\s+line\b/gi, "presses the line");
      for (const pattern of NON_PLAYER_NARRATION_PATTERNS) {
        clean = clean.replace(pattern, " ");
      }
      for (const pattern of BANNED_PLAYER_FRAGMENT_PATTERNS) {
        clean = clean.replace(pattern, " ");
      }
      return clean.replace(/\s+/g, " ").trim();
    })
    .filter((line) => line.length > 0);
  const joined = sanitizedLines.join(" ");
  if (!joined) {
    return normalizedBoard === "combat"
      ? "Steel and spellfire collide. Pick a target and force the next exchange."
      : "Tension coils around you. Choose the next move and press it.";
  }
  return joined;
}

function readPresentationState(boardState: Record<string, unknown> | null): PresentationState {
  const row = asObject(boardState?.dm_presentation);
  const lineHashes = Array.isArray(row?.recent_line_hashes)
    ? row.recent_line_hashes
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0)
      .slice(-16)
    : [];
  const verbKeys = Array.isArray(row?.last_verb_keys)
    ? row.last_verb_keys
      .map((entry) => String(entry).trim().toLowerCase())
      .filter((entry) => entry.length > 0)
      .slice(-12)
    : [];
  const lastTone = asToneMode(row?.last_tone);
  const lastOpenerId = typeof row?.last_board_opener_id === "string" ? row.last_board_opener_id : null;
  const templateIds = Array.isArray(row?.last_template_ids)
    ? row.last_template_ids
      .map((entry) => String(entry).trim())
      .filter((entry) => entry.length > 0)
      .slice(-12)
    : [];
  const lastEventCursor = typeof row?.last_event_cursor === "string" && row.last_event_cursor.trim().length > 0
    ? row.last_event_cursor.trim()
    : null;
  return {
    last_tone: lastTone,
    last_board_opener_id: lastOpenerId,
    recent_line_hashes: lineHashes,
    last_verb_keys: verbKeys,
    last_template_ids: templateIds,
    last_event_cursor: lastEventCursor,
  };
}

function mergePresentationState(
  current: PresentationState,
  next: Partial<PresentationState>,
): PresentationState {
  const lineHashes = [
    ...(current.recent_line_hashes ?? []),
    ...(next.recent_line_hashes ?? []),
  ]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(-16);
  const verbKeys = [
    ...(current.last_verb_keys ?? []),
    ...(next.last_verb_keys ?? []),
  ]
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
    .slice(-12);
  const templateIds = [
    ...(current.last_template_ids ?? []),
    ...(next.last_template_ids ?? []),
  ]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(-12);
  return {
    last_tone: next.last_tone ?? current.last_tone ?? null,
    last_board_opener_id: next.last_board_opener_id ?? current.last_board_opener_id ?? null,
    recent_line_hashes: lineHashes,
    last_verb_keys: verbKeys,
    last_template_ids: templateIds,
    last_event_cursor: next.last_event_cursor ?? current.last_event_cursor ?? null,
  };
}

function parseEventCursor(value: unknown): { turnIndex: number; eventId: string; createdAt: string } | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  if (!clean) return null;
  const firstSep = clean.indexOf(":");
  if (firstSep <= 0) return null;
  const secondSep = clean.indexOf(":", firstSep + 1);
  if (secondSep <= firstSep + 1) return null;
  const turnRaw = clean.slice(0, firstSep);
  const eventIdRaw = clean.slice(firstSep + 1, secondSep);
  const createdAtRaw = clean.slice(secondSep + 1);
  const turnIndex = Number(turnRaw);
  if (!Number.isFinite(turnIndex)) return null;
  const eventId = eventIdRaw.trim();
  if (!eventId) return null;
  return {
    turnIndex: Math.floor(turnIndex),
    eventId,
    createdAt: createdAtRaw.trim(),
  };
}

function eventCursorForBatchEvent(entry: Record<string, unknown>): { turnIndex: number; eventId: string; createdAt: string } | null {
  const eventId = typeof entry.id === "string" && entry.id.trim().length > 0 ? entry.id.trim() : "";
  const turnIndex = Number(entry.turn_index);
  const createdAt = typeof entry.created_at === "string" ? entry.created_at.trim() : "";
  if (!eventId || !Number.isFinite(turnIndex)) return null;
  return {
    turnIndex: Math.floor(turnIndex),
    eventId,
    createdAt,
  };
}

function isBatchEventAfterCursor(
  entry: Record<string, unknown>,
  cursor: { turnIndex: number; eventId: string; createdAt: string } | null,
): boolean {
  if (!cursor) return true;
  const eventCursor = eventCursorForBatchEvent(entry);
  if (!eventCursor) return false;
  if (eventCursor.turnIndex > cursor.turnIndex) return true;
  if (eventCursor.turnIndex < cursor.turnIndex) return false;
  if (eventCursor.createdAt && cursor.createdAt) {
    if (eventCursor.createdAt > cursor.createdAt) return true;
    if (eventCursor.createdAt < cursor.createdAt) return false;
    // Same timestamp and turn: avoid replaying stale events.
    return eventCursor.eventId > cursor.eventId;
  }
  if (!eventCursor.createdAt && cursor.createdAt) return false;
  if (eventCursor.createdAt && !cursor.createdAt) return true;
  return eventCursor.eventId > cursor.eventId;
}

type CombatantStateHint = {
  id: string;
  is_alive: boolean;
  hp: number;
};

function readCombatantStateHint(value: unknown): Record<string, CombatantStateHint> {
  const entries = Array.isArray(value) ? value : [];
  const out: Record<string, CombatantStateHint> = {};
  for (const entry of entries) {
    const row = asObject(entry);
    const id = typeof row?.id === "string" && row.id.trim().length > 0 ? row.id.trim() : null;
    if (!id) continue;
    const hp = Number(row?.hp);
    const alive = row?.is_alive === true && Number.isFinite(hp) ? hp > 0 : row?.is_alive === true;
    out[id] = {
      id,
      is_alive: alive,
      hp: Number.isFinite(hp) ? Math.floor(hp) : 0,
    };
  }
  return out;
}

function buildIntroRecoveryNarration(args: {
  boardType: string;
  recoveryPressure: string;
  recoveryBeat: string;
  boardAnchor: string;
  summaryObjective: string | null;
  summaryRumor: string | null;
}): string {
  const introHook = args.summaryObjective
    ? `First leverage is clear: ${args.summaryObjective}.`
    : args.summaryRumor
      ? `A live rumor is already moving: ${args.summaryRumor}.`
      : `The first hinge is visible: ${args.boardAnchor}.`;
  if (args.boardType === "town") {
    return [args.recoveryPressure, introHook, args.recoveryBeat].join(" ");
  }
  if (args.boardType === "travel") {
    return [args.recoveryPressure, introHook, "Pick a lane and move before the route closes."].join(" ");
  }
  if (args.boardType === "dungeon") {
    return [args.recoveryPressure, introHook, "Pick a room edge and force a result."].join(" ");
  }
  return [args.recoveryPressure, introHook, args.recoveryBeat].join(" ");
}

function compactPromptMessage(content: string): string {
  const clean = content.trim().replace(/\s+/g, " ");
  if (clean.length <= MAX_PROMPT_MESSAGE_CHARS) return clean;
  return `${clean.slice(0, MAX_PROMPT_MESSAGE_CHARS).trim()}...`;
}

function summarizeAssistantTurnForPrompt(content: string): string {
  const parsed = parseDmNarratorOutput(content);
  if (!parsed.ok) return compactPromptMessage(content);

  const value = parsed.value;
  const scene = asObject(value.scene);
  const focus = typeof scene?.focus === "string" ? compactLabel(scene.focus, 64) : null;
  const mood = typeof scene?.mood === "string" ? compactLabel(scene.mood, 48) : null;
  const actions = Array.isArray(value.ui_actions)
    ? value.ui_actions
      .slice(0, 2)
      .map((entry) => compactLabel(`${entry.label}(${entry.intent})`, 52))
      .filter((entry) => entry.length > 0)
    : [];

  const narration = compactPromptMessage(value.narration);
  const chunks = [
    `Narration: ${narration}`,
    focus ? `Focus: ${focus}` : null,
    mood ? `Mood: ${mood}` : null,
    actions.length > 0 ? `Actions: ${actions.join(" | ")}` : null,
  ].filter((entry): entry is string => Boolean(entry));
  return compactPromptMessage(chunks.join(" || "));
}

function compactModelMessages(messages: Array<{ role: "user" | "assistant" | "system"; content: string }>) {
  return messages
    .filter((entry) => entry.role !== "system")
    .slice(-MAX_PROMPT_MESSAGES)
    .map((entry) => ({
      role: entry.role,
      content: entry.role === "assistant"
        ? summarizeAssistantTurnForPrompt(entry.content)
        : compactPromptMessage(entry.content),
    }));
}

function jsonInline(value: unknown, maxLen = 2600): string {
  try {
    const text = JSON.stringify(value);
    if (!text) return "null";
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}...<truncated>`;
  } catch {
    return "\"<unserializable>\"";
  }
}

function styleProfilePrompt(): string {
  return [
    `VOICE PROFILE (${DM_STYLE_PROFILE.id})`,
    `- Tone: ${DM_STYLE_PROFILE.tone}.`,
    ...DM_STYLE_PROFILE.directives.map((entry) => `- ${entry}`),
  ].join("\n");
}

function titleCaseWords(input: string): string {
  return input
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function remapLegacyPanel(panelRaw: unknown): Exclude<NarratorUiAction["panel"], undefined> {
  const panel = typeof panelRaw === "string" ? panelRaw.trim().toLowerCase() : "";
  if (!panel) return "skills";
  if (panel === "character") return "character";
  if (panel === "loadout" || panel === "loadouts") return "skills";
  if (panel === "gear") return "equipment";
  if (
    panel === "status"
    || panel === "skills"
    || panel === "equipment"
    || panel === "progression"
    || panel === "quests"
    || panel === "combat"
    || panel === "companions"
    || panel === "shop"
    || panel === "commands"
    || panel === "settings"
  ) {
    return panel as Exclude<NarratorUiAction["panel"], undefined>;
  }
  return "skills";
}

function compactLabel(text: string, maxLen = 80): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (!clean) return "";
  return clean.length > maxLen ? `${clean.slice(0, maxLen).trim()}...` : clean;
}

function isGenericActionLabel(value: string): boolean {
  return GENERIC_ACTION_LABEL_RX.test(value.trim());
}

function isLowSignalActionLabel(value: string): boolean {
  return LOW_SIGNAL_ACTION_LABEL_RX.test(value.trim());
}

function isLowSignalActionPrompt(value: string): boolean {
  const clean = value.trim();
  if (!clean) return true;
  if (clean.length < 24 && LOW_SIGNAL_ACTION_PROMPT_RX.test(clean)) return true;
  return LOW_SIGNAL_ACTION_PROMPT_RX.test(clean) && clean.length < 48;
}

function canonicalIntent(value: string): NarratorUiAction["intent"] {
  const key = value.trim().toLowerCase();
  if (
    key === "quest_action" ||
    key === "combat_start" ||
    key === "combat_action" ||
    key === "shop_action" ||
    key === "open_panel" ||
    key === "companion_action" ||
    key === "dm_prompt" ||
    key === "refresh"
  ) {
    return key;
  }
  if (key === "combat" || key === "fight" || key === "battle" || key === "engage" || key === "combat_begin") return "combat_start";
  if (key === "focus_target" || key === "attack" || key === "use_skill") return "combat_action";
  if (key === "panel" || key === "open_menu" || key === "open_panel" || key === "loadout" || key === "loadout_action" || key === "gear") return "open_panel";
  if (key === "shop" || key === "vendor") return "shop_action";
  if (key === "companion") return "companion_action";
  if (key === "prompt" || key === "narrate") return "dm_prompt";
  if (
    key === "board_transition_town" ||
    key === "return_town" ||
    key === "board_transition_dungeon" ||
    key === "enter_dungeon" ||
    key === "board_transition_travel" ||
    key === "transition" ||
    key === "board_transition" ||
    key === "town" ||
    key === "travel" ||
    key === "dungeon" ||
    key === "quest"
  ) {
    return "quest_action";
  }
  return "dm_prompt";
}

function boardTargetForIntent(intent: NarratorUiAction["intent"]): NarratorUiAction["boardTarget"] | undefined {
  if (intent === "combat_start") return "combat";
  return undefined;
}

function extractVendorsFromBoardSummary(boardSummary: Record<string, unknown> | null): Array<{ id: string; name: string }> {
  const raw = boardSummary && Array.isArray(boardSummary.vendors) ? boardSummary.vendors : [];
  return raw
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const id = typeof row.id === "string" && row.id.trim().length > 0 ? row.id.trim() : `vendor_${index + 1}`;
      const name = typeof row.name === "string" && row.name.trim().length > 0 ? row.name.trim() : `Vendor ${index + 1}`;
      return { id, name };
    })
    .filter((entry): entry is { id: string; name: string } => Boolean(entry));
}

function repairActionLabel(args: {
  action: NarratorUiAction;
  intent: NarratorUiAction["intent"];
  boardType: string;
  boardSummary: Record<string, unknown> | null;
  index: number;
}): string {
  const rawLabel = typeof args.action.label === "string" ? compactLabel(args.action.label) : "";
  if (rawLabel && !isGenericActionLabel(rawLabel)) return rawLabel;

  const promptLabel = typeof args.action.prompt === "string" ? compactLabel(args.action.prompt, 56) : "";
  if (promptLabel && !isGenericActionLabel(promptLabel)) return promptLabel;

  if (args.intent === "shop_action") {
    const vendors = extractVendorsFromBoardSummary(args.boardSummary);
    const payloadVendorId = typeof (args.action.payload as Record<string, unknown> | undefined)?.vendorId === "string"
      ? String((args.action.payload as Record<string, unknown>).vendorId)
      : null;
    const vendorName = payloadVendorId
      ? vendors.find((entry) => entry.id === payloadVendorId)?.name ?? null
      : vendors[0]?.name ?? null;
    return vendorName ? `Check ${vendorName}` : "Check Vendor Stock";
  }

  if (args.intent === "open_panel") {
    const panel = remapLegacyPanel(args.action.panel);
    return `Open ${titleCaseWords(panel)}`;
  }
  if (args.intent === "combat_action") {
    const target = typeof (args.action.payload as Record<string, unknown> | undefined)?.target_combatant_id === "string"
      ? String((args.action.payload as Record<string, unknown>).target_combatant_id)
      : "Target";
    return `Focus ${target}`;
  }
  if (args.intent === "combat_start") return "Start Combat";
  if (args.intent === "refresh") return `Recheck ${titleCaseWords(args.boardType)} State`;
  if (args.intent === "quest_action") {
    const payload = args.action.payload && typeof args.action.payload === "object"
      ? args.action.payload as Record<string, unknown>
      : {};
    const mode = typeof payload.mode === "string" ? payload.mode : args.action.boardTarget ?? null;
    if (mode === "town") return "Head To Town";
    if (mode === "travel") return "Push The Route";
    if (mode === "dungeon") return "Enter The Dungeon";
    return "Advance Quest";
  }
  if (args.intent === "companion_action") return "Follow Companion";

  const anchor = typeof args.boardSummary?.travel_goal === "string"
    ? args.boardSummary.travel_goal
    : typeof args.boardSummary?.search_target === "string"
      ? args.boardSummary.search_target
      : args.boardType;
  return `Press ${titleCaseWords(String(anchor || `Scene ${args.index + 1}`))}`;
}

function stableHintKey(args: {
  hintKeyRaw: unknown;
  intent: NarratorUiAction["intent"];
  label: string;
  payload: Record<string, unknown> | undefined;
  index: number;
}): string {
  if (typeof args.hintKeyRaw === "string" && args.hintKeyRaw.trim().length > 0) {
    return args.hintKeyRaw.trim().slice(0, 120);
  }
  const payload = args.payload ?? {};
  const target = typeof payload.target_combatant_id === "string"
    ? payload.target_combatant_id
    : typeof payload.vendorId === "string"
      ? payload.vendorId
      : typeof payload.room_id === "string"
        ? payload.room_id
        : typeof payload.to_room_id === "string"
          ? payload.to_room_id
          : typeof payload.search_target === "string"
            ? payload.search_target
            : compactLabel(args.label, 32).toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const key = `${args.intent}:${String(target || args.index + 1)}`;
  return key.slice(0, 120);
}

function synthesizeActionPrompt(action: NarratorUiAction, boardType: string): string {
  if (action.prompt && action.prompt.trim().length > 0) return action.prompt.trim();
  if (action.intent === "open_panel") return `I open the ${remapLegacyPanel(action.panel)} panel and review the live state.`;
  if (action.intent === "shop_action") return "I check current vendor stock and prices before buying.";
  if (action.intent === "combat_start") return "I engage hostiles and begin combat now.";
  if (action.intent === "quest_action") {
    const payload = action.payload && typeof action.payload === "object" ? action.payload as Record<string, unknown> : {};
    const mode = typeof payload.mode === "string" ? payload.mode : action.boardTarget ?? null;
    if (mode === "town") return "I route back to town and reassess runtime hooks.";
    if (mode === "travel") return "I travel onward and pressure the next objective.";
    if (mode === "dungeon") return "I descend into the dungeon and clear the first threat angle.";
    return "I advance the active quest from committed runtime state.";
  }
  if (action.intent === "combat_action") return "I focus that target and prepare the next strike.";
  if (action.intent === "companion_action") return "I follow companion guidance and request the next concrete step.";
  if (action.intent === "refresh") {
    return boardType === "combat"
      ? "Recheck turn order, target pressure, and immediate combat deltas from committed state."
      : `Recheck ${boardType} hooks and summarize only what changed in committed runtime state.`;
  }
  return boardType === "combat"
    ? `I commit to ${action.label.toLowerCase()} and want the result narrated from current combat events.`
    : `I commit to ${action.label.toLowerCase()} and want the result narrated from current board state.`;
}

function actionDedupeKey(action: NarratorUiAction): string {
  const payload = action.payload && typeof action.payload === "object" ? action.payload as Record<string, unknown> : null;
  const targetKey = typeof payload?.target_combatant_id === "string"
    ? payload.target_combatant_id
    : typeof payload?.vendorId === "string"
      ? payload.vendorId
      : typeof payload?.room_id === "string"
        ? payload.room_id
        : typeof payload?.to_room_id === "string"
          ? payload.to_room_id
          : typeof payload?.search_target === "string"
            ? payload.search_target
            : typeof action.panel === "string"
              ? action.panel
              : "none";
  const hint = typeof action.hint_key === "string" ? action.hint_key : "nohint";
  const label = compactLabel(action.label, 48).toLowerCase();
  return `${action.intent}:${hint}:${targetKey}:${label}`;
}

function shouldFilterLowSignalAction(action: NarratorUiAction): boolean {
  const label = action.label.trim();
  const prompt = typeof action.prompt === "string" ? action.prompt.trim() : "";
  if (isGenericActionLabel(label)) {
    return action.intent === "dm_prompt" || action.intent === "refresh";
  }
  if (action.intent === "dm_prompt" || action.intent === "refresh") {
    if (isLowSignalActionLabel(label)) return true;
    if (prompt && isLowSignalActionPrompt(prompt)) return true;
  }
  return false;
}

function sanitizeUiActions(args: {
  actions: NarratorUiAction[];
  boardType: string;
  boardSummary: Record<string, unknown> | null;
}): NarratorUiAction[] {
  const { actions, boardType, boardSummary } = args;
  const normalized = actions
    .slice(0, 6)
    .map((action, index) => {
      const actionRaw = action as NarratorUiAction & { board_target?: NarratorUiAction["boardTarget"]; hint_key?: string };
      const { board_target: boardTargetAlias, ...actionNoAlias } = actionRaw;
      let intent = canonicalIntent(String(action.intent ?? "dm_prompt"));
      if (boardType === "combat" && (intent === "quest_action" || intent === "combat_start")) {
        intent = "dm_prompt";
      }
      const label = repairActionLabel({
        action,
        intent,
        boardType,
        boardSummary,
        index,
      });
      const boardTarget = boardType === "combat"
        ? undefined
        : (action.boardTarget ?? boardTargetAlias ?? boardTargetForIntent(intent));
      const panel = intent === "open_panel" ? remapLegacyPanel(action.panel) : action.panel;
      const prompt = synthesizeActionPrompt({ ...action, intent, boardTarget, panel, label }, boardType);
      const payload = action.payload && typeof action.payload === "object" ? action.payload as Record<string, unknown> : undefined;
      return {
        ...actionNoAlias,
        id: typeof action.id === "string" && action.id.trim().length > 0 ? action.id.trim() : `dm-action-${index + 1}`,
        label,
        intent,
        hint_key: stableHintKey({
          hintKeyRaw: actionRaw.hint_key,
          intent,
          label,
          payload,
          index,
        }),
        boardTarget,
        panel,
        prompt,
        payload,
      };
    });

  const deduped: NarratorUiAction[] = [];
  const seen = new Set<string>();
  for (const action of normalized) {
    const key = actionDedupeKey(action);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(action);
    if (deduped.length >= 6) break;
  }

  const highSignal = deduped.filter((action) => !shouldFilterLowSignalAction(action));
  if (highSignal.length >= 2) return highSignal.slice(0, 6);
  return deduped.slice(0, 6);
}

function streamOpenAiDelta(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunkSize = 120;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        for (let i = 0; i < text.length; i += chunkSize) {
          const chunk = text.slice(i, i + chunkSize);
          const payload = {
            choices: [{ delta: { content: chunk } }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

async function readModelStreamText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let splitIndex = buffer.indexOf("\n");
    while (splitIndex >= 0) {
      const rawLine = buffer.slice(0, splitIndex).replace(/\r$/, "");
      buffer = buffer.slice(splitIndex + 1);
      if (!rawLine.startsWith("data:")) {
        splitIndex = buffer.indexOf("\n");
        continue;
      }
      const payload = rawLine.slice(5).trim();
      if (!payload || payload === "[DONE]") {
        splitIndex = buffer.indexOf("\n");
        continue;
      }
      try {
        const parsed = JSON.parse(payload) as Record<string, unknown>;
        const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
        const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : null;
        const delta = first && typeof first.delta === "object" ? first.delta as Record<string, unknown> : null;
        const message = first && typeof first.message === "object" ? first.message as Record<string, unknown> : null;
        if (typeof delta?.content === "string") {
          out += delta.content;
        } else if (typeof message?.content === "string") {
          out += message.content;
        }
      } catch {
        // Ignore malformed event fragments.
      }
      splitIndex = buffer.indexOf("\n");
    }
  }
  return out.trim();
}

function shortText(value: unknown, maxLen = MAX_TEXT_FIELD_LEN): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...<truncated>`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asToneMode(value: unknown): ToneMode | null {
  if (value !== "tactical" && value !== "mythic" && value !== "whimsical" && value !== "brutal" && value !== "minimalist") {
    return null;
  }
  return value;
}

function asNumberRecord(value: unknown): Record<string, number> {
  const row = asObject(value);
  if (!row) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(row)) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) continue;
    out[key] = parsed;
  }
  return out;
}

function sampleNarrativeEntries(value: unknown, maxItems = 4): unknown[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string" || (entry && typeof entry === "object"))
    .slice(0, maxItems)
    .map((entry) => {
      if (typeof entry === "string") return shortText(entry, 160);
      return entry;
    })
    .filter(Boolean) as unknown[];
}

function compactSkill(skill: Record<string, unknown>) {
  const effectsJson = skill.effects_json && typeof skill.effects_json === "object"
    ? skill.effects_json as Record<string, unknown>
    : null;
  const costJson = skill.cost_json && typeof skill.cost_json === "object"
    ? skill.cost_json as Record<string, unknown>
    : null;
  const targetingJson = skill.targeting_json && typeof skill.targeting_json === "object"
    ? skill.targeting_json as Record<string, unknown>
    : null;
  return {
    id: skill.id ?? null,
    name: skill.name ?? null,
    kind: skill.kind ?? null,
    targeting: skill.targeting ?? null,
    range_tiles: skill.range_tiles ?? null,
    cooldown_turns: skill.cooldown_turns ?? null,
    cost: costJson
      ? {
          resource_id: costJson.resource_id ?? null,
          amount: costJson.amount ?? null,
        }
      : null,
    effect_tags: Array.isArray(effectsJson?.tags) ? effectsJson?.tags : [],
    status_id: effectsJson && typeof effectsJson.status === "object"
      ? (effectsJson.status as Record<string, unknown>).id ?? null
      : null,
    target_shape: targetingJson?.shape ?? null,
    description: shortText(skill.description, 320),
  };
}

function summarizeBoardState(boardType: unknown, stateJson: unknown) {
  const safeType = typeof boardType === "string" ? boardType : "unknown";
  const raw = stateJson && typeof stateJson === "object" ? stateJson as Record<string, unknown> : {};
  const companionPresence = sampleNarrativeEntries(raw.companion_presence, 3);
  const companionCheckins = sampleNarrativeEntries(raw.companion_checkins, 3);
  if (safeType === "town") {
    const worldSeed =
      raw.world_seed && typeof raw.world_seed === "object"
        ? raw.world_seed as Record<string, unknown>
        : null;
    const vendorsRaw = Array.isArray(raw.vendors) ? raw.vendors : [];
    const vendors = vendorsRaw
      .slice(0, 6)
      .map((entry, index) => {
        if (!entry) return null;
        if (typeof entry === "string") {
          return { id: `vendor_${index + 1}`, name: entry.slice(0, 64), services: [] as string[] };
        }
        if (typeof entry !== "object") return null;
        const vendor = entry as Record<string, unknown>;
        const id = typeof vendor.id === "string" && vendor.id.trim().length > 0 ? vendor.id.trim() : `vendor_${index + 1}`;
        const name = typeof vendor.name === "string" && vendor.name.trim().length > 0 ? vendor.name.trim() : `Vendor ${index + 1}`;
        const services = Array.isArray(vendor.services)
          ? vendor.services.filter((svc): svc is string => typeof svc === "string").slice(0, 4)
          : [];
        return { id, name, services };
      })
      .filter((entry): entry is { id: string; name: string; services: string[] } => Boolean(entry));
    return {
      template_key: raw.template_key ?? null,
      world_title: worldSeed?.title ?? null,
      world_description: shortText(worldSeed?.description, 240),
      vendor_count: Array.isArray(raw.vendors) ? raw.vendors.length : 0,
      vendors,
      service_count: Array.isArray(raw.services) ? raw.services.length : 0,
      rumor_count: Array.isArray(raw.rumors) ? raw.rumors.length : 0,
      rumor_samples: sampleNarrativeEntries(raw.rumors, 4),
      objective_samples: sampleNarrativeEntries(raw.objectives, 4),
      faction_count: Array.isArray(raw.factions_present) ? raw.factions_present.length : 0,
      guard_alertness: raw.guard_alertness ?? null,
      companion_presence: companionPresence,
      companion_checkins: companionCheckins,
    };
  }
  if (safeType === "travel") {
    return {
      weather: raw.weather ?? null,
      hazard_meter: raw.hazard_meter ?? null,
      travel_goal: raw.travel_goal ?? null,
      search_target: raw.search_target ?? null,
      dungeon_traces_found: raw.dungeon_traces_found ?? null,
      discovery_flags: raw.discovery_flags ?? null,
      segment_count: Array.isArray(raw.route_segments) ? raw.route_segments.length : 0,
      encounter_seed_count: Array.isArray(raw.encounter_seeds) ? raw.encounter_seeds.length : 0,
      discovery_samples: sampleNarrativeEntries(raw.discovery_log, 4),
      companion_presence: companionPresence,
      companion_checkins: companionCheckins,
    };
  }
  if (safeType === "dungeon") {
    const roomGraph = raw.room_graph && typeof raw.room_graph === "object"
      ? raw.room_graph as Record<string, unknown>
      : null;
    return {
      room_count: Array.isArray(roomGraph?.rooms) ? roomGraph?.rooms.length : 0,
      room_samples: sampleNarrativeEntries(roomGraph?.rooms, 4),
      loot_nodes: raw.loot_nodes ?? null,
      trap_signals: raw.trap_signals ?? null,
      faction_presence_count: Array.isArray(raw.faction_presence) ? raw.faction_presence.length : 0,
      discovery_samples: sampleNarrativeEntries(raw.discovery_log, 4),
      companion_presence: companionPresence,
      companion_checkins: companionCheckins,
    };
  }
  if (safeType === "combat") {
    const grid = raw.grid && typeof raw.grid === "object" ? raw.grid as Record<string, unknown> : null;
    return {
      combat_session_id: raw.combat_session_id ?? null,
      grid_width: grid?.width ?? null,
      grid_height: grid?.height ?? null,
      blocked_tile_count: Array.isArray(raw.blocked_tiles) ? raw.blocked_tiles.length : 0,
      seed: raw.seed ?? null,
      scene_cache: raw.scene_cache ?? null,
      companion_checkins: companionCheckins,
    };
  }
  return {
    board_type: safeType,
  };
}

function compactCharacterPayload(character: unknown) {
  if (!character || typeof character !== "object") return character;
  const raw = character as Record<string, unknown>;
  const skillsRaw = Array.isArray(raw.skills) ? raw.skills : [];
  const compactSkills = skillsRaw
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .slice(0, 12)
    .map(compactSkill);
  const classJson = raw.class_json && typeof raw.class_json === "object"
    ? raw.class_json as Record<string, unknown>
    : null;
  const resources = raw.resources && typeof raw.resources === "object"
    ? raw.resources as Record<string, unknown>
    : null;
  const bars = Array.isArray(resources?.bars)
    ? resources?.bars
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .slice(0, 2)
      .map((bar) => ({
        id: bar.id ?? null,
        current: bar.current ?? null,
        max: bar.max ?? null,
      }))
    : [];
  const derived = raw.derived_json && typeof raw.derived_json === "object"
    ? raw.derived_json as Record<string, unknown>
    : null;

  return {
    character_id: raw.character_id ?? null,
    campaign_id: raw.campaign_id ?? null,
    player_id: raw.player_id ?? null,
    name: raw.name ?? null,
    level: raw.level ?? null,
    updated_at: raw.updated_at ?? null,
    base_stats: raw.base_stats ?? null,
    resources: {
      primary_id: resources?.primary_id ?? null,
      bars,
    },
    derived: derived
      ? {
          max_hp: derived.max_hp ?? null,
          max_power_bar: derived.max_power_bar ?? null,
          attack_rating: derived.attack_rating ?? null,
          armor_rating: derived.armor_rating ?? null,
          crit_chance: derived.crit_chance ?? null,
          crit_mult: derived.crit_mult ?? null,
          resist: derived.resist ?? null,
        }
      : null,
    class_json: classJson
      ? {
          class_name: classJson.class_name ?? null,
          role: classJson.role ?? null,
          weapon_family: (classJson.weapon_identity as Record<string, unknown> | null)?.family ?? null,
          weakness: classJson.weakness ?? null,
        }
      : null,
    skills: compactSkills,
  };
}

function compactBoardPayload(board: unknown) {
  if (!board || typeof board !== "object") return board;
  const raw = board as Record<string, unknown>;
  const boardType = raw.board_type ?? raw.mode ?? null;
  return {
    campaign_id: raw.campaign_id ?? null,
    board_id: raw.board_id ?? raw.id ?? null,
    board_type: boardType,
    status: raw.status ?? null,
    state_summary: summarizeBoardState(boardType, raw.state_json ?? null),
    ui_hints_json: raw.ui_hints_json ?? null,
    active_scene_id: raw.active_scene_id ?? null,
    combat_session_id: raw.combat_session_id ?? null,
    updated_at: raw.updated_at ?? null,
    recent_transitions: raw.recent_transitions ?? null,
  };
}

function compactCombatPayload(combat: unknown) {
  if (!combat || typeof combat !== "object") return combat;
  const raw = combat as Record<string, unknown>;
  const dmPayload = raw.dm_payload && typeof raw.dm_payload === "object"
    ? raw.dm_payload as Record<string, unknown>
    : null;
  const recentEvents = Array.isArray(dmPayload?.recent_events)
    ? dmPayload?.recent_events
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .slice(0, 8)
      .map((event) => ({
        event_type: event.event_type ?? null,
        turn_index: event.turn_index ?? null,
        created_at: event.created_at ?? null,
        actor: (() => {
          const payload = asObject(event.payload);
          return payload?.source_name
            ?? payload?.actor_name
            ?? payload?.actor_display
            ?? null;
        })(),
        target: (() => {
          const payload = asObject(event.payload);
          return payload?.target_name
            ?? payload?.target_display
            ?? null;
        })(),
        amount: (() => {
          const payload = asObject(event.payload);
          const amount = Number(
            payload?.damage_to_hp
            ?? payload?.amount
            ?? payload?.final_damage
            ?? payload?.tiles_used
            ?? Number.NaN,
          );
          return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : null;
        })(),
        status: (() => {
          const payload = asObject(event.payload);
          const status = asObject(payload?.status);
          if (typeof status?.id === "string" && status.id.trim().length > 0) return status.id.trim();
          if (typeof payload?.status_id === "string" && payload.status_id.trim().length > 0) return payload.status_id.trim();
          return null;
        })(),
        from: (() => {
          const payload = asObject(event.payload);
          return asObject(payload?.from) ?? null;
        })(),
        to: (() => {
          const payload = asObject(event.payload);
          return asObject(payload?.to) ?? null;
        })(),
      }))
    : [];
  return {
    combat_session_id: raw.combat_session_id ?? null,
    campaign_id: raw.campaign_id ?? null,
    status: raw.status ?? null,
    seed: raw.seed ?? null,
    current_turn_index: raw.current_turn_index ?? null,
    scene_json: raw.scene_json ?? null,
    dm_payload: dmPayload
      ? {
          actor: dmPayload.actor ?? null,
          enemies_count: dmPayload.enemies_count ?? null,
          allies_count: dmPayload.allies_count ?? null,
          turn_actor_name: dmPayload.turn_actor_name ?? null,
          recent_events: recentEvents,
        }
      : null,
  };
}

type CompanionCheckinLite = {
  companion_id: string;
  line: string;
  mood: string;
  urgency: string;
  hook_type: string;
  turn_index: number | null;
};

function parseCompanionCheckinEntry(entry: unknown, index: number): CompanionCheckinLite | null {
  if (!entry || typeof entry !== "object") return null;
  const raw = entry as Record<string, unknown>;
  const line = typeof raw.line === "string" ? raw.line.trim() : "";
  if (!line) return null;
  return {
    companion_id: typeof raw.companion_id === "string" && raw.companion_id.trim().length > 0 ? raw.companion_id.trim() : "companion",
    line,
    mood: typeof raw.mood === "string" && raw.mood.trim().length > 0 ? raw.mood.trim() : "steady",
    urgency: typeof raw.urgency === "string" && raw.urgency.trim().length > 0 ? raw.urgency.trim() : "medium",
    hook_type: typeof raw.hook_type === "string" && raw.hook_type.trim().length > 0 ? raw.hook_type.trim() : "companion_checkin",
    turn_index: Number.isFinite(Number(raw.turn_index)) ? Number(raw.turn_index) : index,
  };
}

function latestCompanionCheckin(boardState: Record<string, unknown> | null): CompanionCheckinLite | null {
  const rows = boardState && Array.isArray(boardState.companion_checkins) ? boardState.companion_checkins : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const parsed = parseCompanionCheckinEntry(rows[index], index);
    if (parsed) return parsed;
  }
  return null;
}

function isCompanionFollowupResolved(boardState: Record<string, unknown> | null, checkin: CompanionCheckinLite): boolean {
  const chips = boardState && Array.isArray(boardState.action_chips) ? boardState.action_chips : [];
  for (const row of chips) {
    if (!row || typeof row !== "object") continue;
    const chip = row as Record<string, unknown>;
    const payload = chip.payload && typeof chip.payload === "object" ? chip.payload as Record<string, unknown> : null;
    const companionId = payload && typeof payload.companion_id === "string" ? payload.companion_id : null;
    if (!companionId || companionId !== checkin.companion_id) continue;
    const turnIndex = Number.isFinite(Number(payload?.turn_index)) ? Number(payload?.turn_index) : null;
    const resolved = payload?.resolved === true || chip.resolved === true;
    if (!resolved) continue;
    if (checkin.turn_index === null || turnIndex === null || turnIndex === checkin.turn_index) {
      return true;
    }
  }
  return false;
}

function buildCompanionFollowupAction(checkin: CompanionCheckinLite): NarratorUiAction {
  const labelBase = checkin.line.includes(":") ? checkin.line.split(":")[0]!.trim() : `Companion ${checkin.companion_id}`;
  return {
    id: `companion-followup-${checkin.companion_id}-${checkin.turn_index ?? 0}`,
    label: compactLabel(`Check ${labelBase}`),
    intent: "companion_action",
    hint_key: `companion_followup:${checkin.companion_id}:${checkin.turn_index ?? 0}`,
    prompt: `I follow ${labelBase}'s check-in: "${checkin.line}". Give the immediate tactical step from current board truth.`,
    payload: {
      companion_id: checkin.companion_id,
      mood: checkin.mood,
      urgency: checkin.urgency,
      hook_type: checkin.hook_type,
      turn_index: checkin.turn_index,
    },
  };
}

function appendCompanionResolutionChip(args: {
  chips: NarratorUiAction[];
  actionContext: Record<string, unknown> | null;
}): NarratorUiAction[] {
  const context = args.actionContext ?? null;
  if (!context || context.companion_followup_resolved !== true) return args.chips;

  const companionId = typeof context.companion_id === "string" && context.companion_id.trim().length > 0
    ? context.companion_id.trim()
    : null;
  if (!companionId) return args.chips;

  const contextPayload = context.payload && typeof context.payload === "object"
    ? context.payload as Record<string, unknown>
    : null;
  const turnIndex = Number.isFinite(Number(context.companion_turn_index))
    ? Number(context.companion_turn_index)
    : Number.isFinite(Number(contextPayload?.turn_index))
      ? Number(contextPayload?.turn_index)
      : null;
  const hookType = typeof context.companion_hook_type === "string" && context.companion_hook_type.trim().length > 0
    ? context.companion_hook_type.trim()
    : "companion_checkin";

  const existing = args.chips.find((chip) => {
    const payload = chip.payload && typeof chip.payload === "object" ? chip.payload as Record<string, unknown> : null;
    return payload?.resolved === true
      && payload?.companion_id === companionId
      && (turnIndex === null || Number(payload?.turn_index) === turnIndex);
  });
  if (existing) return args.chips;

  return [
    ...args.chips,
    {
      id: `companion-resolved-${companionId}-${turnIndex ?? "na"}`,
      label: "Companion Debrief Logged",
      intent: "companion_action",
      hint_key: `companion_resolved:${companionId}:${turnIndex ?? "na"}`,
      prompt: `Companion follow-up ${companionId} has been resolved this turn.`,
      payload: {
        companion_id: companionId,
        turn_index: turnIndex,
        hook_type: hookType,
        resolved: true,
      },
    },
  ];
}

type StoryRewardSummary = {
  applied: boolean;
  turn_id: string | null;
  character_id: string | null;
  xp_awarded: number;
  loot_item_id: string | null;
  loot_item_name: string | null;
  reason: string | null;
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function stableIntFromText(raw: string): number {
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return hash % 2_147_483_647;
}

function readRewardHints(value: unknown): Array<{ key: string; detail: string | null; weight: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const row = entry as Record<string, unknown>;
      const key = typeof row.key === "string" ? row.key.trim() : "";
      if (!key) return null;
      const detail = typeof row.detail === "string" && row.detail.trim().length > 0 ? row.detail.trim() : null;
      const weightRaw = Number(row.weight);
      const weight = Number.isFinite(weightRaw) ? Math.max(0, Math.min(1, weightRaw)) : 0.5;
      return { key, detail, weight };
    })
    .filter((entry): entry is { key: string; detail: string | null; weight: number } => Boolean(entry))
    .slice(0, 8);
}

async function appendRewardDiscoveryEntry(args: {
  svc: ReturnType<typeof createServiceClient>;
  campaignId: string;
  detail: Record<string, unknown>;
}) {
  const { data: runtimeRow, error: runtimeErr } = await args.svc
    .schema("mythic")
    .from("campaign_runtime")
    .select("id,state_json")
    .eq("campaign_id", args.campaignId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runtimeErr || !runtimeRow) return;
  const state = asObject((runtimeRow as Record<string, unknown>).state_json) ?? {};
  const current = Array.isArray(state.discovery_log) ? state.discovery_log : [];
  const nextDiscovery = [...current, args.detail].slice(-64);
  const nextState = {
    ...state,
    discovery_log: nextDiscovery,
  };
  await args.svc
    .schema("mythic")
    .from("campaign_runtime")
    .update({ state_json: nextState, updated_at: new Date().toISOString() })
    .eq("id", String((runtimeRow as Record<string, unknown>).id));
}

async function applyDeterministicStoryReward(args: {
  svc: ReturnType<typeof createServiceClient>;
  campaignId: string;
  playerId: string;
  boardType: string;
  turnId: string | null;
  turnSeed: string;
  actionContext: Record<string, unknown> | null;
  boardState: Record<string, unknown> | null;
  boardDelta: Record<string, unknown> | null;
  requestId: string;
  log: FunctionContext["log"];
}): Promise<StoryRewardSummary> {
  const summary: StoryRewardSummary = {
    applied: false,
    turn_id: args.turnId,
    character_id: null,
    xp_awarded: 0,
    loot_item_id: null,
    loot_item_name: null,
    reason: null,
  };
  if (!args.turnId) {
    summary.reason = "missing_turn_id";
    return summary;
  }
  if (args.boardType === "combat") {
    summary.reason = "combat_board";
    return summary;
  }

  const intent = typeof args.actionContext?.intent === "string" ? args.actionContext.intent : "dm_prompt";
  const excludedIntents = new Set(["refresh", "open_panel", "focus_target", "combat_start", "shop"]);
  if (excludedIntents.has(intent)) {
    summary.reason = `intent_excluded:${intent}`;
    return summary;
  }

  const { data: character, error: charErr } = await args.svc
    .schema("mythic")
    .from("characters")
    .select("id,level,class_json")
    .eq("campaign_id", args.campaignId)
    .eq("player_id", args.playerId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (charErr || !character) {
    summary.reason = "character_missing";
    return summary;
  }
  const characterId = String((character as Record<string, unknown>).id);
  summary.character_id = characterId;

  const guardPayload = {
    source: "story_reward",
    request_id: args.requestId,
    board_type: args.boardType,
    intent,
  };
  const guard = await args.svc.rpc("turn_reward_guard", {
    p_turn_id: args.turnId,
    p_campaign_id: args.campaignId,
    p_character_id: characterId,
    p_reward_key: "story_reward_v1",
    p_payload: guardPayload,
  });
  if (guard.error) {
    summary.reason = "guard_failed";
    args.log.warn("story_reward.guard_failed", {
      request_id: args.requestId,
      campaign_id: args.campaignId,
      turn_id: args.turnId,
      error: errMessage(guard.error, "guard failed"),
    });
    return summary;
  }
  const guardId = typeof guard.data === "string" ? guard.data : null;
  if (!guardId) {
    summary.reason = "duplicate_turn_reward";
    return summary;
  }

  try {
    const boardFlags = asObject(args.boardState?.discovery_flags) ?? {};
    const rewardHints = readRewardHints(args.boardDelta?.reward_hints);
    const actionPayload = asObject(args.actionContext?.payload) ?? {};
    const actionSource = typeof args.actionContext?.source === "string" ? args.actionContext.source : null;

    let xp = 18 + rewardHints.length * 9;
    if (actionSource === "board_hotspot") xp += 6;
    if (boardFlags.treasure_triggered === true) xp += 18;
    if (boardFlags.dungeon_traces_found === true) xp += 12;
    if (typeof actionPayload.job_action === "string" && actionPayload.job_action === "complete") xp += 24;
    if (typeof actionPayload.action === "string" && String(actionPayload.action).includes("loot")) xp += 8;
    xp = clampInt(xp, 12, 120);

    const xpResult = await args.svc.rpc("mythic_apply_xp", {
      character_id: characterId,
      amount: xp,
      reason: "story_progression",
      metadata: {
        turn_id: args.turnId,
        turn_seed: args.turnSeed,
        board_type: args.boardType,
        intent,
        reward_hints: rewardHints,
      },
    });
    if (xpResult.error) throw xpResult.error;

    const classJson = asObject((character as Record<string, unknown>).class_json) ?? {};
    const role = typeof classJson.role === "string" ? classJson.role : "hybrid";
    const weaponIdentity = asObject(classJson.weapon_identity);
    const weaponHint = weaponIdentity && typeof weaponIdentity.family === "string" ? weaponIdentity.family : null;
    const level = clampInt(Number((character as Record<string, unknown>).level ?? 1), 1, 99);

    const lootChanceBase = 0.16 + rewardHints.reduce((acc, hint) => acc + (hint.weight * 0.08), 0);
    const lootChance = Math.max(
      0.08,
      Math.min(
        0.82,
        lootChanceBase
          + (boardFlags.treasure_triggered === true ? 0.25 : 0)
          + (typeof actionPayload.job_action === "string" && actionPayload.job_action === "complete" ? 0.12 : 0),
      ),
    );
    const lootRoll = (stableIntFromText(`${args.turnSeed}:story_reward:loot_roll`) % 1000) / 1000;
    const grantLoot = lootRoll < lootChance;
    let lootItemId: string | null = null;
    let lootItemName: string | null = null;

    if (grantLoot) {
      const rewardSeed = stableIntFromText(`${args.turnSeed}:story_reward:item`);
      const lootRarity = pickLootRarity(rewardSeed, `story:rarity:${args.turnId}`, level);
      const itemPayload = rollLootItem({
        seed: rewardSeed,
        label: `story:${args.turnId}:item`,
        level,
        rarity: lootRarity,
        classRole: role,
        weaponFamilyHint: weaponHint,
        campaignId: args.campaignId,
        characterId,
        source: "story_reward",
        narrativeHook: "A prize earned from momentum, not luck.",
      });
      const { data: insertedItem, error: itemErr } = await args.svc
        .schema("mythic")
        .from("items")
        .insert(itemPayload)
        .select("id,name,rarity")
        .maybeSingle();
      if (itemErr) throw itemErr;
      if (insertedItem) {
        lootItemId = String((insertedItem as Record<string, unknown>).id);
        lootItemName = typeof (insertedItem as Record<string, unknown>).name === "string"
          ? String((insertedItem as Record<string, unknown>).name)
          : null;
        const { error: invErr } = await args.svc
          .schema("mythic")
          .from("inventory")
          .insert({
            character_id: characterId,
            item_id: lootItemId,
            container: "backpack",
            quantity: 1,
          });
        if (invErr) throw invErr;

        const { error: dropErr } = await args.svc
          .schema("mythic")
          .from("loot_drops")
          .insert({
            campaign_id: args.campaignId,
            combat_session_id: null,
            source: "story_reward",
            rarity: (insertedItem as Record<string, unknown>).rarity ?? lootRarity,
            budget_points: rarityBudget(lootRarity),
            item_ids: [lootItemId],
            payload: {
              turn_id: args.turnId,
              intent,
              reward_hints: rewardHints,
            },
          });
        if (dropErr) throw dropErr;
      }
    }

    await args.svc.schema("mythic").from("dm_memory_events").insert({
      campaign_id: args.campaignId,
      player_id: args.playerId,
      category: "story_reward",
      severity: lootItemId ? 2 : 1,
      payload: {
        turn_id: args.turnId,
        board_type: args.boardType,
        intent,
        xp_awarded: xp,
        loot_item_id: lootItemId,
        loot_item_name: lootItemName,
      },
    });

    await appendRewardDiscoveryEntry({
      svc: args.svc,
      campaignId: args.campaignId,
      detail: {
        kind: "story_reward",
        detail: lootItemName ? `+${xp} XP · ${lootItemName}` : `+${xp} XP`,
        turn_id: args.turnId,
        intent,
      },
    });

    await args.svc
      .schema("mythic")
      .from("turn_reward_grants")
      .update({
        xp_amount: xp,
        loot_item_id: lootItemId,
        payload: {
          ...guardPayload,
          applied: true,
          reward_hints: rewardHints,
          loot_roll: lootRoll,
          loot_chance: lootChance,
          loot_item_name: lootItemName,
        },
      })
      .eq("id", guardId);

    return {
      applied: true,
      turn_id: args.turnId,
      character_id: characterId,
      xp_awarded: xp,
      loot_item_id: lootItemId,
      loot_item_name: lootItemName,
      reason: "story_reward_applied",
    };
  } catch (error) {
    await args.svc.schema("mythic").from("turn_reward_grants").delete().eq("id", guardId);
    summary.reason = "reward_failed";
    args.log.warn("story_reward.failed", {
      request_id: args.requestId,
      campaign_id: args.campaignId,
      turn_id: args.turnId,
      error: errMessage(error, "story reward failed"),
    });
    return summary;
  }
}

function synthesizeRecoveryPayload(args: {
  boardType: string;
  boardSummary: Record<string, unknown> | null;
  boardState: Record<string, unknown> | null;
  actionContext: Record<string, unknown> | null;
  lastErrors: string[];
}): DmNarratorOutput {
  const context = args.actionContext ?? null;
  const boardStatePresentation = readPresentationState(args.boardState);
  const contextCursor = parseEventCursor(context?.combat_event_cursor);
  const presentationCursor = parseEventCursor(boardStatePresentation.last_event_cursor ?? null);
  const effectiveCursor = contextCursor ?? presentationCursor;
  const combatantStateHint = readCombatantStateHint(context?.combatant_state);
  const combatEventBatch = Array.isArray(context?.combat_event_batch)
    ? context?.combat_event_batch
      .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
      .filter((entry) => isBatchEventAfterCursor(entry, effectiveCursor))
      .filter((entry) => {
        const payload = asObject(entry.payload) ?? {};
        const eventType = typeof entry.event_type === "string" ? entry.event_type.toLowerCase() : "";
        if (eventType === "death") return true;
        const actorId = typeof payload.source_combatant_id === "string"
          ? payload.source_combatant_id
          : typeof payload.actor_combatant_id === "string"
            ? payload.actor_combatant_id
            : typeof entry.actor_combatant_id === "string"
              ? entry.actor_combatant_id
              : null;
        if (!actorId) return true;
        const hinted = combatantStateHint[actorId];
        if (!hinted) return true;
        return hinted.is_alive && hinted.hp > 0;
      })
      .slice(-8)
    : [];
  const boardType = (args.boardType === "combat" || combatEventBatch.length > 0) ? "combat" : args.boardType;
  const boardLabel = titleCaseWords(boardType || "board");
  const actionIntent = typeof context?.intent === "string" ? context.intent : "dm_prompt";
  const rawActionPrompt = typeof context?.payload === "object" && context?.payload
    && typeof (context.payload as Record<string, unknown>).prompt === "string"
    ? String((context.payload as Record<string, unknown>).prompt)
    : null;
  const rawActionId = typeof context?.action_id === "string" ? String(context.action_id) : null;
  const contextPayload = asObject(context?.payload);
  const suppressNarrationOnError = context?.suppress_narration_on_error === true;
  const executionError = typeof context?.execution_error === "string" && context.execution_error.trim().length > 0
    ? context.execution_error.trim()
    : null;
  const introOpening = context?.source === "campaign_intro_auto"
    || contextPayload?.intro_opening === true;
  const actionPrompt = (() => {
    const source = rawActionPrompt && rawActionPrompt.trim().length > 0 ? rawActionPrompt : rawActionId;
    if (!source) return null;
    const clean = source
      .trim()
      .replace(/\bcampaign_[a-z0-9_]+\b/gi, " ")
      .replace(/\b[a-z0-9]+(?:_[a-z0-9]+){2,}_v\d+\b/gi, " ")
      .replace(/\bcommand:unknown\b/gi, " ")
      .replace(/\b[a-z0-9]+(?:_[a-z0-9]+){2,}\b/gi, (token) => token.includes("_") ? token.replace(/_/g, " ") : token)
      .replace(/\s+/g, " ");
    return clean.length > 0 ? clean : null;
  })();
  const stateChanges = Array.isArray(context?.state_changes)
    ? context?.state_changes.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 3)
    : [];
  const firstStateChange = stateChanges[0] ?? null;
  const actionSummary = compactLabel(
    firstStateChange
      ?? actionPrompt
      ?? `I execute ${actionIntent.replace(/_/g, " ")} from the current board state.`,
    160,
  );
  const companionCheckin = latestCompanionCheckin(args.boardState);
  const boardAnchor = typeof args.boardSummary?.travel_goal === "string"
    ? args.boardSummary.travel_goal
    : typeof args.boardSummary?.search_target === "string"
      ? args.boardSummary.search_target
      : boardLabel;
  const summaryObjective = (() => {
    const samples = Array.isArray(args.boardSummary?.objective_samples) ? args.boardSummary.objective_samples : [];
    for (const sample of samples) {
      const row = asObject(sample);
      const value = typeof row?.title === "string" ? row.title : typeof row?.detail === "string" ? row.detail : null;
      if (value && value.trim().length > 0) return value.trim();
    }
    return null;
  })();
  const summaryRumor = (() => {
    const samples = Array.isArray(args.boardSummary?.rumor_samples) ? args.boardSummary.rumor_samples : [];
    for (const sample of samples) {
      const row = asObject(sample);
      const value = typeof row?.title === "string" ? row.title : typeof row?.detail === "string" ? row.detail : null;
      if (value && value.trim().length > 0) return value.trim();
    }
    return null;
  })();

  const seedKey = [
    boardType,
    actionIntent,
    actionSummary,
    rawActionId ?? "",
    typeof context?.action_trace_id === "string" ? context.action_trace_id : "",
    typeof args.boardSummary?.world_title === "string" ? args.boardSummary.world_title : "",
  ]
    .filter((entry) => entry.length > 0)
    .join("|");
  const pressureMetric = Number(
    args.boardSummary?.guard_alertness
      ?? args.boardSummary?.hazard_meter
      ?? args.boardSummary?.trap_signals
      ?? 0,
  );
  const tone = selectToneMode({
    seedKey,
    lastTone: boardStatePresentation.last_tone ?? null,
    tension: Number.isFinite(pressureMetric) ? Math.max(0, Math.min(100, Math.floor(pressureMetric * 100))) : 48,
    bossPresent: combatEventBatch.some((entry) => {
      const payload = asObject(entry.payload);
      return payload?.boss === true || payload?.is_boss === true;
    }),
    playerHpPct: (() => {
      const payload = asObject(contextPayload);
      const hp = Number(payload?.player_hp ?? payload?.hp ?? Number.NaN);
      const hpMax = Number(payload?.player_hp_max ?? payload?.hp_max ?? Number.NaN);
      if (!Number.isFinite(hp) || !Number.isFinite(hpMax) || hpMax <= 0) return 0.65;
      return Math.max(0, Math.min(1, hp / hpMax));
    })(),
    regionTheme: `${boardType}:${typeof args.boardSummary?.weather === "string" ? args.boardSummary.weather : ""}`,
  });
  const toneLine = toneSeedLine(tone.tone, `${seedKey}:tone-line`);

  const hooks = [
    actionSummary,
    summaryObjective,
    summaryRumor,
    typeof args.boardSummary?.travel_goal === "string" ? args.boardSummary.travel_goal : null,
    typeof args.boardSummary?.search_target === "string" ? args.boardSummary.search_target : null,
  ]
    .filter((entry): entry is string => Boolean(entry && entry.trim().length > 0))
    .map((entry) => compactLabel(entry, 88))
    .slice(0, 4);

  const boardNarration = buildBoardNarration({
    seedKey,
    boardType: boardType === "town" || boardType === "travel" || boardType === "dungeon" || boardType === "combat"
      ? boardType
      : "town",
    hooks,
    timePressure: typeof args.boardSummary?.travel_goal === "string" ? args.boardSummary.travel_goal : null,
    factionTension: typeof args.boardSummary?.faction_count === "number"
      ? `${args.boardSummary.faction_count} factions in play`
      : null,
    resourceWindow: typeof args.boardSummary?.service_count === "number"
      ? `${args.boardSummary.service_count} service windows`
      : null,
    regionName: typeof args.boardSummary?.world_title === "string" ? args.boardSummary.world_title : null,
    lastOpenerId: boardStatePresentation.last_board_opener_id ?? null,
  });

  const enemyTraitsByCombatantId: Record<string, Partial<EnemyPersonalityTraits>> = {};
  for (const event of combatEventBatch) {
    const payload = asObject(event.payload);
    if (!payload) continue;
    const actorId = typeof payload.source_combatant_id === "string"
      ? payload.source_combatant_id
      : typeof payload.actor_combatant_id === "string"
        ? payload.actor_combatant_id
        : null;
    const traits = asObject(payload.enemy_traits ?? payload.actor_traits);
    if (!actorId || !traits) continue;
    enemyTraitsByCombatantId[actorId] = {
      aggression: Number(traits.aggression),
      discipline: Number(traits.discipline),
      intelligence: Number(traits.intelligence),
      instinct_type: typeof traits.instinct_type === "string" ? traits.instinct_type as EnemyPersonalityTraits["instinct_type"] : undefined,
    };
  }

  const middlewareOut = buildNarrativeLinesFromEvents({
    seedKey,
    tone: tone.tone,
    events: combatEventBatch as Array<{ event_type: string; payload?: Record<string, unknown> }>,
    recentLineHashes: boardStatePresentation.recent_line_hashes ?? [],
    recentVerbKeys: boardStatePresentation.last_verb_keys ?? [],
    enemyTraitsByCombatantId,
    maxLines: 4,
  });

  const recoveryBeat = boardType === "combat"
    ? "Pick the next target and keep tempo."
    : boardType === "town"
      ? "Choose your next push: contact, contract, or gate."
      : boardType === "travel"
        ? "Pick the route segment to pressure next."
        : "Choose the next room edge and force a consequence.";

  const narrativeParts = boardType === "combat"
    ? (suppressNarrationOnError && executionError
      ? [
        `Action blocked: ${compactLabel(executionError, 180)}.`,
        "Choose a legal target, move, or timing window and try again.",
      ]
      : [
        middlewareOut.lines[0] ?? toneLine,
        middlewareOut.lines[1] ?? recoveryBeat,
        middlewareOut.lines[2] ?? "",
      ])
    : introOpening
      ? [buildIntroRecoveryNarration({
          boardType,
          recoveryPressure: boardNarration.text,
          recoveryBeat,
          boardAnchor,
          summaryObjective,
          summaryRumor,
        })]
      : [
          boardNarration.text,
          toneLine,
          companionCheckin ? companionCheckin.line : recoveryBeat,
        ];

  const titleInput = buildReputationTitle({
    baseName: typeof contextPayload?.player_name === "string" ? contextPayload.player_name : "Wanderer",
    reputationScore: Number(contextPayload?.reputation_score ?? 0),
    behaviorFlags: Array.isArray(contextPayload?.behavior_flags)
      ? contextPayload.behavior_flags.map((entry) => String(entry))
      : [],
    notableKills: Array.isArray(contextPayload?.notable_kills)
      ? contextPayload.notable_kills.map((entry) => String(entry))
      : [],
    factionStanding: asNumberRecord(contextPayload?.faction_standing),
    seedKey: `${seedKey}:title`,
  });

  let cleanNarrative = sanitizeNarrationForPlayer(
    narrativeParts
      .filter((entry) => entry && entry.trim().length > 0)
      .slice(0, 3)
      .join(" "),
    boardType,
  );
  if (titleInput.tier >= 3 && titleInput.displayName.trim().length > 0) {
    cleanNarrative = cleanNarrative.replace(/\bYou\b/g, titleInput.displayName);
  }

  const nextPresentationState = mergePresentationState(boardStatePresentation, {
    last_tone: tone.tone,
    last_board_opener_id: boardNarration.openerId,
    recent_line_hashes: boardType === "combat"
      ? middlewareOut.lineHashes
      : [hashLine(cleanNarrative)],
    last_verb_keys: middlewareOut.verbKeys,
    last_template_ids: middlewareOut.templateIds,
    last_event_cursor: middlewareOut.lastEventCursor ?? boardStatePresentation.last_event_cursor ?? null,
  });

  const vendors = extractVendorsFromBoardSummary(args.boardSummary);
  const baseActions: NarratorUiAction[] = boardType === "town"
    ? [
      ...(vendors[0]
        ? [{
            id: `recovery-shop-${vendors[0].id}`,
            label: `Check ${vendors[0].name}`,
            intent: "shop_action",
            payload: { vendorId: vendors[0].id },
            prompt: `I check ${vendors[0].name} for contract and inventory changes tied to current board hooks.`,
          } satisfies NarratorUiAction]
        : []),
      {
        id: "recovery-town-travel",
        label: "Push To Travel",
        intent: "quest_action",
        boardTarget: "travel",
        payload: { mode: "travel" },
      },
      {
        id: "recovery-town-rumor",
        label: "Lean On A Rumor",
        intent: "dm_prompt",
        prompt: "I lean on the strongest rumor in town and force a concrete consequence from current board truth.",
      },
    ]
    : boardType === "travel"
      ? [
        { id: "recovery-travel-scout", label: "Scout The Route", intent: "dm_prompt", prompt: "I scout the route and pressure the immediate travel threat." },
        { id: "recovery-travel-dungeon", label: "Enter Dungeon", intent: "quest_action", boardTarget: "dungeon", payload: { mode: "dungeon" } },
        { id: "recovery-travel-trace", label: "Track Fresh Traces", intent: "dm_prompt", prompt: "I track the freshest trace and force a concrete encounter lead from committed route state." },
      ]
      : boardType === "dungeon"
        ? [
          { id: "recovery-dungeon-assess", label: "Assess This Room", intent: "dm_prompt", prompt: "I assess this room for threats, exits, and objective leverage." },
          { id: "recovery-dungeon-proceed", label: "Breach The Next Door", intent: "dm_prompt", prompt: "I breach the next doorway and narrate committed outcomes only." },
          { id: "recovery-dungeon-retreat", label: "Fall Back To Town", intent: "quest_action", boardTarget: "town", payload: { mode: "town" } },
        ]
        : [
          { id: "recovery-combat-read", label: "Call The Kill Read", intent: "dm_prompt", prompt: "Give me the immediate tactical read from committed combat events." },
          { id: "recovery-combat-focus", label: "Pressure Priority Target", intent: "combat_action", payload: { target_combatant_id: context?.active_turn_combatant_id ?? null } },
          { id: "recovery-combat-push", label: "Advance On Closest Hostile", intent: "dm_prompt", prompt: "I advance on the nearest hostile and commit pressure; narrate committed movement and threat response." },
        ];

  const sanitizedActions = sanitizeUiActions({
    actions: baseActions,
    boardType,
    boardSummary: args.boardSummary,
  }).slice(0, 4);

  const latestCheckin = latestCompanionCheckin(args.boardState);
  let actionChips = sanitizeUiActions({
    actions: sanitizedActions,
    boardType,
    boardSummary: args.boardSummary,
  }).slice(0, 6);

  if (latestCheckin && !isCompanionFollowupResolved(args.boardState, latestCheckin)) {
    const hasExistingCompanion = actionChips.some((chip) => {
      const payload = chip.payload && typeof chip.payload === "object" ? chip.payload as Record<string, unknown> : null;
      return payload?.companion_id === latestCheckin.companion_id && payload?.resolved !== true;
    });
    if (!hasExistingCompanion) {
      actionChips = [...actionChips.slice(0, 5), buildCompanionFollowupAction(latestCheckin)];
    }
  }

  actionChips = appendCompanionResolutionChip({
    chips: actionChips,
    actionContext: context,
  }).slice(-6);

  const discoveryDetail = compactLabel(
    args.lastErrors.length > 0
      ? `auto_recovery:${args.lastErrors.join("|")}`
      : "auto_recovery:validation_repair",
    200,
  );

  return {
    schema_version: "mythic.dm.narrator.v1",
    narration: cleanNarrative,
    scene: {
      environment: typeof args.boardSummary?.weather === "string" ? args.boardSummary.weather : boardLabel,
      mood: "dark tactical pressure",
      focus: actionSummary,
      travel_goal: typeof args.boardSummary?.travel_goal === "string" ? args.boardSummary.travel_goal : null,
    },
      ui_actions: sanitizedActions,
      runtime_delta: {
        rumors: [{ title: "Pressure Spike", detail: actionSummary }],
        objectives: [{ title: `Advance ${boardLabel}`, description: "Commit one concrete move and hold tempo." }],
        discovery_log: [{ kind: "dm_recovery", detail: discoveryDetail }],
        dm_presentation: { ...nextPresentationState },
        scene_cache: {
          environment: typeof args.boardSummary?.weather === "string" ? args.boardSummary.weather : boardLabel,
          mood: `${tone.tone} pressure`,
          focus: actionSummary,
        },
        action_chips: actionChips,
      },
      board_delta: {
        rumors: [{ title: "Pressure Spike", detail: actionSummary }],
        objectives: [{ title: `Advance ${boardLabel}`, description: "Commit one concrete move and hold tempo." }],
        discovery_log: [{ kind: "dm_recovery", detail: discoveryDetail }],
        dm_presentation: { ...nextPresentationState },
        scene_cache: {
          environment: typeof args.boardSummary?.weather === "string" ? args.boardSummary.weather : boardLabel,
          mood: `${tone.tone} pressure`,
          focus: actionSummary,
        },
        action_chips: actionChips,
      },
  };
}

export const mythicDungeonMaster: FunctionHandler = {
  name: "mythic-dungeon-master",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-dungeon-master",
      limit: 24,
      windowMs: 60_000,
      corsHeaders: {},
      requestId: ctx.requestId,
    });
    if (rateLimited) return rateLimited;

    try {
      const user = await requireUser(req.headers);

      const raw = await req.json().catch(() => null);
      const parsed = RequestSchema.safeParse(raw);
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId: ctx.requestId }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { campaignId, messages, actionContext } = parsed.data;
      const actionContextRecord = actionContext && typeof actionContext === "object"
        ? actionContext as Record<string, unknown>
        : null;
      const idempotencyHeader = idempotencyKeyFromRequest(req);
      const idempotencyKey = idempotencyHeader ? `${user.userId}:${idempotencyHeader}` : null;
      if (idempotencyKey) {
        const cached = getIdempotentResponse(idempotencyKey);
        if (cached) {
          ctx.log.info("dm.idempotent_hit", {
            request_id: ctx.requestId,
            campaign_id: campaignId,
            user_id: user.userId,
          });
          return cached;
        }
      }
      const svc = createServiceClient();

      await assertCampaignAccess(svc, campaignId, user.userId);

      const warnings: string[] = [];

      // Turn context: compute next turn index and a deterministic seed up-front.
      const { data: latestTurn, error: latestTurnErr } = await svc
        .schema("mythic")
        .from("turns")
        .select("turn_index")
        .eq("campaign_id", campaignId)
        .order("turn_index", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestTurnErr) {
        ctx.log.error("dm.turn_index.failed", {
          request_id: ctx.requestId,
          campaign_id: campaignId,
          hint: errMessage(latestTurnErr, "query failed"),
        });
        return new Response(
          JSON.stringify({
            error: "Turn engine not ready (missing mythic.turns). Apply migrations and retry.",
            code: "turn_engine_not_ready",
            details: { hint: errMessage(latestTurnErr, "query failed") },
            requestId: ctx.requestId,
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        );
      }

      const expectedTurnIndex = (latestTurn?.turn_index ?? -1) + 1;
      const salt = config.mythicTurnSalt;
      if (!salt) {
        warnings.push("missing_turn_salt:determinism_weak");
      }
      const turnSeed = await computeTurnSeed({
        campaignSeed: campaignId,
        turnIndex: expectedTurnIndex,
        playerId: user.userId,
        salt,
      });

      const prng = createTurnPrng(turnSeed);

      // Canonical rules/script.
      const [
        { data: rulesRow, error: rulesError },
        { data: scriptRow, error: scriptError },
        { data: worldProfilePrimary, error: worldProfilePrimaryError },
      ] = await Promise.all([
        svc.schema("mythic").from("game_rules").select("name, version, rules").eq("name", "mythic-weave-rules-v1").maybeSingle(),
        svc
          .schema("mythic")
          .from("generator_scripts")
          .select("name, version, is_active, content")
          .eq("name", "mythic-weave-core")
          .eq("is_active", true)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle(),
        svc
          .schema("mythic")
          .from("world_profiles")
          .select("seed_title, seed_description, template_key, world_profile_json")
          .eq("campaign_id", campaignId)
          .maybeSingle(),
      ]);

      if (rulesError) throw rulesError;
      if (scriptError) throw scriptError;
      if (worldProfilePrimaryError) {
        warnings.push(`world_profiles unavailable: ${errMessage(worldProfilePrimaryError, "query failed")}`);
      }

      let board: Record<string, unknown> | null = null;
      {
        const runtimeRows = await svc
          .schema("mythic")
          .from("campaign_runtime")
          .select("id,campaign_id,mode,status,state_json,ui_hints_json,combat_session_id,updated_at")
          .eq("campaign_id", campaignId)
          .eq("status", "active")
          .order("updated_at", { ascending: false })
          .limit(2);
        if (runtimeRows.error) {
          warnings.push(`campaign_runtime unavailable: ${errMessage(runtimeRows.error, "query failed")}`);
        } else {
          const rows = ((runtimeRows.data ?? []) as Record<string, unknown>[]);
          if (rows.length > 1) {
            warnings.push("duplicate_active_runtime_rows_detected:using_latest_runtime_row");
          }
          const activeRuntime = rows[0] ?? null;
          if (activeRuntime) {
            const transitions = await svc
              .schema("mythic")
              .from("runtime_events")
              .select("id,from_mode,to_mode,reason,payload_json,created_at")
              .eq("campaign_id", campaignId)
              .order("created_at", { ascending: false })
              .limit(12);
            if (transitions.error) {
              warnings.push(`runtime_events unavailable: ${errMessage(transitions.error, "query failed")}`);
            }
            board = {
              ...activeRuntime,
              board_type: activeRuntime.mode,
              recent_transitions: transitions.data ?? [],
            };
          }
        }

        if (!board) {
          const seedRuntime = await svc
            .schema("mythic")
            .from("campaign_runtime")
            .insert({
              campaign_id: campaignId,
              mode: "town",
              status: "active",
              state_json: {},
              ui_hints_json: {},
            })
            .select("id,campaign_id,mode,status,state_json,ui_hints_json,combat_session_id,updated_at")
            .single();
          if (seedRuntime.error) {
            warnings.push(`campaign_runtime seed failed: ${errMessage(seedRuntime.error, "query failed")}`);
          } else {
            const runtime = seedRuntime.data as Record<string, unknown>;
            board = {
              ...runtime,
              board_type: runtime.mode,
              recent_transitions: [],
            };
          }
        }
      }

      const preferredCharacterQuery = await svc
        .schema("mythic")
        .from("v_character_state_for_dm")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("player_id", user.userId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      let character = preferredCharacterQuery.data;
      if (preferredCharacterQuery.error) {
        // Backward-compatible fallback for environments where the view is stale.
        const fallbackQuery = await svc
          .schema("mythic")
          .from("v_character_state_for_dm")
          .select("*")
          .eq("campaign_id", campaignId)
          .eq("player_id", user.userId)
          .limit(1)
          .maybeSingle();
        if (fallbackQuery.error) {
          throw fallbackQuery.error;
        }
        character = fallbackQuery.data;
      }

      let combat: unknown = null;
      const combatSessionId = (board as { combat_session_id?: string | null } | null)?.combat_session_id ?? null;
      if (combatSessionId) {
        const { data: cs, error: csError } = await svc
          .schema("mythic")
          .from("v_combat_state_for_dm")
          .select("combat_session_id, campaign_id, status, seed, scene_json, current_turn_index, dm_payload")
          .eq("combat_session_id", combatSessionId)
          .maybeSingle();
        if (csError) throw csError;
        combat = cs;
      }

      const { data: dmCampaignState } = await svc
        .schema("mythic")
        .from("dm_campaign_state")
        .select("*")
        .eq("campaign_id", campaignId)
        .maybeSingle();

      const { data: dmWorldTension } = await svc
        .schema("mythic")
        .from("dm_world_tension")
        .select("*")
        .eq("campaign_id", campaignId)
        .maybeSingle();

      const { data: companionsRaw, error: companionsError } = await svc
        .schema("mythic")
        .from("campaign_companions")
        .select("companion_id,name,archetype,voice,mood,cadence_turns,urgency_bias,metadata")
        .eq("campaign_id", campaignId)
        .order("companion_id", { ascending: true });
      if (companionsError) {
        warnings.push(`campaign_companions unavailable: ${errMessage(companionsError, "query failed")}`);
      }

      const compactRules = {
        name: rulesRow?.name ?? "mythic-weave-rules-v1",
        version: rulesRow?.version ?? null,
        content_policy: (rulesRow?.rules as Record<string, unknown> | null)?.content_policy ?? null,
        boards: (rulesRow?.rules as Record<string, unknown> | null)?.boards
          ? {
              types: ((rulesRow?.rules as Record<string, unknown>).boards as Record<string, unknown>).types ?? null,
              transition_animation: ((rulesRow?.rules as Record<string, unknown>).boards as Record<string, unknown>)
                .transition_animation ?? null,
            }
          : null,
        combat_event_contract: (rulesRow?.rules as Record<string, unknown> | null)?.combat_event_contract
          ? {
              append_only: ((rulesRow?.rules as Record<string, unknown>).combat_event_contract as Record<string, unknown>)
                .append_only ?? null,
              event_types: ((rulesRow?.rules as Record<string, unknown>).combat_event_contract as Record<string, unknown>)
                .event_types ?? null,
            }
          : null,
      };

      const compactScript = {
        name: scriptRow?.name ?? "mythic-weave-core",
        version: scriptRow?.version ?? null,
        is_active: scriptRow?.is_active ?? null,
        key_rules: [
          "DB state is authoritative.",
          "Combat/logs are append-only and deterministic.",
          "Violence/gore allowed; mild sexuality/banter allowed; sexual violence/coercion forbidden.",
          "Grid and board state are truth for narration.",
        ],
      };

      const compactBoard = compactBoardPayload(board);
      const compactCharacter = compactCharacterPayload(character);
      const compactCombat = compactCombatPayload(combat);
      const boardPayloadRecord = asObject(compactBoard);
      const boardSummaryRecord = asObject(boardPayloadRecord?.state_summary);
      const boardStateRecord = asObject((board as Record<string, unknown> | null)?.state_json);
      const worldSeedFromBoard = asObject(boardStateRecord?.world_seed ?? boardStateRecord?.worldSeed);
      const worldSummaryFromBoard = asObject(boardStateRecord?.world_context ?? boardStateRecord?.worldContext);
      const dmContextFromBoard = asObject(boardStateRecord?.dm_context ?? boardStateRecord?.dmContext);
      const campaignContextFromBoard = asObject(boardStateRecord?.campaign_context ?? boardStateRecord?.campaignContext);
      const worldStateFromBoard = asObject(boardStateRecord?.world_state ?? boardStateRecord?.worldState);
      const worldProfilePrimaryRow = asObject(worldProfilePrimary);
      let worldProfileJson = asObject(worldProfilePrimaryRow?.world_profile_json);
      let worldSeedTitle = String(worldProfilePrimaryRow?.seed_title ?? worldSeedFromBoard?.title ?? campaignId).trim();
      let worldSeedDescription = String(
        worldProfilePrimaryRow?.seed_description
          ?? worldSeedFromBoard?.description
          ?? "World profile reconstructed from runtime state.",
      ).trim();
      let worldTemplateKey = typeof worldProfilePrimaryRow?.template_key === "string" && worldProfilePrimaryRow.template_key.trim().length > 0
        ? worldProfilePrimaryRow.template_key.trim()
        : "custom";
      if (!worldProfileJson || Object.keys(worldProfileJson).length === 0) {
        const fallbackProfile = await svc
          .schema("mythic")
          .from("campaign_world_profiles")
          .select("seed_title, seed_description, template_key, world_profile_json")
          .eq("campaign_id", campaignId)
          .maybeSingle();
        if (!fallbackProfile.error && fallbackProfile.data) {
          const fallbackRow = asObject(fallbackProfile.data);
          worldProfileJson = asObject(fallbackRow?.world_profile_json);
          worldSeedTitle = String(fallbackRow?.seed_title ?? worldSeedTitle).trim() || worldSeedTitle;
          worldSeedDescription = String(fallbackRow?.seed_description ?? worldSeedDescription).trim() || worldSeedDescription;
          worldTemplateKey = typeof fallbackRow?.template_key === "string" && fallbackRow.template_key.trim().length > 0
            ? fallbackRow.template_key.trim()
            : worldTemplateKey;
        } else if (fallbackProfile.error) {
          warnings.push(`campaign_world_profiles unavailable: ${errMessage(fallbackProfile.error, "query failed")}`);
        }
      }
      let worldForgeVersion = WORLD_FORGE_VERSION;
      let campaignContextForPrompt = campaignContextFromBoard;
      let worldSummaryForPrompt = worldSummaryFromBoard;
      let dmContextForPrompt = dmContextFromBoard;
      let worldSeedForPrompt = worldSeedFromBoard;
      let worldStateForPrompt = worldStateFromBoard;
      if (!campaignContextForPrompt || !worldSummaryForPrompt || !dmContextForPrompt || !worldSeedForPrompt) {
        try {
          const campaignContext = coerceCampaignContextFromProfile({
            seedTitle: worldSeedTitle || "Mythic Campaign",
            seedDescription: worldSeedDescription || "World profile reconstructed from runtime state.",
            templateKey: worldTemplateKey,
            worldProfileJson: worldProfileJson ?? {},
          });
          worldForgeVersion = campaignContext.worldForgeVersion;
          campaignContextForPrompt = campaignContext as unknown as Record<string, unknown>;
          worldSummaryForPrompt = summarizeWorldContext(campaignContext);
          dmContextForPrompt = {
            profile: campaignContext.dmContext.dmBehaviorProfile,
            narrative_directives: campaignContext.dmContext.narrativeDirectives,
            tactical_directives: campaignContext.dmContext.tacticalDirectives,
          };
          worldSeedForPrompt = {
            title: campaignContext.title,
            description: campaignContext.description,
            seed_number: campaignContext.worldSeed.seedNumber,
            seed_string: campaignContext.worldSeed.seedString,
            theme_tags: campaignContext.worldSeed.themeTags,
            tone_vector: campaignContext.worldSeed.toneVector,
          };
          worldStateForPrompt = campaignContext.worldContext.worldState as unknown as Record<string, unknown>;
        } catch (error) {
          warnings.push(`world_context_coerce_failed:${errMessage(error, "world context reconstruction failed")}`);
        }
      }
      const boardDiscoveryFlags = asObject(boardStateRecord?.discovery_flags);
      const introPendingBefore = boardDiscoveryFlags?.intro_pending === true;
      const actionContextPayload = asObject(actionContextRecord?.payload);
      const introMode = introPendingBefore
        || (typeof actionContextRecord?.source === "string" && actionContextRecord.source === "campaign_intro_auto")
        || actionContextPayload?.intro_opening === true;
      const introVersion = Number.isFinite(Number(boardDiscoveryFlags?.intro_version))
        ? Math.max(1, Number(boardDiscoveryFlags?.intro_version))
        : 1;
      const introSource = typeof boardDiscoveryFlags?.intro_source === "string"
        ? boardDiscoveryFlags.intro_source
        : "bootstrap";
      const compactCompanions = Array.isArray(companionsRaw)
        ? companionsRaw
          .map((row) => asObject(row))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry))
          .slice(0, 8)
          .map((entry) => ({
            companion_id: entry.companion_id ?? null,
            name: entry.name ?? null,
            archetype: entry.archetype ?? null,
            voice: entry.voice ?? null,
            mood: entry.mood ?? null,
            cadence_turns: entry.cadence_turns ?? null,
            urgency_bias: entry.urgency_bias ?? null,
            metadata: asObject(entry.metadata) ?? null,
          }))
        : [];
      const boardNarrativeSamples = (() => {
        const rawBoard = asObject(board);
        const state = asObject(rawBoard?.state_json);
        if (!state) return null;
        return {
          rumors: sampleNarrativeEntries(state.rumors, 4),
          objectives: sampleNarrativeEntries(state.objectives, 4),
          discovery_log: sampleNarrativeEntries(state.discovery_log, 4),
          companion_checkins: sampleNarrativeEntries(state.companion_checkins, 3),
        };
      })();

      // Consume deterministic rolls in a stable order. These are authoritative for the turn.
      const rollContext = (() => {
        const boardType = (compactBoard as Record<string, unknown> | null)?.board_type;
        const bt = typeof boardType === "string" ? boardType : "unknown";
        // A couple of general-purpose rolls used for pacing/scene variation.
        const scene_variant = prng.next01("scene_variant", { board_type: bt });
        const tension = prng.next01("tension", { board_type: bt });
        // Board-specific rolls (kept minimal for now, but logged for replay).
        const encounter = prng.next01("encounter_check", { board_type: bt });
        const discovery = prng.next01("discovery_check", { board_type: bt });
        return { board_type: bt, scene_variant, tension, encounter, discovery };
      })();

      const allowedVendorIds = (() => {
        const vendors = (compactBoard as Record<string, unknown> | null)?.state_summary
          && typeof (compactBoard as Record<string, unknown>).state_summary === "object"
          ? ((compactBoard as Record<string, unknown>).state_summary as Record<string, unknown>).vendors
          : null;
        if (!Array.isArray(vendors)) return new Set<string>();
        const ids = vendors
          .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>).id : null))
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          .map((id) => id.trim());
        return new Set(ids);
      })();
      const introPromptDirective = introMode
        ? [
          "INTRO MODE IS ACTIVE.",
          "This is the first campaign entry and must provide immediate, concrete direction.",
          "Narration must open the scenario tied to seeded world hooks, then present 3-4 actionable next moves.",
          "runtime_delta.discovery_flags must set intro_pending=false.",
        ].join("\n")
        : "";

      const systemPrompt = `
You are the Mythic Weave Dungeon Master entity.
You must narrate a living dungeon comic that strictly matches authoritative DB state.

TURN CONTEXT (DETERMINISTIC, AUTHORITATIVE)
${jsonInline({ expected_turn_index: expectedTurnIndex, turn_seed: turnSeed.toString(), rolls: rollContext }, 1400)}

AUTHORITATIVE SCRIPT (DB): mythic.generator_scripts(name='mythic-weave-core')
${jsonInline(compactScript, 2200)}

AUTHORITATIVE RULES (DB): mythic.game_rules(name='mythic-weave-rules-v1')
${jsonInline(compactRules, 2200)}

AUTHORITATIVE STATE (DB VIEWS)
- Active board payload (mythic.v_board_state_for_dm):
${jsonInline(compactBoard ?? null, 1900)}

- Player character payload (mythic.v_character_state_for_dm):
${jsonInline(compactCharacter ?? null, 1400)}

- Combat payload (mythic.v_combat_state_for_dm or null):
${jsonInline(compactCombat ?? null, 1400)}

- DM campaign state:
${jsonInline(dmCampaignState ?? null, 700)}

- DM world tension:
${jsonInline(dmWorldTension ?? null, 600)}

- Campaign companions:
${jsonInline(compactCompanions, 900)}

- World Forge context:
${jsonInline({
  world_forge_version: worldForgeVersion,
  world_seed: worldSeedForPrompt ?? null,
  world_context: worldSummaryForPrompt ?? null,
  dm_context: dmContextForPrompt ?? null,
  world_state: worldStateForPrompt ?? null,
  campaign_context: campaignContextForPrompt ?? null,
}, 2200)}

- Board narrative samples:
${jsonInline(boardNarrativeSamples, 900)}

- Recent command execution context (authoritative client action result, may be null):
${jsonInline(actionContextRecord ?? null, 700)}

- Runtime warnings:
${jsonInline(warnings, 500)}

${styleProfilePrompt()}

RULES YOU MUST OBEY
- Grid is truth. Never invent positions, HP, items, skills.
- Determinism: if you reference a roll, it must be described as coming from action_events / compute_damage output.
- No dice UI; show rolls as comic visuals tied to the combat engine.
- Narration must be compact and high-signal: ${NARRATION_MIN_WORDS}-${NARRATION_MAX_WORDS} words total, max 2 short paragraphs.
- No filler, no recap padding, no repeated adjectives.
- Narration quality is primary. scene/effects should help render visual board state updates.
- If board_type is combat, narrate action-by-action from committed combat events in short lines (movement, hit, status, resource shifts).
- Never output generic combat filler such as "Resolved X non-player turn steps".
- Provide a non-empty runtime_delta object that pushes forward rumors/objectives/discovery state.
- Provide 2-4 grounded ui_actions tied to active board context (avoid generic labels like "Action 1").
- Do not use generic prompts like "continue/proceed/advance"; each prompt must reference current board pressure.
- Mirror those action candidates into runtime_delta.action_chips so dynamic actions persist after refresh.
- If command execution context is provided, narrate outcomes using that state delta and avoid contradiction.
- Violence/gore allowed. Harsh language allowed.
- Mild sexuality / playful sexy banter allowed.
- Sexual violence, coercion, rape, underage sexual content, and pornographic explicit content are forbidden.
${introPromptDirective}
${jsonOnlyContract()}
`;

      const requestedModel = "gpt-4o-mini";
      ctx.log.info("dm.request.start", {
        request_id: ctx.requestId,
        campaign_id: campaignId,
        user_id: user.userId,
        board_type: (compactBoard as Record<string, unknown> | null)?.board_type ?? null,
        has_character: Boolean(compactCharacter),
        has_combat: Boolean(compactCombat),
        model: requestedModel,
        provider: "openai",
        warning_count: warnings.length,
        intro_mode: introMode,
        intro_pending_before: introPendingBefore,
        prompt_chars: systemPrompt.length,
      });
      ctx.log.info("dm.intro.mode", {
        request_id: ctx.requestId,
        campaign_id: campaignId,
        intro_mode: introMode,
        intro_pending_before: introPendingBefore,
        intro_version: introVersion,
        intro_source: introSource,
      });

      const compactMessages = compactModelMessages(messages);
      const isFreeformNarrationTurn = actionContextRecord?.intent === "dm_prompt";
      const maxAttempts = introMode || isFreeformNarrationTurn ? 3 : 2;
      let lastErrors: string[] = [];
      let dmText = "";
      let dmParsed: ReturnType<typeof parseDmNarratorOutput> | null = null;
      let validationAttempts = 0;
      let dmRecoveryUsed = false;
      let dmRecoveryReason: string | null = null;
      let dmFastRecovery = false;
      let introCleared = false;
      const actionBoardType = (() => {
        const boardTypeFromPayload = typeof boardPayloadRecord?.board_type === "string"
          ? String(boardPayloadRecord.board_type)
          : "town";
        const hasCombatEventBatch = Array.isArray(actionContextRecord?.combat_event_batch)
          && actionContextRecord.combat_event_batch.length > 0;
        if (hasCombatEventBatch) return "combat";
        return boardTypeFromPayload;
      })();
      const fallbackVendorId = Array.from(allowedVendorIds.values())[0] ?? null;
      const buildIntroFallbackActions = (): NarratorUiAction[] => {
        const vendors = extractVendorsFromBoardSummary(boardSummaryRecord);
        const base: NarratorUiAction[] = [
          {
            id: "intro-opening-brief",
            label: "Read Local Briefing",
            intent: "dm_prompt",
            hint_key: "intro:opening_brief",
            prompt: "Open with the immediate threat, best leverage path, and first concrete move from board truth.",
            payload: { intro_opening: true, board_feature: "notice_board" },
          },
          {
            id: "intro-opening-travel",
            label: "Scout Outer Route",
            intent: "quest_action",
            boardTarget: "travel",
            hint_key: "intro:travel_probe",
            prompt: "I scout the outer route and pressure the first high-value lead.",
            payload: { intro_opening: true, mode: "travel", travel_probe: "scout_route" },
          },
          {
            id: "intro-opening-dungeon",
            label: "Press The Hotspot",
            intent: "quest_action",
            boardTarget: "dungeon",
            hint_key: "intro:dungeon_push",
            prompt: "I press the nearest hotspot and force an immediate consequence.",
            payload: { intro_opening: true, mode: "dungeon", search_target: "hotspot" },
          },
        ];
        if (vendors[0]) {
          base.splice(1, 0, {
            id: `intro-opening-shop-${vendors[0].id}`,
            label: `Check ${vendors[0].name}`,
            intent: "shop_action",
            hint_key: "intro:vendor_scan",
            payload: { vendorId: vendors[0].id, intro_opening: true },
            prompt: `I check ${vendors[0].name} for mission-critical supplies and leverage.`,
          });
        }
        return sanitizeUiActions({
          actions: base,
          boardType: actionBoardType,
          boardSummary: boardSummaryRecord,
        }).slice(0, 4);
      };
      const applyIntroTurnNormalization = (payload: DmNarratorOutput): DmNarratorOutput => {
        if (!introMode) return payload;

        const fallbackActions = buildIntroFallbackActions();
        const mergedActions = sanitizeUiActions({
          actions: [...(payload.ui_actions ?? []), ...fallbackActions],
          boardType: actionBoardType,
          boardSummary: boardSummaryRecord,
        });
        const dedupedActions: NarratorUiAction[] = [];
        const seenActionKeys = new Set<string>();
        for (const action of mergedActions) {
          const key = `${action.hint_key ?? action.id}:${action.intent}`;
          if (seenActionKeys.has(key)) continue;
          seenActionKeys.add(key);
          dedupedActions.push(action);
          if (dedupedActions.length >= 4) break;
        }
        let introActions = dedupedActions;
        if (introActions.length < 3) {
          introActions = fallbackActions.slice(0, 4);
        }

        const introScene = asObject(payload.scene) ?? {};
        const environment = typeof introScene.environment === "string"
          ? introScene.environment
          : typeof boardSummaryRecord?.weather === "string"
            ? boardSummaryRecord.weather
            : titleCaseWords(actionBoardType);
        const mood = typeof introScene.mood === "string" ? introScene.mood : "urgent onboarding momentum";
        const focus = typeof introScene.focus === "string"
          ? introScene.focus
          : "Immediate starter hooks and first tactical commitment.";
        const travelGoal = typeof introScene.travel_goal === "string"
          ? introScene.travel_goal
          : typeof boardSummaryRecord?.travel_goal === "string"
            ? boardSummaryRecord.travel_goal
            : null;

        const introRuntimeDeltaBase = asObject(payload.runtime_delta ?? payload.board_delta) ?? {};
        const introRumors = Array.isArray(introRuntimeDeltaBase.rumors) && introRuntimeDeltaBase.rumors.length > 0
          ? introRuntimeDeltaBase.rumors
          : [{ title: "Starter Pressure", detail: focus }];
        const introObjectives = Array.isArray(introRuntimeDeltaBase.objectives) && introRuntimeDeltaBase.objectives.length > 0
          ? introRuntimeDeltaBase.objectives
          : [{ title: "Make First Move", description: "Commit one starter action and lock initial momentum." }];
        const introDiscovery = Array.isArray(introRuntimeDeltaBase.discovery_log)
          ? [...introRuntimeDeltaBase.discovery_log]
          : [];
        if (introDiscovery.length === 0) {
          introDiscovery.push({
            kind: "intro_opening",
            detail: "Opening narration committed from seeded starter direction.",
            intro_version: introVersion,
          });
        }

        const existingDeltaFlags = asObject(introRuntimeDeltaBase.discovery_flags) ?? {};
        const normalizedFlags: Record<string, unknown> = {
          ...boardDiscoveryFlags,
          ...existingDeltaFlags,
          intro_pending: false,
          intro_version: introVersion,
          intro_source: introSource,
        };
        introCleared = normalizedFlags.intro_pending === false;

        return {
          ...payload,
          scene: {
            ...introScene,
            environment,
            mood,
            focus,
            travel_goal: travelGoal,
          },
          ui_actions: introActions,
          runtime_delta: {
            ...introRuntimeDeltaBase,
            rumors: introRumors,
            objectives: introObjectives,
            discovery_log: introDiscovery,
            discovery_flags: normalizedFlags,
            scene_cache: {
              ...(asObject(introRuntimeDeltaBase.scene_cache) ?? {}),
              environment,
              mood,
              focus,
              travel_goal: travelGoal,
            },
            action_chips: sanitizeUiActions({
              actions: introActions,
              boardType: actionBoardType,
              boardSummary: boardSummaryRecord,
            }).slice(0, 6),
          },
          board_delta: {
            ...introRuntimeDeltaBase,
            rumors: introRumors,
            objectives: introObjectives,
            discovery_log: introDiscovery,
            discovery_flags: normalizedFlags,
            scene_cache: {
              ...(asObject(introRuntimeDeltaBase.scene_cache) ?? {}),
              environment,
              mood,
              focus,
              travel_goal: travelGoal,
            },
            action_chips: sanitizeUiActions({
              actions: introActions,
              boardType: actionBoardType,
              boardSummary: boardSummaryRecord,
            }).slice(0, 6),
          },
        };
      };

      const shouldFastRecover = (attempt: number, errors: string[]) => {
        const minAttemptForRecovery = introMode || isFreeformNarrationTurn ? 3 : 2;
        if (attempt < minAttemptForRecovery) return false;
        const critical = errors.some((entry) =>
          entry.includes("runtime_delta_missing_or_invalid")
          || entry.includes("scene_missing_or_invalid")
          || entry.includes("ui_actions_count_out_of_bounds")
          || entry.includes("vendorId_invalid")
          || entry.includes("json_parse_failed")
          || entry.includes("invalid_json"),
        );
        if (critical) return true;
        if (attempt >= minAttemptForRecovery) {
          return errors.some((entry) => entry.includes("narration_word_count_out_of_bounds"));
        }
        return false;
      };

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        validationAttempts = attempt;
        const attemptMessages = (() => {
          if (attempt === 1) {
            return [{ role: "system" as const, content: systemPrompt }, ...compactMessages];
          }
          if (attempt === 2) {
            return [
              { role: "system" as const, content: systemPrompt },
              ...compactMessages,
              {
                role: "system" as const,
                content: `Validation errors on previous output: ${JSON.stringify(lastErrors).slice(0, 2400)}. Regenerate one valid JSON object that satisfies every contract field.`,
              },
            ];
          }
          return [
            { role: "system" as const, content: systemPrompt },
            ...compactMessages,
            {
              role: "system" as const,
              content: [
                "REPAIR PASS REQUIRED.",
                `Previous validation errors: ${JSON.stringify(lastErrors).slice(0, 2400)}.`,
                "Previous invalid JSON candidate (may be malformed):",
                dmText.slice(0, 3200),
                "Rewrite from scratch as ONE valid JSON object with scene + runtime_delta + 2-4 ui_actions.",
              ].join("\n"),
            },
          ];
        })();

        const { response, model } = await mythicOpenAIChatCompletionsStream(
          {
            messages: attemptMessages,
            stream: true,
            temperature: 0.55,
          },
          requestedModel,
        );
        dmText = await readModelStreamText(response);

        const parsedOut = parseDmNarratorOutput(dmText);
        if (!parsedOut.ok) {
          lastErrors = parsedOut.errors;
          ctx.log.warn("dm.request.validation_failed", { attempt, model, request_id: ctx.requestId, errors: lastErrors });
          dmParsed = parsedOut;
          if (shouldFastRecover(attempt, lastErrors)) {
            dmFastRecovery = true;
            break;
          }
          continue;
        }

        const narrationWords = countWords(parsedOut.value.narration);
        if (narrationWords > NARRATION_MAX_WORDS + 34 || narrationWords < Math.max(20, NARRATION_MIN_WORDS - 26)) {
          lastErrors = [`narration_word_count_out_of_bounds:${narrationWords}:expected_${NARRATION_MIN_WORDS}-${NARRATION_MAX_WORDS}`];
          ctx.log.warn("dm.request.validation_failed", { attempt, model, request_id: ctx.requestId, errors: lastErrors });
          dmParsed = { ok: false, errors: lastErrors };
          if (shouldFastRecover(attempt, lastErrors)) {
            dmFastRecovery = true;
            break;
          }
          continue;
        }

        if (!parsedOut.value.scene || typeof parsedOut.value.scene !== "object") {
          lastErrors = ["scene_missing_or_invalid"];
          ctx.log.warn("dm.request.validation_failed", { attempt, model, request_id: ctx.requestId, errors: lastErrors });
          dmParsed = { ok: false, errors: lastErrors };
          if (shouldFastRecover(attempt, lastErrors)) {
            dmFastRecovery = true;
            break;
          }
          continue;
        }

        const deltaPayload = asObject(parsedOut.value.runtime_delta ?? parsedOut.value.board_delta);
        if (!deltaPayload) {
          lastErrors = ["runtime_delta_missing_or_invalid"];
          ctx.log.warn("dm.request.validation_failed", { attempt, model, request_id: ctx.requestId, errors: lastErrors });
          dmParsed = { ok: false, errors: lastErrors };
          if (shouldFastRecover(attempt, lastErrors)) {
            dmFastRecovery = true;
            break;
          }
          continue;
        }

        let actions: NarratorUiAction[] = sanitizeUiActions({
          actions: parsedOut.value.ui_actions ?? [],
          boardType: actionBoardType,
          boardSummary: boardSummaryRecord,
        })
          .map((action): NarratorUiAction => {
            if (action.intent !== "shop_action") return action;
            const payload = action.payload && typeof action.payload === "object" ? action.payload as Record<string, unknown> : {};
            const vendorId = typeof payload.vendorId === "string" ? payload.vendorId : null;
            if (vendorId && allowedVendorIds.has(vendorId)) return action;
            if (fallbackVendorId) {
              return {
                ...action,
                payload: { ...payload, vendorId: fallbackVendorId },
              } as NarratorUiAction;
            }
            return {
              ...action,
              intent: "dm_prompt" as const,
              label: "Work A Lead",
              prompt: action.prompt ?? "I press a concrete lead from current runtime hooks and commit the next move.",
              payload: { ...payload, vendor_unavailable: true },
            } as NarratorUiAction;
          });

        const checkin = latestCompanionCheckin(boardStateRecord);
        if (checkin && !isCompanionFollowupResolved(boardStateRecord, checkin)) {
          const hasCompanionAction = actions.some((action) => {
            const payload = action.payload && typeof action.payload === "object" ? action.payload as Record<string, unknown> : null;
            return payload?.companion_id === checkin.companion_id && payload?.resolved !== true;
          });
          if (!hasCompanionAction && actions.length < 4) {
            actions = [...actions, buildCompanionFollowupAction(checkin)];
          }
        }

        actions = sanitizeUiActions({
          actions,
          boardType: actionBoardType,
          boardSummary: boardSummaryRecord,
        }).slice(0, 4);

        if (actions.length < 2 || actions.length > 4) {
          lastErrors = [`ui_actions_count_out_of_bounds:${actions.length}:expected_2_4`];
          ctx.log.warn("dm.request.validation_failed", { attempt, model, request_id: ctx.requestId, errors: lastErrors });
          dmParsed = { ok: false, errors: lastErrors };
          if (shouldFastRecover(attempt, lastErrors)) {
            dmFastRecovery = true;
            break;
          }
          continue;
        }

        // Additional validation: if suggesting shop actions, vendorId must match board summary.
        const badShop = actions.find((action) => {
          if (action.intent !== "shop_action") return false;
          const vendorId = (action.payload as Record<string, unknown> | undefined)?.vendorId;
          return typeof vendorId !== "string" || !allowedVendorIds.has(vendorId);
        });
        if (badShop) {
          const vendorId = (badShop.payload as Record<string, unknown> | undefined)?.vendorId;
          lastErrors = [`ui_actions.shop.vendorId_invalid:${typeof vendorId === "string" ? vendorId : "missing"}`];
          ctx.log.warn("dm.request.validation_failed", { attempt, model, request_id: ctx.requestId, errors: lastErrors });
          dmParsed = { ok: false, errors: lastErrors };
          if (shouldFastRecover(attempt, lastErrors)) {
            dmFastRecovery = true;
            break;
          }
          continue;
        }

        let boardDeltaActionChips = sanitizeUiActions({
          actions: (deltaPayload.action_chips as NarratorUiAction[] | undefined) ?? actions,
          boardType: actionBoardType,
          boardSummary: boardSummaryRecord,
        });

        const checkinForChips = latestCompanionCheckin(boardStateRecord);
        if (checkinForChips && !isCompanionFollowupResolved(boardStateRecord, checkinForChips)) {
          const hasCompanionChip = boardDeltaActionChips.some((chip) => {
            const payload = chip.payload && typeof chip.payload === "object" ? chip.payload as Record<string, unknown> : null;
            return payload?.companion_id === checkinForChips.companion_id && payload?.resolved !== true;
          });
          if (!hasCompanionChip) {
            boardDeltaActionChips = [...boardDeltaActionChips.slice(0, 5), buildCompanionFollowupAction(checkinForChips)];
          }
        }

        boardDeltaActionChips = appendCompanionResolutionChip({
          chips: boardDeltaActionChips,
          actionContext: actionContextRecord,
        }).slice(-6);

        const runtimeDelta = {
          ...deltaPayload,
          action_chips: boardDeltaActionChips,
        };
        const normalizedPayload = applyIntroTurnNormalization({
          ...parsedOut.value,
          ui_actions: actions,
          runtime_delta: runtimeDelta,
          board_delta: runtimeDelta,
        });
        dmParsed = {
          ok: true,
          value: normalizedPayload,
        };
        break;
      }

      if (!dmParsed || !dmParsed.ok) {
        dmRecoveryUsed = true;
        dmRecoveryReason = dmFastRecovery
          ? `fast_recovery:${lastErrors.join("|").slice(0, 360)}`
          : lastErrors.join("|").slice(0, 400) || "validation_failed";
        ctx.log.warn("dm.request.auto_recovery", {
          request_id: ctx.requestId,
          validation_attempts: validationAttempts,
          reason: dmRecoveryReason,
          fast_recovery: dmFastRecovery,
        });
        dmParsed = {
          ok: true,
          value: applyIntroTurnNormalization(synthesizeRecoveryPayload({
            boardType: actionBoardType,
            boardSummary: boardSummaryRecord,
            boardState: boardStateRecord,
            actionContext: actionContextRecord,
            lastErrors,
          })),
        };
      }

      if (dmParsed.ok) {
        const suppressNarrationOnError = actionContextRecord?.suppress_narration_on_error === true
          && typeof actionContextRecord?.execution_error === "string"
          && actionContextRecord.execution_error.trim().length > 0;
        if (suppressNarrationOnError) {
          dmParsed.value.narration = sanitizeNarrationForPlayer(
            `Action blocked: ${compactLabel(String(actionContextRecord.execution_error), 180)}. Choose a legal move and try again.`,
            String(actionBoardType || "combat"),
          );
        }

        const contextCursor = parseEventCursor(actionContextRecord?.combat_event_cursor);
        const presentationCurrent = readPresentationState(boardStateRecord);
        const presentationCursor = parseEventCursor(presentationCurrent.last_event_cursor ?? null);
        const effectiveCursor = contextCursor ?? presentationCursor;
        const combatantStateHint = readCombatantStateHint(actionContextRecord?.combatant_state);
        const combatBatch = Array.isArray(actionContextRecord?.combat_event_batch)
          ? actionContextRecord.combat_event_batch
            .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object")
            .filter((entry) => isBatchEventAfterCursor(entry, effectiveCursor))
            .filter((entry) => {
              const payload = asObject(entry.payload) ?? {};
              const eventType = typeof entry.event_type === "string" ? entry.event_type.toLowerCase() : "";
              if (eventType === "death") return true;
              const actorId = typeof payload.source_combatant_id === "string"
                ? payload.source_combatant_id
                : typeof payload.actor_combatant_id === "string"
                  ? payload.actor_combatant_id
                  : typeof entry.actor_combatant_id === "string"
                    ? entry.actor_combatant_id
                    : null;
              if (!actorId) return true;
              const hinted = combatantStateHint[actorId];
              if (!hinted) return true;
              return hinted.is_alive && hinted.hp > 0;
            })
            .slice(-10)
          : [];
        if (combatBatch.length > 0) {
          const tone = selectToneMode({
            seedKey: `${campaignId}:${expectedTurnIndex}:combat-step`,
            lastTone: presentationCurrent.last_tone ?? null,
            tension: 62,
            bossPresent: combatBatch.some((entry) => asObject(entry.payload)?.boss === true),
            playerHpPct: 0.62,
            regionTheme: "combat",
          });
          const middleware = buildNarrativeLinesFromEvents({
            seedKey: `${campaignId}:${expectedTurnIndex}:combat-step`,
            tone: tone.tone,
            events: combatBatch as Array<{ event_type: string; payload?: Record<string, unknown> }>,
            recentLineHashes: presentationCurrent.recent_line_hashes ?? [],
            recentVerbKeys: presentationCurrent.last_verb_keys ?? [],
            maxLines: 4,
          });
          const generatedNarration = sanitizeNarrationForPlayer(
            middleware.lines.join(" "),
            "combat",
          );
          const hasLeak = NON_PLAYER_NARRATION_PATTERNS.some((pattern) => {
            pattern.lastIndex = 0;
            return pattern.test(dmParsed.value.narration);
          })
            || /\bA combatant\b/i.test(dmParsed.value.narration);
          if (hasLeak || generatedNarration.length > 0) {
            dmParsed.value.narration = generatedNarration;
          }

          const mergedPresentation = mergePresentationState(presentationCurrent, {
            last_tone: tone.tone,
            recent_line_hashes: middleware.lineHashes,
            last_verb_keys: middleware.verbKeys,
            last_template_ids: middleware.templateIds,
            last_event_cursor: middleware.lastEventCursor ?? presentationCurrent.last_event_cursor ?? null,
          });
          const delta = asObject(dmParsed.value.runtime_delta ?? dmParsed.value.board_delta) ?? {};
          dmParsed.value.runtime_delta = {
            ...delta,
            dm_presentation: { ...mergedPresentation },
          };
          dmParsed.value.board_delta = {
            ...delta,
            dm_presentation: { ...mergedPresentation },
          };
        }
      }

      const boardType = (compactBoard as Record<string, unknown> | null)?.board_type;
      const boardId = (compactBoard as Record<string, unknown> | null)?.board_id;
      if (typeof boardType !== "string" || typeof boardId !== "string") {
        return new Response(JSON.stringify({ error: "Active runtime not found", code: "runtime_not_found", requestId: ctx.requestId }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { patches, dropped } = normalizeWorldPatches(dmParsed.value.patches);
      if (dropped > 0) {
        warnings.push(`dropped_invalid_patches:${dropped}`);
      }

      const dmRequestJson = {
        schema_version: "mythic.turn.request.v1",
        campaign_id: campaignId,
        player_id: user.userId,
        board_id: boardId,
        board_type: boardType,
        expected_turn_index: expectedTurnIndex,
        turn_seed: turnSeed.toString(),
        model: requestedModel,
        messages,
        actionContext: actionContextRecord ?? null,
        warnings,
      };

      const dmResponseJson: Record<string, unknown> = {
        ...dmParsed.value,
        narration: compactNarration(
          sanitizeNarrationForPlayer(dmParsed.value.narration, String(boardType)),
          NARRATION_MAX_WORDS,
        ),
        schema_version: dmParsed.value.schema_version ?? "mythic.dm.narrator.v1",
        roll_log: prng.rollLog,
        meta: {
          dm_validation_attempts: validationAttempts,
          dm_recovery_used: dmRecoveryUsed,
          dm_recovery_reason: dmRecoveryReason,
          dm_intro_mode: introMode,
          dm_intro_pending_before: introPendingBefore,
          dm_intro_cleared: introCleared,
        },
        turn: {
          expected_turn_index: expectedTurnIndex,
          turn_seed: turnSeed.toString(),
        },
      };

      const commit = await svc.rpc("mythic_commit_turn", {
        campaign_id: campaignId,
        player_id: user.userId,
        board_id: boardId,
        board_type: boardType,
        turn_seed: turnSeed.toString(),
        dm_request_json: dmRequestJson,
        dm_response_json: dmResponseJson,
        patches_json: patches,
        roll_log_json: prng.rollLog,
      });

      if (commit.error) {
        ctx.log.error("dm.turn_commit.failed", {
          request_id: ctx.requestId,
          campaign_id: campaignId,
          hint: errMessage(commit.error, "commit failed"),
          code: (commit.error as { code?: unknown }).code ?? null,
        });
        const msg = errMessage(commit.error, "unknown");
        const isConflict = String((commit.error as { code?: unknown }).code ?? "").includes("40001")
          || msg.includes("expected_turn_index_")
          || msg.includes("40001");
        return new Response(
          JSON.stringify({
            error: isConflict
              ? "Another turn committed concurrently. Retry your action."
              : `Failed to commit turn: ${msg}`,
            code: isConflict ? "turn_conflict" : "turn_commit_failed",
            requestId: ctx.requestId,
          }),
          { status: isConflict ? 409 : 500, headers: { "Content-Type": "application/json" } },
        );
      }

      const commitPayload = commit.data && typeof commit.data === "object" ? commit.data as Record<string, unknown> : null;
      if (commitPayload?.ok !== true) {
        ctx.log.error("dm.turn_commit.rejected", { request_id: ctx.requestId, commit: commitPayload });
        return new Response(
          JSON.stringify({
            error: "Turn commit rejected",
            code: "turn_commit_rejected",
            details: commitPayload,
            requestId: ctx.requestId,
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }

      let committedBoardState = boardStateRecord;
      const committedRuntimeId =
        typeof commitPayload.runtime_id === "string"
          ? commitPayload.runtime_id
          : typeof commitPayload.board_id === "string"
            ? commitPayload.board_id
            : null;
      if (committedRuntimeId) {
        const committedRuntime = await svc
          .schema("mythic")
          .from("campaign_runtime")
          .select("state_json")
          .eq("id", committedRuntimeId)
          .maybeSingle();
        if (!committedRuntime.error && committedRuntime.data) {
          committedBoardState = asObject((committedRuntime.data as Record<string, unknown>).state_json);
        }
      }

      const rewardSummary = await applyDeterministicStoryReward({
        svc,
        campaignId,
        playerId: user.userId,
        boardType: boardType,
        turnId: typeof commitPayload.turn_id === "string" ? commitPayload.turn_id : null,
        turnSeed: turnSeed.toString(),
        actionContext: actionContextRecord,
        boardState: committedBoardState,
        boardDelta: asObject(dmParsed.value.runtime_delta ?? dmParsed.value.board_delta),
        requestId: ctx.requestId,
        log: ctx.log,
      });

      dmResponseJson.meta = {
        ...(typeof dmResponseJson.meta === "object" && dmResponseJson.meta ? dmResponseJson.meta : {}),
        turn_id: commitPayload.turn_id ?? null,
        turn_index: commitPayload.turn_index ?? expectedTurnIndex,
        turn_seed: turnSeed.toString(),
        world_time: commitPayload.world_time ?? null,
        heat: commitPayload.heat ?? null,
        reward_summary: rewardSummary,
        world_forge_version: worldForgeVersion,
        world_tick: Number(
          worldStateForPrompt?.tick
            ?? asObject(worldSummaryForPrompt?.world_state)?.tick
            ?? Number.NaN,
        ),
      };

      ctx.log.info("dm.request.completed", {
        request_id: ctx.requestId,
        campaign_id: campaignId,
        turn_id: commitPayload.turn_id ?? null,
        turn_index: commitPayload.turn_index ?? expectedTurnIndex,
        dm_validation_attempts: validationAttempts,
        dm_recovery_used: dmRecoveryUsed,
        dm_recovery_reason: dmRecoveryReason,
        dm_intro_mode: introMode,
        dm_intro_pending_before: introPendingBefore,
        dm_intro_cleared: introCleared,
        story_reward_applied: rewardSummary.applied,
        story_reward_xp: rewardSummary.xp_awarded,
        story_reward_loot_item_id: rewardSummary.loot_item_id,
        story_reward_reason: rewardSummary.reason,
      });
      if (introMode) {
        ctx.log.info("dm.intro.cleared", {
          request_id: ctx.requestId,
          campaign_id: campaignId,
          intro_pending_before: introPendingBefore,
          intro_cleared: introCleared,
          turn_id: commitPayload.turn_id ?? null,
        });
      }

      const outText = JSON.stringify(dmResponseJson);
      const response = new Response(streamOpenAiDelta(outText), {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "x-request-id": ctx.requestId,
        },
      });
      if (idempotencyKey) {
        storeIdempotentResponse(idempotencyKey, response, DM_IDEMPOTENCY_TTL_MS);
      }
      return response;
    } catch (error) {
      if (error instanceof AuthError) {
        const code = error.code === "auth_required" ? "auth_required" : "auth_invalid";
        const message = code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code, requestId: ctx.requestId }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("dm.request.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      const code = errCode(error) ?? normalized.code ?? "dm_request_failed";
      const message = errMessage(error, normalized.message || "Failed to reach Mythic DM");
      const status = errStatus(error) ?? (code === "openai_not_configured" ? 503 : 500);
      return new Response(
        JSON.stringify({
          error: message,
          status,
          code,
          details: errDetails(error),
          requestId: ctx.requestId,
        }),
        { status, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
