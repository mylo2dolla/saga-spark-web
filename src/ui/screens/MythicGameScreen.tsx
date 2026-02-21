import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/hooks/useAuth";
import { useMythicCreator } from "@/hooks/useMythicCreator";
import { useMythicBoard } from "@/hooks/useMythicBoard";
import { useMythicCharacter } from "@/hooks/useMythicCharacter";
import { useMythicDmContext } from "@/hooks/useMythicDmContext";
import {
  useMythicDungeonMaster,
  type MythicUiAction,
} from "@/hooks/useMythicDungeonMaster";
import { useMythicDmVoice } from "@/hooks/useMythicDmVoice";
import { useMythicCombat } from "@/hooks/useMythicCombat";
import { useMythicCombatState } from "@/hooks/useMythicCombatState";
import { callEdgeFunction } from "@/lib/edge";
import { sumStatMods, splitInventory, type MythicInventoryRow } from "@/lib/mythicEquipment";
import { parsePlayerCommand, type PlayerCommandPanel } from "@/lib/mythic/playerCommandParser";
import { executePlayerCommand } from "@/lib/mythic/playerCommandExecutor";
import { useMythicDevSurfaces } from "@/lib/mythic/featureFlags";
import { buildSkillAvailability } from "@/lib/mythic/skillAvailability";
import { createLogger } from "@/lib/observability/logger";
import { parseEdgeError } from "@/lib/edgeError";
import { toast } from "sonner";
import { BookShell } from "@/ui/components/mythic/BookShell";
import { NarrativePage } from "@/ui/components/mythic/NarrativePage";
import { ShopDialog } from "@/ui/components/mythic/ShopDialog";
import { SettingsPanel, type MythicRuntimeSettings } from "@/ui/components/mythic/SettingsPanel";
import { actionSignature as boardActionSignature } from "@/ui/components/mythic/board2/actionBuilders";
import { buildNarrativeBoardScene } from "@/ui/components/mythic/board2/adapters";
import { NarrativeBoardPage } from "@/ui/components/mythic/board2/NarrativeBoardPage";
import type { CombatPaceStateModel, CombatRewardSummaryModel } from "@/ui/components/mythic/board2/types";
import { CharacterSheetSurface } from "@/ui/components/mythic/character2/CharacterSheetSurface";
import { buildCharacterProfilePatch, buildCharacterSheetViewModel } from "@/ui/components/mythic/character2/adapters";
import type {
  CharacterProfileDraft,
  CharacterSheetSaveState,
  CharacterSheetSection,
} from "@/ui/components/mythic/character2/types";

type MythicPanelTab = "status" | "skills" | "combat" | "quests" | "companions" | "shop";
type MythicUtilityTab = "panels" | "settings" | "logs" | "diagnostics";
const MYTHIC_SETTINGS_STORAGE_KEY = "mythic:settings:v1";
const DEFAULT_MYTHIC_SETTINGS: MythicRuntimeSettings = {
  compactNarration: true,
  animationIntensity: "normal",
  chatAutoFollow: true,
};

function summarizeBoardHooks(state: unknown): Array<{ id: string; title: string; detail: string | null }> {
  const payload = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  const rawRumors = Array.isArray(payload.rumors) ? payload.rumors : [];
  const rawObjectives = Array.isArray(payload.objectives) ? payload.objectives : [];
  const rawDiscovery = Array.isArray(payload.discovery_log) ? payload.discovery_log : [];
  const rawCheckins = Array.isArray(payload.companion_checkins) ? payload.companion_checkins : [];
  const rawJobs = Array.isArray(payload.job_postings) ? payload.job_postings : [];
  const roomState = payload.room_state && typeof payload.room_state === "object" ? payload.room_state as Record<string, unknown> : {};
  const roomStateHooks = Object.entries(roomState).map(([roomId, value]) => {
    const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      id: `room:${roomId}`,
      title: `Room ${roomId}`,
      detail: [
        typeof row.status === "string" ? `status ${row.status}` : null,
        typeof row.last_action === "string" ? `action ${row.last_action}` : null,
      ].filter((entry): entry is string => Boolean(entry)).join(" · "),
    };
  });
  const hooks = [...rawRumors, ...rawObjectives, ...rawDiscovery, ...rawJobs, ...rawCheckins, ...roomStateHooks];
  const out: Array<{ id: string; title: string; detail: string | null }> = [];
  for (let idx = 0; idx < hooks.length; idx += 1) {
    const entry = hooks[idx];
    if (typeof entry === "string") {
      const text = entry.trim();
      if (!text) continue;
      out.push({ id: `hook:${idx}`, title: text.slice(0, 80), detail: text.length > 80 ? text.slice(80) : null });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const title = typeof raw.title === "string"
      ? raw.title
      : typeof raw.name === "string"
        ? raw.name
        : typeof raw.label === "string"
          ? raw.label
          : typeof raw.kind === "string"
            ? String(raw.kind).replace(/_/g, " ")
            : typeof raw.hook_type === "string"
              ? String(raw.hook_type).replace(/_/g, " ")
              : null;
    const detail = typeof raw.description === "string"
      ? raw.description
      : typeof raw.detail === "string"
        ? raw.detail
        : typeof raw.prompt === "string"
          ? raw.prompt
          : typeof raw.line === "string"
            ? raw.line
            : null;
    if (!title && !detail) continue;
    out.push({
      id: `hook:${idx}`,
      title: title ?? (detail ? detail.slice(0, 80) : "Story Hook"),
      detail,
    });
  }
  return out.slice(0, 16);
}

function normalizeReasonCode(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token.length > 0 ? token : "story_progression";
}

function mapPanelTab(panel: string | undefined): MythicPanelTab | null {
  if (!panel) return null;
  if (panel === "status" || panel === "character" || panel === "progression") return "status";
  if (panel === "loadout" || panel === "loadouts" || panel === "gear") return "skills";
  if (panel === "skills") return "skills";
  if (panel === "combat") return "combat";
  if (panel === "quests") return "quests";
  if (panel === "companions") return "companions";
  if (panel === "shop") return "shop";
  return null;
}

function mapCharacterSheetSection(panel: string | undefined): CharacterSheetSection {
  if (panel === "combat") return "combat";
  if (panel === "quests") return "quests";
  if (panel === "companions") return "party";
  if (panel === "gear" || panel === "equipment") return "equipment";
  if (panel === "skills" || panel === "loadout" || panel === "loadouts") return "skills";
  return "overview";
}

function loadMythicSettings(): MythicRuntimeSettings {
  if (typeof window === "undefined") return DEFAULT_MYTHIC_SETTINGS;
  try {
    const raw = window.localStorage.getItem(MYTHIC_SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_MYTHIC_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<MythicRuntimeSettings>;
    const animationIntensity = parsed.animationIntensity === "low" || parsed.animationIntensity === "normal" || parsed.animationIntensity === "high"
      ? parsed.animationIntensity
      : DEFAULT_MYTHIC_SETTINGS.animationIntensity;
    return {
      compactNarration: parsed.compactNarration !== false,
      animationIntensity,
      chatAutoFollow: parsed.chatAutoFollow !== false,
    };
  } catch {
    return DEFAULT_MYTHIC_SETTINGS;
  }
}

function profileDraftFromCharacter(character: { name: string; class_json: Record<string, unknown> | null }): CharacterProfileDraft {
  const classJson = character.class_json && typeof character.class_json === "object"
    ? character.class_json
    : {};
  const profile = classJson.profile && typeof classJson.profile === "object"
    ? classJson.profile as Record<string, unknown>
    : {};
  return {
    name: typeof character.name === "string" ? character.name : "Adventurer",
    callsign: typeof profile.callsign === "string" ? profile.callsign : "",
    pronouns: typeof profile.pronouns === "string" ? profile.pronouns : "",
    originNote: typeof profile.origin_note === "string" ? profile.origin_note : "",
  };
}

const MAX_CONSOLE_ACTIONS = 6;
const DM_ACTION_TIMEOUT_MS = 110_000;
const AUTO_TICK_MAX_STEPS = 1;
const AUTO_TICK_VOICE_DEADLOCK_MS = 12_000;
const AUTO_TICK_MIN_STEP_GAP_MS = 1_800;
const LOW_SIGNAL_ACTION_LABEL = /^(action\s+\d+|narrative update)$/i;
const LOW_SIGNAL_NARRATION_PROMPT = /^(continue|proceed|advance|next(\s+(step|move))?|refresh(\s+state)?|narrate|describe)(\b|[\s.,])/i;
const screenLogger = createLogger("mythic-game-screen");

type UnifiedActionSource =
  | "typed_command"
  | "console_action"
  | "board_hotspot"
  | "combat_skill"
  | "combat_quick_cast"
  | "combat_enemy_tick";

type CombatAutoPacePhase = "idle" | "step_committed" | "narrating" | "waiting_voice_end" | "next_step_ready";

type BoardBaseActionSource = "assistant" | "runtime" | "companion" | "fallback";
type CombatResolutionPendingState = {
  pending: true;
  combatSessionId: string | null;
  returnMode: "town" | "travel" | "dungeon";
  won: boolean;
  xpGained: number;
  loot: string[];
  endedAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseCombatResolutionPending(state: Record<string, unknown>): CombatResolutionPendingState | null {
  const row = asRecord(state.combat_resolution);
  if (!row || row.pending !== true) return null;
  const returnModeRaw = typeof row.return_mode === "string" ? row.return_mode.trim().toLowerCase() : "";
  const returnMode = returnModeRaw === "travel" || returnModeRaw === "dungeon" || returnModeRaw === "town"
    ? returnModeRaw
    : "town";
  const loot = Array.isArray(row.loot)
    ? row.loot.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter((entry) => entry.length > 0).slice(0, 8)
    : [];
  const xpGainedRaw = Number(row.xp_gained ?? 0);
  return {
    pending: true,
    combatSessionId: typeof row.combat_session_id === "string" ? row.combat_session_id : null,
    returnMode,
    won: row.won === true,
    xpGained: Number.isFinite(xpGainedRaw) ? Math.max(0, Math.floor(xpGainedRaw)) : 0,
    loot,
    endedAt: typeof row.ended_at === "string" ? row.ended_at : null,
  };
}

function isUiIntent(value: string): value is MythicUiAction["intent"] {
  return value === "quest_action"
    || value === "combat_action"
    || value === "shop_action"
    || value === "companion_action"
    || value === "town"
    || value === "travel"
    || value === "dungeon"
    || value === "combat_start"
    || value === "shop"
    || value === "focus_target"
    || value === "open_panel"
    || value === "dm_prompt"
    || value === "refresh";
}

function resolvedModeFromAction(action: MythicUiAction, fallbackMode: "town" | "travel" | "dungeon" | "combat"): "town" | "travel" | "dungeon" | "combat" {
  const payloadModeRaw = String((action.payload as Record<string, unknown> | undefined)?.mode ?? "").trim().toLowerCase();
  if (payloadModeRaw === "town" || payloadModeRaw === "travel" || payloadModeRaw === "dungeon" || payloadModeRaw === "combat") {
    return payloadModeRaw;
  }
  if (action.boardTarget === "town" || action.boardTarget === "travel" || action.boardTarget === "dungeon" || action.boardTarget === "combat") {
    return action.boardTarget;
  }
  return fallbackMode;
}

function resolveActionIntent(action: MythicUiAction, currentMode: "town" | "travel" | "dungeon" | "combat"): Exclude<MythicUiAction["intent"], "quest_action" | "combat_action" | "shop_action" | "companion_action"> {
  if (action.intent === "quest_action") {
    const targetMode = resolvedModeFromAction(action, currentMode);
    if (targetMode === "town" || targetMode === "travel" || targetMode === "dungeon") return targetMode;
    return "dm_prompt";
  }
  if (action.intent === "combat_action") {
    const hasTarget = typeof (action.payload as Record<string, unknown> | undefined)?.target_combatant_id === "string";
    return hasTarget ? "focus_target" : "dm_prompt";
  }
  if (action.intent === "shop_action") return "shop";
  if (action.intent === "companion_action") return "dm_prompt";
  return action.intent;
}

function normalizeUiActionFromUnknown(entry: unknown, fallbackId: string): MythicUiAction | null {
  const raw = asRecord(entry);
  if (!raw) return null;
  const rawIntent = String(raw.intent ?? "").trim().toLowerCase();
  const normalizedIntent = rawIntent === "loadout_action" || rawIntent === "loadout" || rawIntent === "gear"
    ? "open_panel"
    : rawIntent;
  if (!isUiIntent(normalizedIntent)) return null;
  const label = typeof raw.label === "string" && raw.label.trim().length > 0 ? raw.label.trim() : fallbackId;
  const boardTargetRaw = String(raw.boardTarget ?? raw.board_target ?? "").trim().toLowerCase();
  const boardTarget = boardTargetRaw === "town" || boardTargetRaw === "travel" || boardTargetRaw === "dungeon" || boardTargetRaw === "combat"
    ? boardTargetRaw
    : undefined;
  const panelRaw = String(raw.panel ?? "").trim().toLowerCase();
  const panelNormalized = panelRaw === "loadout" || panelRaw === "loadouts"
    ? "skills"
    : panelRaw === "gear"
      ? "equipment"
      : panelRaw;
  const panel = panelNormalized === "status" || panelNormalized === "character" || panelNormalized === "equipment" || panelNormalized === "skills" || panelNormalized === "progression" || panelNormalized === "quests" || panelNormalized === "combat" || panelNormalized === "companions" || panelNormalized === "shop" || panelNormalized === "commands" || panelNormalized === "settings"
    ? panelNormalized
    : undefined;
  const prompt = typeof raw.prompt === "string" && raw.prompt.trim().length > 0 ? raw.prompt.trim() : undefined;
  const payload = asRecord(raw.payload) ?? undefined;
  return {
    id: typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : fallbackId,
    label,
    intent: normalizedIntent,
    boardTarget,
    panel,
    prompt,
    payload,
  };
}

function normalizeConsoleActionLabel(action: MythicUiAction): MythicUiAction {
  const label = action.label.trim();
  if (!LOW_SIGNAL_ACTION_LABEL.test(label)) return action;
  const next = action.prompt?.trim() || label;
  return { ...action, label: next.length > 42 ? `${next.slice(0, 42).trim()}...` : next };
}

function actionTargetSignature(action: MythicUiAction): string {
  return boardActionSignature(action);
}

function dedupeConsoleActions(candidates: MythicUiAction[]): MythicUiAction[] {
  const unique: MythicUiAction[] = [];
  const seen = new Set<string>();
  for (const entry of candidates) {
    const normalized = normalizeConsoleActionLabel(entry);
    if (LOW_SIGNAL_ACTION_LABEL.test(normalized.label.trim())) continue;
    const key = actionTargetSignature(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
    if (unique.length >= MAX_CONSOLE_ACTIONS) break;
  }
  return unique;
}

function buildBoardBaseActions(args: {
  assistantActions: MythicUiAction[];
  runtimeActions: MythicUiAction[];
  companionAction: MythicUiAction | null;
  fallbackActions: MythicUiAction[];
}): { actions: MythicUiAction[]; sourceBySignature: Record<string, BoardBaseActionSource> } {
  const sourceBySignature: Record<string, BoardBaseActionSource> = {};
  const merged: MythicUiAction[] = [];
  const push = (source: BoardBaseActionSource, actions: MythicUiAction[]) => {
    actions.forEach((action) => {
      const signature = actionTargetSignature(action);
      if (!sourceBySignature[signature]) {
        sourceBySignature[signature] = source;
      }
      merged.push(action);
    });
  };

  push("assistant", args.assistantActions);
  push("runtime", args.runtimeActions);
  if (args.companionAction) {
    push("companion", [args.companionAction]);
  }
  push("fallback", args.fallbackActions);

  return {
    actions: dedupeConsoleActions(merged),
    sourceBySignature,
  };
}

function isExpectedDmCancellationError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("operation cancelled")
    || normalized.includes("request cancelled")
    || normalized.includes("dm request cancelled")
    || normalized.includes("aborterror")
    || normalized.includes("aborted");
}

function isLowSignalNarrationPrompt(prompt: string): boolean {
  const clean = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  if (!clean) return true;
  if (LOW_SIGNAL_NARRATION_PROMPT.test(clean) && clean.length < 80) return true;
  return false;
}

function isMechanicalExecutionError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("not your turn")
    || normalized.includes("target out of range")
    || normalized.includes("line of sight blocked")
    || normalized.includes("cannot move to selected tile")
    || normalized.includes("no valid target")
    || normalized.includes("no valid targets in area")
    || normalized.includes("failed (409)")
    || normalized.includes("mythic-combat-use-skill failed")
    || normalized.includes("mythic-combat-tick failed");
}

function enrichCombatEventBatchForNarration(
  events: unknown,
  combatants: Array<{ id: string; name: string }>,
): Array<Record<string, unknown>> {
  if (!Array.isArray(events) || events.length === 0) return [];
  const combatantNames = new Map<string, string>();
  combatants.forEach((entry) => {
    const id = entry.id.trim();
    const name = entry.name.trim();
    if (!id || !name) return;
    combatantNames.set(id, name);
  });
  return events
    .map((entry) => {
      const row = asRecord(entry);
      if (!row) return null;
      const payload = asRecord(row.payload) ?? {};
      const actorId = (
        typeof payload.source_combatant_id === "string" && payload.source_combatant_id.trim().length > 0
          ? payload.source_combatant_id
          : typeof payload.actor_combatant_id === "string" && payload.actor_combatant_id.trim().length > 0
            ? payload.actor_combatant_id
            : typeof row.actor_combatant_id === "string" && row.actor_combatant_id.trim().length > 0
              ? row.actor_combatant_id
              : null
      );
      const targetId = (
        typeof payload.target_combatant_id === "string" && payload.target_combatant_id.trim().length > 0
          ? payload.target_combatant_id
          : null
      );
      const actorName = (
        typeof payload.source_name === "string" && payload.source_name.trim().length > 0
          ? payload.source_name.trim()
          : typeof payload.actor_name === "string" && payload.actor_name.trim().length > 0
            ? payload.actor_name.trim()
            : (actorId ? (combatantNames.get(actorId) ?? null) : null)
      );
      const targetName = (
        typeof payload.target_name === "string" && payload.target_name.trim().length > 0
          ? payload.target_name.trim()
          : (targetId ? (combatantNames.get(targetId) ?? null) : null)
      );
      return {
        ...row,
        payload: {
          ...payload,
          source_combatant_id: actorId ?? payload.source_combatant_id ?? null,
          actor_combatant_id: actorId ?? payload.actor_combatant_id ?? null,
          target_combatant_id: targetId ?? payload.target_combatant_id ?? null,
          source_name: actorName ?? null,
          actor_name: actorName ?? null,
          target_name: targetName ?? null,
        },
      };
    })
    .filter(Boolean)
    .slice(-10) as Array<Record<string, unknown>>;
}

function synthesizePromptFromAction(action: MythicUiAction, args: {
  boardType: "town" | "travel" | "dungeon" | "combat";
  vendorName: string | null;
  activeTurnCombatantName: string | null;
}): string {
  if (action.prompt && action.prompt.trim().length > 0) return action.prompt.trim();
  if (action.intent === "shop" || action.intent === "shop_action") {
    const vendorLabel = args.vendorName ?? "the vendor";
    return `I check ${vendorLabel}'s stock and ask what changed since the last turn.`;
  }
  if (action.intent === "combat_start") {
    return "I commit to combat now and want the exact mechanical outcome narrated.";
  }
  if (action.intent === "open_panel") {
    const panel = action.panel ?? "skills";
    if (panel === "character" || panel === "status" || panel === "progression") {
      return "I open the full character sheet and cross-check identity, resources, and quest pressure with current narrative state.";
    }
    return `I open the ${panel} panel and cross-check it against current narrative state.`;
  }
  if (action.intent === "focus_target" || action.intent === "combat_action") {
    const target = typeof action.payload?.target_combatant_id === "string"
      ? action.payload.target_combatant_id
      : args.activeTurnCombatantName ?? "the active target";
    return `I focus ${target} and set up the next strike.`;
  }
  if (action.intent === "town" || action.intent === "travel" || action.intent === "dungeon" || action.intent === "quest_action") {
    const targetMode = action.intent === "quest_action"
      ? resolvedModeFromAction(action, args.boardType)
      : action.intent;
    return `I transition to ${targetMode} and continue from committed runtime state.`;
  }
  if (action.intent === "companion_action") {
    return "I follow companion guidance and commit the next step from current runtime state.";
  }
  if (action.intent === "refresh") {
    return "Refresh the current state and narrate what changed in runtime.";
  }
  return `I take the action "${action.label}" in ${args.boardType} mode and continue.`;
}

function deriveCompanionFollowup(state: unknown): MythicUiAction | null {
  const rawState = asRecord(state);
  const checkins = Array.isArray(rawState?.companion_checkins) ? rawState?.companion_checkins : [];
  const actionChips = Array.isArray(rawState?.action_chips) ? rawState?.action_chips : [];
  const resolvedKeys = new Set<string>();
  for (const chip of actionChips) {
    const chipRecord = asRecord(chip);
    if (!chipRecord) continue;
    const payload = asRecord(chipRecord.payload);
    const companionId = typeof payload?.companion_id === "string" ? payload.companion_id : null;
    if (!companionId) continue;
    const turnIndex = Number.isFinite(Number(payload?.turn_index)) ? Number(payload?.turn_index) : "na";
    const resolved = chipRecord.resolved === true || payload?.resolved === true;
    if (resolved) {
      resolvedKeys.add(`${companionId}:${turnIndex}`);
    }
  }
  for (let index = checkins.length - 1; index >= 0; index -= 1) {
    const row = asRecord(checkins[index]);
    if (!row) continue;
    const line = typeof row.line === "string" ? row.line.trim() : "";
    const companionId = typeof row.companion_id === "string" ? row.companion_id : "companion";
    const mood = typeof row.mood === "string" ? row.mood : "steady";
    const urgency = typeof row.urgency === "string" ? row.urgency : "medium";
    const turnIndex = Number.isFinite(Number(row.turn_index)) ? Number(row.turn_index) : index;
    if (!line) continue;
    if (resolvedKeys.has(`${companionId}:${turnIndex}`) || resolvedKeys.has(`${companionId}:na`)) continue;
    const labelBase = line.includes(":") ? line.split(":")[0]!.trim() : `Companion ${companionId}`;
    return {
      id: `companion-followup-${companionId}-${index}`,
      label: `Check ${labelBase}`,
      intent: "companion_action",
      prompt: `I follow up on ${labelBase}'s guidance: "${line}". Give the immediate actionable step.`,
      payload: {
        companion_id: companionId,
        mood,
        urgency,
        hook_type: typeof row.hook_type === "string" ? row.hook_type : "companion_checkin",
        turn_index: turnIndex,
        companion_followup: true,
      },
    };
  }
  return null;
}

export default function MythicGameScreen() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();

  const { bootstrapCampaign, isBootstrapping } = useMythicCreator();
  const {
    board,
    isInitialLoading: boardInitialLoading,
    isRefreshing: boardRefreshing,
    error: boardError,
    refetch,
  } = useMythicBoard(campaignId);
  const {
    character,
    skills,
    items,
    progressionEvents,
    questThreads,
    isInitialLoading: charInitialLoading,
    isRefreshing: charRefreshing,
    error: charError,
    refetch: refetchCharacter,
    updateCharacterProfile,
  } = useMythicCharacter(campaignId);
  const mythicDm = useMythicDungeonMaster(campaignId);
  const dmVoice = useMythicDmVoice(campaignId);
  const combat = useMythicCombat();
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [combatStartError, setCombatStartError] = useState<{ message: string; code: string | null; requestId: string | null } | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopVendor, setShopVendor] = useState<{ id: string; name: string | null } | null>(null);
  const [dmContextRefreshSignal, setDmContextRefreshSignal] = useState(0);
  const introTriggerRef = useRef<string | null>(null);
  const introSkipReasonRef = useRef<string | null>(null);

  const bootstrapOnceRef = useRef(false);

  useEffect(() => {
    if (!campaignId) return;
    if (authLoading) return;
    if (!user) {
      navigate("/login");
      return;
    }
    if (bootstrapOnceRef.current) return;
    bootstrapOnceRef.current = true;

    (async () => {
      await bootstrapCampaign(campaignId);
      await refetch();
    })();
  }, [authLoading, bootstrapCampaign, campaignId, navigate, refetch, user]);

  const townVendors = useMemo(() => {
    if (!board || board.board_type !== "town") return [];
    const state = board.state_json && typeof board.state_json === "object" ? (board.state_json as Record<string, unknown>) : {};
    const list = Array.isArray(state.vendors) ? state.vendors : [];
    return list
      .map((entry, index) => {
        if (!entry || typeof entry !== "object") return null;
        const raw = entry as Record<string, unknown>;
        const id = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : `vendor_${index + 1}`;
        const name = typeof raw.name === "string" && raw.name.trim().length > 0 ? raw.name.trim() : `Vendor ${index + 1}`;
        return { id, name };
      })
      .filter((v): v is { id: string; name: string } => Boolean(v));
  }, [board]);

  const coins = useMemo(() => {
    if (!character) return 0;
    const resources = (character.resources && typeof character.resources === "object") ? (character.resources as Record<string, unknown>) : {};
    const n = Number(resources.coins ?? 0);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }, [character]);

  const findVendorName = useCallback((vendorId: string): string | null => {
    const hit = townVendors.find((v) => v.id === vendorId);
    return hit?.name ?? null;
  }, [townVendors]);

  const openShop = useCallback((vendorId: string, vendorName?: string | null) => {
    setShopVendor({ id: vendorId, name: vendorName ?? findVendorName(vendorId) });
    setShopOpen(true);
  }, [findVendorName]);

  const combatSessionId = useMemo(() => {
    if (!board) return null;
    const stateSessionId =
      typeof (board.state_json as any)?.combat_session_id === "string"
        ? String((board.state_json as any).combat_session_id)
        : null;
    return board.combat_session_id ?? stateSessionId;
  }, [board]);

  const combatState = useMythicCombatState(campaignId, board?.board_type === "combat" ? combatSessionId : null);
  const refetchCombatState = combatState.refetch;
  const mythicDmContext = useMythicDmContext(campaignId, {
    boardUpdatedAt: board?.updated_at ?? null,
    refreshSignal: dmContextRefreshSignal,
    pollMsVisible: 15_000,
  });
  const playerCombatantId = useMemo(() => {
    if (!user) return null;
    const c = combatState.combatants.find((x) => x.entity_type === "player" && x.player_id === user.id);
    return c?.id ?? null;
  }, [combatState.combatants, user]);

  const invRowsSafe = useMemo(
    () => (Array.isArray(items) ? (items as unknown as MythicInventoryRow[]) : []),
    [items],
  );
  const { equipment } = splitInventory(invRowsSafe);
  const equipBonuses = sumStatMods(equipment.map((r) => r.item));
  const derivedStats = {
    offense: Math.min(100, Math.max(0, Math.floor((character?.offense ?? 0) + (equipBonuses.offense ?? 0)))),
    defense: Math.min(100, Math.max(0, Math.floor((character?.defense ?? 0) + (equipBonuses.defense ?? 0)))),
    control: Math.min(100, Math.max(0, Math.floor((character?.control ?? 0) + (equipBonuses.control ?? 0)))),
    support: Math.min(100, Math.max(0, Math.floor((character?.support ?? 0) + (equipBonuses.support ?? 0)))),
    mobility: Math.min(100, Math.max(0, Math.floor((character?.mobility ?? 0) + (equipBonuses.mobility ?? 0)))),
    utility: Math.min(100, Math.max(0, Math.floor((character?.utility ?? 0) + (equipBonuses.utility ?? 0)))),
  };
  const passiveSkills = useMemo(
    () => skills.filter((skill) => skill.kind === "passive"),
    [skills],
  );
  const [isEquipmentBusy, setIsEquipmentBusy] = useState(false);
  const [equipmentActionError, setEquipmentActionError] = useState<string | null>(null);
  const [isPartyCommandBusy, setIsPartyCommandBusy] = useState(false);
  const [partyCommandError, setPartyCommandError] = useState<string | null>(null);
  const [isAdvancingTurn, setIsAdvancingTurn] = useState(false);
  const [combatAutoPacePhase, setCombatAutoPacePhase] = useState<CombatAutoPacePhase>("idle");
  const [combatAutoStepIndex, setCombatAutoStepIndex] = useState(0);
  const [autoTickGateNonce, setAutoTickGateNonce] = useState(0);
  const [combatRewardSummary, setCombatRewardSummary] = useState<CombatRewardSummaryModel | null>(null);
  const [isNarratedActionBusy, setIsNarratedActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const autoTickKeyRef = useRef<string | null>(null);
  const voiceGateDeadlineRef = useRef<number | null>(null);
  const voiceGateBaselineEndedAtRef = useRef<number | null>(null);
  const nextAutoTickReadyAtRef = useRef<number | null>(null);
  const autoTickDelayTimerRef = useRef<number | null>(null);
  const lastRewardCombatEndEventIdRef = useRef<string | null>(null);
  const narratedActionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastPlayerInputRef = useRef<string>("");
  const [activePanel, setActivePanel] = useState<MythicPanelTab>("status");
  const [utilityDrawerOpen, setUtilityDrawerOpen] = useState(false);
  const [utilityTab, setUtilityTab] = useState<MythicUtilityTab>("settings");
  const devSurfaces = useMythicDevSurfaces();
  const [focusedCombatantId, setFocusedCombatantId] = useState<string | null>(null);
  const [runtimeSettings, setRuntimeSettings] = useState<MythicRuntimeSettings>(() => loadMythicSettings());
  const [characterSheetOpen, setCharacterSheetOpen] = useState(false);
  const [characterSheetSection, setCharacterSheetSection] = useState<CharacterSheetSection>("overview");
  const [profileDraft, setProfileDraft] = useState<CharacterProfileDraft | null>(null);
  const [profileSaveState, setProfileSaveState] = useState<CharacterSheetSaveState>({
    isDirty: false,
    isSaving: false,
    lastSavedAt: null,
    error: null,
  });
  const lastSavedProfileRef = useRef<CharacterProfileDraft | null>(null);
  const profileSaveSeqRef = useRef(0);
  const queuedNarrationKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MYTHIC_SETTINGS_STORAGE_KEY, JSON.stringify(runtimeSettings));
  }, [runtimeSettings]);

  const baseProfileDraft = useMemo(
    () => (character ? profileDraftFromCharacter(character) : null),
    [character?.class_json, character?.id, character?.name, character?.updated_at],
  );

  useEffect(() => {
    if (!baseProfileDraft) {
      setProfileDraft(null);
      return;
    }
    if (profileSaveState.isDirty || profileSaveState.isSaving) return;
    setProfileDraft(baseProfileDraft);
    lastSavedProfileRef.current = baseProfileDraft;
  }, [baseProfileDraft, profileSaveState.isDirty, profileSaveState.isSaving]);

  useEffect(() => {
    if (!character || !profileDraft) return;
    if (!profileSaveState.isDirty) return;
    const timer = window.setTimeout(async () => {
      const saveSeq = profileSaveSeqRef.current + 1;
      profileSaveSeqRef.current = saveSeq;
      const patch = buildCharacterProfilePatch(profileDraft);
      setProfileSaveState((prev) => ({ ...prev, isSaving: true, error: null }));
      try {
        await updateCharacterProfile({
          characterId: character.id,
          name: patch.name,
          callsign: patch.callsign,
          pronouns: patch.pronouns,
          origin_note: patch.origin_note,
        });
        if (profileSaveSeqRef.current !== saveSeq) return;
        const savedDraft: CharacterProfileDraft = {
          name: patch.name,
          callsign: patch.callsign,
          pronouns: patch.pronouns,
          originNote: patch.origin_note,
        };
        lastSavedProfileRef.current = savedDraft;
        setProfileDraft(savedDraft);
        setProfileSaveState({
          isDirty: false,
          isSaving: false,
          lastSavedAt: Date.now(),
          error: null,
        });
      } catch (error) {
        if (profileSaveSeqRef.current !== saveSeq) return;
        const message = error instanceof Error ? error.message : "Failed to save character profile.";
        const rollback = lastSavedProfileRef.current ?? profileDraftFromCharacter(character);
        setProfileDraft(rollback);
        setProfileSaveState((prev) => ({
          isDirty: false,
          isSaving: false,
          lastSavedAt: prev.lastSavedAt,
          error: message,
        }));
        toast.error(message);
      }
    }, 620);
    return () => window.clearTimeout(timer);
  }, [character, profileDraft, profileSaveState.isDirty, updateCharacterProfile]);

  const boardStateRecord = useMemo(
    () => (board?.state_json && typeof board.state_json === "object" ? board.state_json as Record<string, unknown> : {}),
    [board?.state_json],
  );
  const discoveryFlags = useMemo(
    () => asRecord(boardStateRecord.discovery_flags) ?? {},
    [boardStateRecord.discovery_flags],
  );
  const combatResolutionPending = useMemo(
    () => parseCombatResolutionPending(boardStateRecord),
    [boardStateRecord],
  );
  const introPending = discoveryFlags.intro_pending === true;
  const introVersion = Number.isFinite(Number(discoveryFlags.intro_version))
    ? Math.max(1, Number(discoveryFlags.intro_version))
    : 1;

  const boardHooks = useMemo(() => summarizeBoardHooks(boardStateRecord), [boardStateRecord]);

  const persistedRuntimeActions = useMemo(() => {
    const raw = Array.isArray(boardStateRecord.action_chips) ? boardStateRecord.action_chips : [];
    return raw
      .map((entry, index) => {
        const record = asRecord(entry);
        const payload = asRecord(record?.payload);
        if (record?.resolved === true || payload?.resolved === true) return null;
        return normalizeUiActionFromUnknown(entry, `runtime-action-${index + 1}`);
      })
      .filter((entry): entry is MythicUiAction => Boolean(entry))
      .slice(0, MAX_CONSOLE_ACTIONS);
  }, [boardStateRecord.action_chips]);

  const companionFollowupAction = useMemo(
    () => deriveCompanionFollowup(boardStateRecord),
    [boardStateRecord],
  );

  const transitionRuntime = useCallback(async (
    toMode: "town" | "travel" | "dungeon" | "combat",
    reason: string,
    payload?: Record<string, unknown>,
  ): Promise<{ ok: boolean; data: Record<string, unknown> | null }> => {
    if (!campaignId) return { ok: false, data: null };
    setTransitionError(null);
    try {
      const { data, error } = await callEdgeFunction<Record<string, unknown>>("mythic-runtime-transition", {
        requireAuth: true,
        body: { campaignId, toMode, reason, payload: payload ?? {} },
      });
      if (error) throw error;
      await refetch();
      return { ok: true, data: data ?? null };
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : "Failed to transition mode");
      return { ok: false, data: null };
    }
  }, [campaignId, refetch]);

  const continueAfterCombatResolution = useCallback(async () => {
    if (!board || board.board_type !== "combat" || !combatResolutionPending) return;
    const targetMode = combatResolutionPending.returnMode;
    const result = await transitionRuntime(targetMode, "Combat Continue", {
      reason_code: "combat_continue",
      reason_label: "Combat Continue",
      combat_continue: true,
      combat_session_id: combatResolutionPending.combatSessionId,
      combat_resolution: {
        pending: false,
      },
    });
    if (!result.ok) {
      toast.error("Failed to continue from resolved combat.");
      return;
    }
    setCombatRewardSummary((prev) => prev ?? {
      xpGained: combatResolutionPending.xpGained,
      loot: combatResolutionPending.loot,
      endedAt: combatResolutionPending.endedAt ?? new Date().toISOString(),
      victory: combatResolutionPending.won,
    });
    await Promise.all([refetchCombatState(), refetchCharacter()]);
    toast.success(`Combat resolved. Continuing to ${targetMode}.`);
  }, [board, combatResolutionPending, refetchCharacter, refetchCombatState, transitionRuntime]);

  const recomputeCharacter = async () => {
    if (!campaignId || !character) return;
    await callEdgeFunction("mythic-recompute-character", {
      requireAuth: true,
      body: { campaignId, characterId: character.id },
    });
    await refetchCharacter();
  };

  const equipInventoryItem = useCallback(async (inventoryId: string) => {
    if (!campaignId || !character) return;
    setIsEquipmentBusy(true);
    setEquipmentActionError(null);
    try {
      const { data, error } = await callEdgeFunction<{ ok: boolean; error?: string; code?: string; requestId?: string }>(
        "mythic-inventory-equip",
        {
          requireAuth: true,
          idempotencyKey: `${character.id}:equip:${inventoryId}`,
          body: {
            campaignId,
            characterId: character.id,
            inventoryId,
          },
        },
      );
      if (error) throw error;
      if (!data?.ok) {
        const request = data?.requestId ? ` (requestId: ${data.requestId})` : "";
        throw new Error(`${data?.error ?? "Equip failed"} [${data?.code ?? "inventory_equip_failed"}]${request}`);
      }
      await Promise.all([recomputeCharacter(), refetch()]);
      toast.success("Item equipped.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to equip item.";
      setEquipmentActionError(message);
      toast.error(message);
    } finally {
      setIsEquipmentBusy(false);
    }
  }, [campaignId, character, recomputeCharacter, refetch]);

  const unequipInventoryItem = useCallback(async (inventoryId: string) => {
    if (!campaignId || !character) return;
    setIsEquipmentBusy(true);
    setEquipmentActionError(null);
    try {
      const { data, error } = await callEdgeFunction<{ ok: boolean; error?: string; code?: string; requestId?: string }>(
        "mythic-inventory-unequip",
        {
          requireAuth: true,
          idempotencyKey: `${character.id}:unequip:${inventoryId}`,
          body: {
            campaignId,
            characterId: character.id,
            inventoryId,
          },
        },
      );
      if (error) throw error;
      if (!data?.ok) {
        const request = data?.requestId ? ` (requestId: ${data.requestId})` : "";
        throw new Error(`${data?.error ?? "Unequip failed"} [${data?.code ?? "inventory_unequip_failed"}]${request}`);
      }
      await Promise.all([recomputeCharacter(), refetch()]);
      toast.success("Item unequipped.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to unequip item.";
      setEquipmentActionError(message);
      toast.error(message);
    } finally {
      setIsEquipmentBusy(false);
    }
  }, [campaignId, character, recomputeCharacter, refetch]);

  const issueCompanionCommand = useCallback(async (payload: {
    companionId: string;
    stance: "aggressive" | "balanced" | "defensive";
    directive: "focus" | "protect" | "harry" | "hold";
    targetHint?: string;
  }) => {
    if (!board) return;
    setIsPartyCommandBusy(true);
    setPartyCommandError(null);
    try {
      const reasonLabel = `Companion ${payload.directive}`;
      const mode = board.board_type;
      const result = await transitionRuntime(mode, reasonLabel, {
        reason_code: `companion_${payload.directive}`,
        reason_label: reasonLabel,
        companion_command: {
          companion_id: payload.companionId,
          stance: payload.stance,
          directive: payload.directive,
          target_hint: payload.targetHint ?? null,
        },
      });
      if (!result.ok) {
        throw new Error("Companion command failed.");
      }
      await Promise.all([refetch(), refetchCharacter()]);
      toast.success("Companion command updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to issue companion command.";
      setPartyCommandError(message);
      toast.error(message);
    } finally {
      setIsPartyCommandBusy(false);
    }
  }, [board, refetch, refetchCharacter, transitionRuntime]);

  const activeTurnCombatant = useMemo(
    () => combatState.combatants.find((c) => c.id === combatState.activeTurnCombatantId) ?? null,
    [combatState.activeTurnCombatantId, combatState.combatants],
  );
  const canAdvanceNpcTurn = Boolean(
    board?.board_type === "combat" &&
    combatSessionId &&
    !combatResolutionPending &&
    combatState.session?.status === "active" &&
    activeTurnCombatant &&
    activeTurnCombatant.entity_type !== "player",
  );
  const shouldGateNpcStepOnVoice = dmVoice.enabled && dmVoice.supported && !dmVoice.blocked;
  const combatPaceModel = useMemo<CombatPaceStateModel>(() => ({
    phase: combatAutoPacePhase,
    waitingOnVoice: combatAutoPacePhase === "waiting_voice_end" || combatAutoPacePhase === "narrating",
    waitingOnTick: isAdvancingTurn || combat.isTicking,
    stepIndex: combatAutoStepIndex,
  }), [combat.isTicking, combatAutoPacePhase, combatAutoStepIndex, isAdvancingTurn]);
  const tickCombat = combat.tickCombat;

  useEffect(() => {
    if (board?.board_type === "combat") return;
    setCombatAutoPacePhase("idle");
    setCombatAutoStepIndex(0);
    voiceGateDeadlineRef.current = null;
    voiceGateBaselineEndedAtRef.current = null;
    nextAutoTickReadyAtRef.current = null;
    if (autoTickDelayTimerRef.current !== null) {
      window.clearTimeout(autoTickDelayTimerRef.current);
      autoTickDelayTimerRef.current = null;
    }
    autoTickKeyRef.current = null;
  }, [board?.board_type]);

  const latestAssistantParsed = useMemo(() => {
    for (let index = mythicDm.messages.length - 1; index >= 0; index -= 1) {
      const entry = mythicDm.messages[index];
      if (entry?.role === "assistant" && entry.parsed) {
        return entry.parsed;
      }
    }
    return null;
  }, [mythicDm.messages]);

  const latestAssistantActions = useMemo(() => (latestAssistantParsed?.ui_actions ?? []).slice(0, MAX_CONSOLE_ACTIONS), [latestAssistantParsed?.ui_actions]);

  const companionPresenceById = useMemo(() => {
    const rows = Array.isArray(boardStateRecord.companion_presence) ? boardStateRecord.companion_presence : [];
    const map = new Map<string, { name: string; archetype: string; voice: string; mood: string }>();
    rows.forEach((entry, index) => {
      const row = asRecord(entry);
      if (!row) return;
      const companionId = typeof row.companion_id === "string" && row.companion_id.trim().length > 0
        ? row.companion_id.trim()
        : `companion_${index + 1}`;
      map.set(companionId, {
        name: typeof row.name === "string" && row.name.trim().length > 0 ? row.name : companionId,
        archetype: typeof row.archetype === "string" && row.archetype.trim().length > 0 ? row.archetype : "ally",
        voice: typeof row.voice === "string" && row.voice.trim().length > 0 ? row.voice : "steady",
        mood: typeof row.mood === "string" && row.mood.trim().length > 0 ? row.mood : "steady",
      });
    });
    return map;
  }, [boardStateRecord.companion_presence]);

  const companionCommandById = useMemo(() => {
    const raw = asRecord(boardStateRecord.companion_commands) ?? {};
    const map = new Map<string, { stance: "aggressive" | "balanced" | "defensive"; directive: "focus" | "protect" | "harry" | "hold"; targetHint: string | null }>();
    for (const [companionId, entry] of Object.entries(raw)) {
      const row = asRecord(entry) ?? {};
      const stanceRaw = typeof row.stance === "string" ? row.stance : "balanced";
      const directiveRaw = typeof row.directive === "string" ? row.directive : "hold";
      const stance = stanceRaw === "aggressive" || stanceRaw === "defensive" ? stanceRaw : "balanced";
      const directive = directiveRaw === "focus" || directiveRaw === "protect" || directiveRaw === "harry" ? directiveRaw : "hold";
      const targetHint = typeof row.target_hint === "string" && row.target_hint.trim().length > 0 ? row.target_hint.trim() : null;
      map.set(companionId, { stance, directive, targetHint });
    }
    return map;
  }, [boardStateRecord.companion_commands]);

  const companionCheckins = useMemo(() => {
    const rows = Array.isArray(boardStateRecord.companion_checkins) ? boardStateRecord.companion_checkins : [];
    const mapped = rows
      .map((entry, index) => {
        const row = asRecord(entry);
        if (!row) return null;
        const companionId = typeof row.companion_id === "string" ? row.companion_id : "companion";
        const presence = companionPresenceById.get(companionId);
        const command = companionCommandById.get(companionId);
        const line = typeof row.line === "string" ? row.line.trim() : "";
        if (!line) return null;
        return {
          id: `${companionId}:${index}`,
          companionId,
          name: presence?.name ?? companionId,
          archetype: presence?.archetype ?? "ally",
          voice: presence?.voice ?? "steady",
          line,
          mood: typeof row.mood === "string" ? row.mood : (presence?.mood ?? "steady"),
          urgency: typeof row.urgency === "string" ? row.urgency : "medium",
          hookType: typeof row.hook_type === "string" ? row.hook_type : "companion_checkin",
          turnIndex: Number.isFinite(Number(row.turn_index)) ? Number(row.turn_index) : index,
          stance: command?.stance ?? "balanced",
          directive: command?.directive ?? "hold",
          targetHint: command?.targetHint ?? null,
        };
      })
      .filter((entry): entry is {
        id: string;
        companionId: string;
        name: string;
        archetype: string;
        voice: string;
        line: string;
        mood: string;
        urgency: string;
        hookType: string;
        turnIndex: number;
        stance: "aggressive" | "balanced" | "defensive";
        directive: "focus" | "protect" | "harry" | "hold";
        targetHint: string | null;
      } => Boolean(entry));

    if (mapped.length > 0) return mapped;

    return Array.from(companionPresenceById.entries()).map(([companionId, presence], index) => {
      const command = companionCommandById.get(companionId);
      return {
        id: `${companionId}:presence`,
        companionId,
        name: presence.name,
        archetype: presence.archetype,
        voice: presence.voice,
        line: "Companion ready for orders.",
        mood: presence.mood,
        urgency: "medium",
        hookType: "companion_presence",
        turnIndex: index,
        stance: command?.stance ?? "balanced",
        directive: command?.directive ?? "hold",
        targetHint: command?.targetHint ?? null,
      };
    });
  }, [boardStateRecord.companion_checkins, companionCommandById, companionPresenceById]);

  useEffect(() => {
    if (!Array.isArray(combatState.events) || combatState.events.length === 0) return;
    const latestCombatEnd = [...combatState.events]
      .reverse()
      .find((event) => event.event_type === "combat_end");
    if (!latestCombatEnd) return;
    if (lastRewardCombatEndEventIdRef.current === latestCombatEnd.id) return;
    lastRewardCombatEndEventIdRef.current = latestCombatEnd.id;

    const sameTurnEvents = combatState.events.filter((event) => event.turn_index === latestCombatEnd.turn_index);
    const xpGained = sameTurnEvents
      .filter((event) => event.event_type === "xp_gain")
      .reduce((total, event) => {
        const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
        const amount = Number(payload.amount ?? 0);
        return total + (Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0);
      }, 0);
    const loot = sameTurnEvents
      .filter((event) => event.event_type === "loot_drop")
      .map((event) => {
        const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
        if (typeof payload.name === "string" && payload.name.trim().length > 0) return payload.name.trim();
        if (typeof payload.item_id === "string" && payload.item_id.trim().length > 0) return payload.item_id.trim();
        return "Loot";
      })
      .slice(0, 4);
    const combatEndPayload = latestCombatEnd.payload && typeof latestCombatEnd.payload === "object"
      ? latestCombatEnd.payload as Record<string, unknown>
      : {};
    const victory = combatEndPayload.won === true;
    const endedAt = latestCombatEnd.created_at || new Date().toISOString();
    setCombatRewardSummary({
      xpGained,
      loot,
      endedAt,
      victory,
    });
    if (characterSheetOpen) {
      setCharacterSheetSection("combat");
    }
    void refetchCharacter();
    toast.success(
      `${victory ? "Combat won" : "Combat resolved"}${xpGained > 0 ? ` · +${xpGained} XP` : ""}${loot.length > 0 ? ` · ${loot.join(", ")}` : ""}`,
    );
  }, [characterSheetOpen, combatState.events, refetchCharacter]);

  useEffect(() => {
    if (!combatResolutionPending) return;
    setCombatRewardSummary((prev) => prev ?? {
      xpGained: combatResolutionPending.xpGained,
      loot: combatResolutionPending.loot,
      endedAt: combatResolutionPending.endedAt ?? new Date().toISOString(),
      victory: combatResolutionPending.won,
    });
  }, [combatResolutionPending]);

  const latestAssistantMessage = useMemo(() => {
    for (let index = mythicDm.messages.length - 1; index >= 0; index -= 1) {
      const entry = mythicDm.messages[index];
      if (entry?.role === "assistant") {
        return entry;
      }
    }
    return null;
  }, [mythicDm.messages]);

  const latestAssistantNarration = useMemo(() => {
    if (!latestAssistantMessage) return "";
    const parsedNarration = latestAssistantMessage.parsed?.narration?.trim();
    if (parsedNarration) return parsedNarration;
    return latestAssistantMessage.content.trim();
  }, [latestAssistantMessage]);

  const speakDmNarration = dmVoice.speak;

  useEffect(() => {
    if (!latestAssistantMessage) return;
    if (!latestAssistantNarration) return;
    speakDmNarration(latestAssistantNarration, latestAssistantMessage.id);
  }, [latestAssistantMessage, latestAssistantNarration, speakDmNarration]);

  const openCharacterSheet = useCallback((section: CharacterSheetSection = "overview") => {
    setCharacterSheetSection(section);
    setUtilityDrawerOpen(false);
    setCharacterSheetOpen(true);
  }, []);

  const resolveUtilityTab = useCallback((tab: MythicUtilityTab): MythicUtilityTab => {
    if (!devSurfaces.enabled && (tab === "logs" || tab === "diagnostics")) {
      return "settings";
    }
    return tab;
  }, [devSurfaces.enabled]);

  const openUtility = useCallback((tab: MythicUtilityTab = "settings") => {
    setUtilityTab(resolveUtilityTab(tab));
    setUtilityDrawerOpen(true);
  }, [resolveUtilityTab]);

  useEffect(() => {
    if (devSurfaces.enabled) return;
    if (utilityTab === "logs" || utilityTab === "diagnostics") {
      setUtilityTab("settings");
    }
  }, [devSurfaces.enabled, utilityTab]);

  const handleProfileDraftChange = useCallback((next: CharacterProfileDraft) => {
    setProfileDraft(next);
    setProfileSaveState((prev) => ({
      ...prev,
      isDirty: true,
      isSaving: false,
      error: null,
    }));
  }, []);

  const commandSkillAvailability = useMemo(() => {
    const turnIndex = Number(combatState.session?.current_turn_index ?? 0);
    return buildSkillAvailability({
      skills,
      combatants: combatState.combatants,
      playerCombatantId,
      activeTurnCombatantId: combatState.activeTurnCombatantId,
      currentTurnIndex: turnIndex,
      focusedTargetCombatantId: focusedCombatantId,
    });
  }, [combatState.activeTurnCombatantId, combatState.combatants, combatState.session?.current_turn_index, focusedCombatantId, playerCombatantId, skills]);
  const dmMessageCount = mythicDm.messages.length;
  const dmLoading = mythicDm.isLoading;
  const sendDmMessage = mythicDm.sendMessage;
  const enqueueNarratedAction = useCallback((task: () => Promise<void>) => {
    const queued = narratedActionQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        setIsNarratedActionBusy(true);
        try {
          await task();
        } finally {
          setIsNarratedActionBusy(false);
        }
      });
    narratedActionQueueRef.current = queued.catch(() => undefined);
    return queued;
  }, []);

  const refreshAllState = useCallback(async () => {
    const started = Date.now();
    await Promise.all([refetch(), refetchCombatState(), refetchCharacter()]);
    screenLogger.info("mythic.state.refresh_all_complete", {
      elapsed_ms: Date.now() - started,
      board_refreshing: boardRefreshing,
      character_refreshing: charRefreshing,
      combat_refreshing: combatState.isRefreshing,
    });
  }, [boardRefreshing, charRefreshing, combatState.isRefreshing, refetch, refetchCharacter, refetchCombatState]);

  const logIntroSkip = useCallback((reason: string) => {
    if (introSkipReasonRef.current === reason) return;
    introSkipReasonRef.current = reason;
    screenLogger.info("mythic.intro.skipped", {
      campaign_id: campaignId ?? null,
      user_id: user?.id ?? null,
      reason,
    });
  }, [campaignId, user?.id]);

  useEffect(() => {
    if (!campaignId || !user || !character || !board) {
      logIntroSkip("missing_runtime_context");
      return;
    }
    if (!introPending) {
      logIntroSkip("intro_not_pending");
      return;
    }
    if (dmLoading) {
      logIntroSkip("dm_loading");
      return;
    }
    if (dmMessageCount > 0) {
      logIntroSkip("messages_already_present");
      return;
    }
    const idempotencyKey = `campaign-intro:v1:${campaignId}:${user.id}`;
    if (introTriggerRef.current === idempotencyKey) {
      logIntroSkip("already_triggered_this_session");
      return;
    }
    introTriggerRef.current = idempotencyKey;
    introSkipReasonRef.current = null;
    screenLogger.info("mythic.intro.triggered", {
      campaign_id: campaignId,
      user_id: user.id,
      intro_version: introVersion,
    });

    void enqueueNarratedAction(async () => {
      try {
        await sendDmMessage(
          "Open this campaign with immediate direction tied to seeded hooks and current board truth.",
          {
            appendUser: false,
            timeoutMs: DM_ACTION_TIMEOUT_MS,
            suppressErrorToast: true,
            abortPrevious: false,
            idempotencyKey,
            actionContext: {
              source: "campaign_intro_auto",
              intent: "dm_prompt",
              action_id: "campaign_intro_opening_v1",
              payload: {
                intro_opening: true,
                intro_version: introVersion,
              },
            },
          },
        );
        await refreshAllState();
        screenLogger.info("mythic.intro.completed", {
          campaign_id: campaignId,
          user_id: user.id,
          intro_version: introVersion,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to generate opening narration.";
        if (isExpectedDmCancellationError(message)) {
          screenLogger.info("mythic.intro.cancelled", {
            campaign_id: campaignId,
            user_id: user.id,
            intro_version: introVersion,
          });
          return;
        }
        setActionError(message);
        screenLogger.warn("mythic.intro.failed", {
          campaign_id: campaignId,
          user_id: user.id,
          intro_version: introVersion,
          error: message,
        });
      }
    });
  }, [
    board,
    campaignId,
    character,
    dmLoading,
    dmMessageCount,
    enqueueNarratedAction,
    introPending,
    introVersion,
    logIntroSkip,
    refreshAllState,
    sendDmMessage,
    user,
  ]);

  const runNarratedAction = useCallback((args: {
    source: UnifiedActionSource;
    intent: string;
    actionId?: string;
    payload?: Record<string, unknown>;
    prompt: string;
    appendUser?: boolean;
    execute?: () => Promise<{
      stateChanges?: string[];
      context?: Record<string, unknown>;
      prompt?: string;
      error?: string | null;
    }>;
    onAfterExecute?: (result: {
      stateChanges: string[];
      context: Record<string, unknown>;
      executionError: string | null;
    }) => void;
    onBeforeNarration?: () => void;
  }) => {
    if (!campaignId) return Promise.resolve();
    const normalizedPrompt = args.prompt.trim().toLowerCase().replace(/\s+/g, " ");
    const promptDedupeSlice = isLowSignalNarrationPrompt(normalizedPrompt) ? 48 : 160;
    const dedupeKey = args.intent === "refresh"
      ? "refresh"
      : args.intent === "dm_prompt" && normalizedPrompt.length > 0
        ? `dm_prompt:${normalizedPrompt.slice(0, promptDedupeSlice)}`
        : null;
    if (dedupeKey && queuedNarrationKeysRef.current.has(dedupeKey)) {
      screenLogger.info("mythic.action.duplicate_suppressed", {
        source: args.source,
        intent: args.intent,
        dedupe_key: dedupeKey,
      });
      return Promise.resolve();
    }
    if (dedupeKey) {
      queuedNarrationKeysRef.current.add(dedupeKey);
    }

    return enqueueNarratedAction(async () => {
      const actionTraceId = crypto.randomUUID();
      let prompt = args.prompt.trim();
      let stateChanges: string[] = [];
      let context: Record<string, unknown> = {};
      let executionError: string | null = null;
      screenLogger.info("mythic.action.start", {
        action_trace_id: actionTraceId,
        source: args.source,
        intent: args.intent,
        action_id: args.actionId ?? null,
      });

      try {
        if (args.execute) {
          const result = await args.execute();
          if (Array.isArray(result.stateChanges)) stateChanges = result.stateChanges;
          if (result.context && typeof result.context === "object") context = result.context;
          if (typeof result.prompt === "string" && result.prompt.trim().length > 0) prompt = result.prompt.trim();
          if (typeof result.error === "string" && result.error.trim().length > 0) executionError = result.error.trim();
          screenLogger.info("mythic.action.execute_result", {
            action_trace_id: actionTraceId,
            source: args.source,
            intent: args.intent,
            state_changes: stateChanges,
            execution_error: executionError,
            authoritative_mutation_applied: context.authoritative_mutation_applied === true,
              combat_autostart_triggered: context.combat_autostart_triggered === true,
          });
        }
      } catch (error) {
        executionError = error instanceof Error ? error.message : "Action execution failed.";
        screenLogger.warn("mythic.action.execute_failed", {
          action_trace_id: actionTraceId,
          source: args.source,
          intent: args.intent,
          execution_error: executionError,
        });
      }

      try {
        await Promise.all([refetchCombatState(), refetch()]);
      } catch (refreshError) {
        screenLogger.warn("mythic.action.pre_narration_refresh_failed", {
          action_trace_id: actionTraceId,
          source: args.source,
          intent: args.intent,
          refresh_error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        });
      }

      args.onAfterExecute?.({
        stateChanges,
        context,
        executionError,
      });

      const contextWithNamedEvents = Array.isArray(context.combat_event_batch)
        ? {
            ...context,
            combat_event_batch: enrichCombatEventBatchForNarration(
              context.combat_event_batch,
              combatState.combatants.map((entry) => ({ id: entry.id, name: entry.name })),
            ),
          }
        : context;

      if (executionError && isMechanicalExecutionError(executionError)) {
        await refreshAllState();
        setDmContextRefreshSignal((prev) => prev + 1);
        setActionError(executionError);
        toast.error(executionError);
        screenLogger.info("mythic.action.narration_skipped_for_mechanical_error", {
          action_trace_id: actionTraceId,
          source: args.source,
          intent: args.intent,
          execution_error: executionError,
        });
        return;
      }

      const narrationPrompt = executionError
        ? `I attempted ${args.intent}, but it failed: ${executionError}. Narrate the failure against committed state only.`
        : prompt.length > 0
          ? prompt
          : `I execute ${args.intent}. Narrate outcome from committed Mythic state.`;

      try {
        args.onBeforeNarration?.();
        await mythicDm.sendMessage(narrationPrompt, {
          appendUser: args.appendUser !== false,
          timeoutMs: DM_ACTION_TIMEOUT_MS,
          suppressErrorToast: true,
          abortPrevious: false,
          idempotencyKey: `${campaignId}:${actionTraceId}`,
          actionContext: {
            action_trace_id: actionTraceId,
            source: args.source,
            intent: args.intent,
            action_id: args.actionId ?? null,
            payload: args.payload ?? null,
            state_changes: stateChanges,
            execution_error: executionError,
            ...contextWithNamedEvents,
          },
        });
      } catch (error) {
        const dmError = error instanceof Error ? error.message : "Failed to reach Mythic DM.";
        if (isExpectedDmCancellationError(dmError)) {
          screenLogger.info("mythic.action.dm_cancelled", {
            action_trace_id: actionTraceId,
            source: args.source,
            intent: args.intent,
          });
        } else {
          const parsed = parseEdgeError(error, "Failed to reach Mythic DM.");
          const classified = parsed.code === "turn_conflict"
            ? "Turn conflict. Retry the action."
            : parsed.code === "turn_commit_failed"
              ? "Turn commit failed. Retry or refresh state."
              : parsed.message.toLowerCase().includes("timed out")
                ? "DM request timed out. Retry once."
                : parsed.message;
          const withRequest = parsed.requestId ? `${classified} (requestId: ${parsed.requestId})` : classified;
          setActionError(withRequest);
          toast.error(withRequest);
          screenLogger.error("mythic.action.dm_failed", error, {
            action_trace_id: actionTraceId,
            source: args.source,
            intent: args.intent,
          });
        }
        await refreshAllState();
        setDmContextRefreshSignal((prev) => prev + 1);
        return;
      }

      await refreshAllState();
      setDmContextRefreshSignal((prev) => prev + 1);
      screenLogger.info("mythic.action.refresh_complete", {
        action_trace_id: actionTraceId,
        source: args.source,
        intent: args.intent,
        state_changes: stateChanges,
        execution_error: executionError,
      });
      if (executionError) {
        setActionError(executionError);
        toast.error(executionError);
      }
    }).finally(() => {
      if (dedupeKey) {
        queuedNarrationKeysRef.current.delete(dedupeKey);
      }
    });
  }, [campaignId, combatState.combatants, enqueueNarratedAction, mythicDm, refetch, refetchCombatState, refreshAllState]);

  const handlePlayerInput = useCallback(async (message: string) => {
    if (!campaignId) return;
    const rawMessage = message.trim();
    if (!rawMessage) return;
    lastPlayerInputRef.current = rawMessage;
    setActionError(null);
    setCombatStartError(null);

    const command = parsePlayerCommand(rawMessage);
    await runNarratedAction({
      source: "typed_command",
      intent: command.intent,
      actionId: `command:${command.intent}`,
      payload: {
        command: rawMessage,
        parsed_intent: command.intent,
        explicit: command.explicit,
      },
      prompt: rawMessage,
      execute: async () => {
        try {
          const resolution = await executePlayerCommand({
            campaignId,
            boardType: board?.board_type ?? "town",
            command,
            skills,
            combatants: combatState.combatants,
            currentTurnIndex: Number(combatState.session?.current_turn_index ?? 0),
            activeTurnCombatantId: combatState.activeTurnCombatantId,
            playerCombatantId,
            focusedTargetCombatantId: focusedCombatantId,
            transitionBoard: transitionRuntime,
            startCombat: combat.startCombat,
            useSkill: combat.useSkill,
            combatSessionId,
            refetchBoard: refetch,
            refetchCombat: async () => { await refetchCombatState(); },
            refetchCharacter,
            openMenu: (panel: PlayerCommandPanel) => {
              if (panel === "commands" || panel === "settings") {
                openUtility(panel === "commands" && devSurfaces.enabled ? "logs" : "settings");
                return;
              }
              if (panel === "shop") {
                openUtility("panels");
                return;
              }
              openCharacterSheet(mapCharacterSheetSection(panel));
            },
          });
          if (resolution.combatStartError) {
            setCombatStartError(resolution.combatStartError);
          }
          return {
            stateChanges: resolution.stateChanges,
            context: resolution.narrationContext ?? {
              command: rawMessage,
              intent: command.intent,
              handled: resolution.handled,
            },
            error: resolution.error ?? null,
          };
        } catch (error) {
          const messageText = error instanceof Error ? error.message : "Failed to process command.";
          return {
            stateChanges: [],
            context: {
              command: rawMessage,
              intent: command.intent,
              handled: false,
            },
            error: messageText,
          };
        }
      },
    });
  }, [
    board?.board_type,
    campaignId,
    combat.startCombat,
    combat.useSkill,
    combatSessionId,
    combatState.activeTurnCombatantId,
    combatState.combatants,
    combatState.session?.current_turn_index,
    focusedCombatantId,
    openCharacterSheet,
    openUtility,
    playerCombatantId,
    refetch,
    refetchCharacter,
    refetchCombatState,
    runNarratedAction,
    skills,
    transitionRuntime,
  ]);

  const selectBestQuickCastEnemy = useCallback((preferredCombatantId?: string | null) => {
    const aliveEnemies = combatState.combatants.filter(
      (entry) => entry.player_id === null && entry.is_alive,
    );
    if (aliveEnemies.length === 0) return null;
    if (preferredCombatantId) {
      const preferred = aliveEnemies.find((entry) => entry.id === preferredCombatantId) ?? null;
      if (preferred) return preferred;
    }
    const focused = focusedCombatantId
      ? aliveEnemies.find((entry) => entry.id === focusedCombatantId) ?? null
      : null;
    if (focused) return focused;
    const activeEnemy = activeTurnCombatant
      && activeTurnCombatant.player_id === null
      && activeTurnCombatant.is_alive
      ? activeTurnCombatant
      : null;
    if (activeEnemy) return activeEnemy;
    const player = playerCombatantId
      ? combatState.combatants.find((entry) => entry.id === playerCombatantId) ?? null
      : null;
    if (!player) return aliveEnemies[0] ?? null;
    const ordered = [...aliveEnemies].sort((a, b) => {
      const da = Math.abs(a.x - player.x) + Math.abs(a.y - player.y);
      const db = Math.abs(b.x - player.x) + Math.abs(b.y - player.y);
      if (da !== db) return da - db;
      return a.name.localeCompare(b.name);
    });
    return ordered[0] ?? null;
  }, [activeTurnCombatant, combatState.combatants, focusedCombatantId, playerCombatantId]);

  const executeBoardAction = useCallback(async (action: MythicUiAction, source: UnifiedActionSource = "console_action") => {
    if (!campaignId || !board) return;
    const resolvedIntent = resolveActionIntent(action, board.board_type);
    setActionError(null);
    if (resolvedIntent !== "combat_start") {
      setCombatStartError(null);
    }

    let vendorName: string | null = null;
    if (resolvedIntent === "shop") {
      const payloadVendor = action.payload && typeof action.payload.vendorId === "string" ? action.payload.vendorId : null;
      vendorName = payloadVendor ? findVendorName(payloadVendor) : null;
    }

    const prompt = synthesizePromptFromAction(action, {
      boardType: board.board_type,
      vendorName,
      activeTurnCombatantName: activeTurnCombatant?.name ?? null,
    });

    await runNarratedAction({
      source,
      intent: action.intent,
      actionId: action.id,
      payload: action.payload,
      prompt,
      execute: async () => {
        if (resolvedIntent === "refresh") {
          return {
            stateChanges: ["Requested a full state refresh and narration sync."],
            context: { refresh: true },
          };
        }

        if (resolvedIntent === "focus_target") {
          const targetId = typeof action.payload?.target_combatant_id === "string"
            ? action.payload.target_combatant_id
            : null;
          if (!targetId) {
            return {
              stateChanges: [],
              context: { focus_target: null },
              error: "Focus target action is missing target id.",
            };
          }
          setFocusedCombatantId(targetId);
          return {
            stateChanges: [`Focused target ${targetId}.`],
            context: { focus_target: targetId },
          };
        }

        if (resolvedIntent === "shop") {
          if (!character) {
            return { stateChanges: [], error: "No character loaded for this campaign." };
          }
          if (board.board_type !== "town") {
            return { stateChanges: [], error: "Shops are only available while in town." };
          }
          const payloadVendor = action.payload && typeof action.payload.vendorId === "string" ? action.payload.vendorId : null;
          let vendorId: string | null = payloadVendor;
          if (!vendorId) {
            const haystack = `${action.label ?? ""} ${action.prompt ?? ""}`.toLowerCase();
            const matched = townVendors.find((vendor) => haystack.includes(vendor.name.toLowerCase()));
            vendorId = matched?.id ?? townVendors[0]?.id ?? null;
          }
          if (!vendorId) {
            return { stateChanges: [], error: "No vendors are available on this town board." };
          }
          const resolvedName = findVendorName(vendorId);
          openShop(vendorId, resolvedName);
          return {
            stateChanges: [`Opened shop for ${resolvedName ?? vendorId}.`],
            context: { vendor_id: vendorId, vendor_name: resolvedName ?? null },
          };
        }

        if (resolvedIntent === "open_panel") {
          const panelRaw = typeof action.panel === "string"
            ? action.panel
            : "status";
          if (
            panelRaw === "character"
            || panelRaw === "status"
            || panelRaw === "progression"
            || panelRaw === "skills"
            || panelRaw === "combat"
            || panelRaw === "quests"
            || panelRaw === "companions"
            || panelRaw === "equipment"
          ) {
            const section = mapCharacterSheetSection(panelRaw);
            openCharacterSheet(section);
            return {
              stateChanges: [`Opened character sheet (${section}).`],
              context: { character_sheet_section: section },
            };
          }
          const tab = mapPanelTab(panelRaw);
          if (!tab) {
            if (panelRaw === "commands" || panelRaw === "settings") {
              openUtility(panelRaw === "commands" && devSurfaces.enabled ? "logs" : "settings");
              return {
                stateChanges: [`Opened ${panelRaw === "commands" && devSurfaces.enabled ? "logs" : "settings"} utility drawer.`],
                context: { utility: panelRaw === "commands" && devSurfaces.enabled ? "logs" : "settings" },
              };
            }
            return { stateChanges: [], error: "Panel target missing for this interaction." };
          }
          if (tab === "shop") {
            openUtility("panels");
            return {
              stateChanges: ["Opened menu panel."],
              context: { panel: "shop" },
            };
          }
          const section = mapCharacterSheetSection(tab);
          openCharacterSheet(section);
          return {
            stateChanges: [`Opened character sheet (${section}).`],
            context: { character_sheet_section: section },
          };
        }

        if (resolvedIntent === "town" || resolvedIntent === "travel" || resolvedIntent === "dungeon") {
          const target = (action.boardTarget === "town" || action.boardTarget === "travel" || action.boardTarget === "dungeon")
            ? action.boardTarget
            : resolvedIntent;
          if (board.board_type !== target) {
            const reasonLabel = (action.label && action.label.trim().length > 0)
              ? action.label.trim()
              : (action.prompt && action.prompt.trim().length > 0)
                ? action.prompt.trim().slice(0, 120)
                : "Story Progression";
            const reasonCode = normalizeReasonCode(action.id || reasonLabel);
            const payload = {
              ...(action.payload ?? {}),
              reason_code: reasonCode,
              reason_label: reasonLabel,
            };
            const transitionResult = await transitionRuntime(target, reasonLabel, payload);
            if (!transitionResult.ok) {
              return {
                stateChanges: [],
                context: {
                  mode_target: target,
                  transition_payload: payload,
                  authoritative_mutation_applied: false,
                },
                error: "Runtime transition failed.",
              };
            }
            const discoveryFlags = transitionResult.data && typeof transitionResult.data.discovery_flags === "object"
              ? transitionResult.data.discovery_flags as Record<string, unknown>
              : {};
            let autoCombat = null as { combat_session_id: string } | null;
            const shouldAutoStartCombat = discoveryFlags.encounter_triggered === true;
            if (shouldAutoStartCombat) {
              const started = await combat.startCombat(campaignId);
              if (started.ok === false) {
                setCombatStartError({ message: started.message, code: started.code, requestId: started.requestId });
              } else {
                autoCombat = { combat_session_id: started.combatSessionId };
              }
              screenLogger.info("mythic.action.combat_autostart", {
                source,
                intent: action.intent,
                combat_autostart_triggered: true,
                combat_started: Boolean(autoCombat),
              });
            }
            return {
              stateChanges: [
                `Transitioned board to ${target}.`,
                ...(autoCombat ? ["Combat auto-started from encounter trigger."] : []),
              ],
              context: {
                mode_target: target,
                transition_payload: payload,
                transition_result: transitionResult.data,
                discovery_flags: discoveryFlags,
                authoritative_mutation_applied: true,
                combat_autostart_triggered: shouldAutoStartCombat,
                ...autoCombat,
              },
            };
          }
          return {
            stateChanges: [`Mode already on ${target}.`],
            context: { mode_target: target, noop: true },
          };
        }

        if (resolvedIntent === "dm_prompt") {
          const payload = (action.payload && typeof action.payload === "object")
            ? action.payload as Record<string, unknown>
            : {};
          const companionId = typeof action.payload?.companion_id === "string"
            ? action.payload.companion_id
            : null;
          const companionTurnIndex = Number.isFinite(Number(action.payload?.turn_index))
            ? Number(action.payload?.turn_index)
            : null;
          const companionHookType = typeof action.payload?.hook_type === "string"
            ? action.payload.hook_type
            : null;
          const quickCastSkillId = typeof payload.quick_cast_skill_id === "string" ? payload.quick_cast_skill_id : null;
          if (quickCastSkillId) {
            if (board.board_type !== "combat") {
              return {
                stateChanges: [],
                context: { quick_cast_skill_id: quickCastSkillId },
                error: "Quick-cast actions are only valid during combat mode.",
              };
            }
            if (!combatSessionId || !playerCombatantId) {
              return {
                stateChanges: [],
                context: { quick_cast_skill_id: quickCastSkillId },
                error: "No active player combatant is available for quick-cast.",
              };
            }
            if (combatState.activeTurnCombatantId !== playerCombatantId) {
              return {
                stateChanges: [],
                context: { quick_cast_skill_id: quickCastSkillId },
                error: "Not your turn. Wait for the current turn to finish.",
              };
            }
            const targeting = typeof payload.quick_cast_targeting === "string" ? payload.quick_cast_targeting : "single";
            const payloadTargetCombatantId = typeof payload.target_combatant_id === "string" ? payload.target_combatant_id : null;
            const payloadTargetTile = payload.quick_cast_target_tile && typeof payload.quick_cast_target_tile === "object"
              ? payload.quick_cast_target_tile as Record<string, unknown>
              : null;
            const explicitTileTarget = payloadTargetTile
              && Number.isFinite(Number(payloadTargetTile.x))
              && Number.isFinite(Number(payloadTargetTile.y))
              ? { kind: "tile" as const, x: Math.floor(Number(payloadTargetTile.x)), y: Math.floor(Number(payloadTargetTile.y)) }
              : null;
            const payloadTarget = payloadTargetCombatantId
              ? combatState.combatants.find((entry) => entry.id === payloadTargetCombatantId && entry.is_alive) ?? null
              : null;
            const selected = payloadTarget ?? selectBestQuickCastEnemy(payloadTargetCombatantId);
            const target = targeting === "self"
              ? { kind: "self" } as const
              : targeting === "single"
                ? selected
                  ? { kind: "combatant", combatant_id: selected.id } as const
                  : null
                : explicitTileTarget
                  ?? (selected
                    ? { kind: "tile", x: selected.x, y: selected.y } as const
                    : null);
            if (!target) {
              return {
                stateChanges: [],
                context: { quick_cast_skill_id: quickCastSkillId },
                error: "No valid target is available for quick-cast.",
              };
            }
            const skillName = skills.find((skill) => skill.id === quickCastSkillId)?.name ?? quickCastSkillId;
            const skillResult = await combat.useSkill({
              campaignId,
              combatSessionId,
              actorCombatantId: playerCombatantId,
              skillId: quickCastSkillId,
              currentTurnIndex: Number(combatState.session?.current_turn_index ?? 0),
              target,
            });
            if (!skillResult.ok) {
              return {
                stateChanges: [],
                context: {
                  quick_cast_skill_id: quickCastSkillId,
                  target,
                  combat_use_skill_failed: true,
                },
                error: skillResult.error === "Target out of range"
                  ? "Target out of range. Use Move Here or Advance on Target first."
                  : (skillResult.error || "Quick-cast failed."),
              };
            }
            await Promise.all([refetchCombatState(), refetch()]);
            const combatEventBatch = (skillResult.eventBatch ?? [])
              .filter((event) => (
                event.event_type === "damage"
                || event.event_type === "miss"
                || event.event_type === "healed"
                || event.event_type === "moved"
                || event.event_type === "status_applied"
                || event.event_type === "power_gain"
                || event.event_type === "power_drain"
                || event.event_type === "death"
                || event.event_type === "combat_end"
                || event.event_type === "xp_gain"
                || event.event_type === "loot_drop"
              ))
              .slice(-8);
            return {
              stateChanges: combatEventBatch.length > 0
                ? combatEventBatch.slice(0, 3).map((event) => {
                    if (event.event_type === "damage") return `Quick-cast ${skillName} dealt damage.`;
                    if (event.event_type === "miss") return `Quick-cast ${skillName} missed.`;
                    if (event.event_type === "healed") return `Quick-cast ${skillName} restored health.`;
                    if (event.event_type === "moved") return `Quick-cast ${skillName} repositioned the actor.`;
                    if (event.event_type === "status_applied") return `Quick-cast ${skillName} applied status pressure.`;
                    if (event.event_type === "power_gain") return `Quick-cast ${skillName} restored MP.`;
                    if (event.event_type === "power_drain") return `Quick-cast ${skillName} drained MP.`;
                    if (event.event_type === "death") return "Quick-cast secured a takedown.";
                    if (event.event_type === "combat_end") return "Quick-cast ended the fight.";
                    if (event.event_type === "xp_gain") return "XP awarded.";
                    if (event.event_type === "loot_drop") return "Loot dropped.";
                    return `Quick-cast ${skillName} resolved.`;
                  })
                : [`Quick-cast ${skillName} resolved.`],
              context: {
                quick_cast_skill_id: quickCastSkillId,
                target,
                combat_ended: skillResult.ended,
                authoritative_mutation_applied: true,
                combat_event_batch: combatEventBatch,
              },
            };
          }
          const hasTravelProbe = typeof payload.travel_probe === "string" && payload.travel_probe.trim().length > 0;
          const hasDungeonRoomAction = typeof payload.room_id === "string" && payload.room_id.trim().length > 0
            && typeof payload.action === "string" && payload.action.trim().length > 0;
          const isNoticeBoardPrompt = payload.board_feature === "notice_board"
            || action.id.toLowerCase().includes("notice-board")
            || action.id.toLowerCase().includes("job-");
          if (
            (board.board_type === "travel" && hasTravelProbe)
            || (board.board_type === "dungeon" && hasDungeonRoomAction)
            || (board.board_type === "town" && isNoticeBoardPrompt)
          ) {
            const target = board.board_type;
            const reasonLabel = action.label?.trim() || "Board Interaction";
            const reasonCode = normalizeReasonCode(action.id || reasonLabel);
            const transitionPayload = {
              ...payload,
              from_chat: true,
              reason_code: reasonCode,
              reason_label: reasonLabel,
            };
            const transitionResult = await transitionRuntime(target, reasonLabel, transitionPayload);
            if (!transitionResult.ok) {
              return {
                stateChanges: [],
                context: {
                  mode_target: target,
                  authoritative_mutation_applied: false,
                  transition_payload: transitionPayload,
                },
                error: "Board interaction failed to apply authoritative state mutation.",
              };
            }
            const discoveryFlags = transitionResult.data && typeof transitionResult.data.discovery_flags === "object"
              ? transitionResult.data.discovery_flags as Record<string, unknown>
              : {};
            let autoCombat = null as { combat_session_id: string } | null;
            const shouldAutoStartCombat = discoveryFlags.encounter_triggered === true;
            if (shouldAutoStartCombat) {
              const started = await combat.startCombat(campaignId);
              if (started.ok === false) {
                setCombatStartError({ message: started.message, code: started.code, requestId: started.requestId });
              } else {
                autoCombat = { combat_session_id: started.combatSessionId };
              }
              screenLogger.info("mythic.action.combat_autostart", {
                source,
                intent: action.intent,
                combat_autostart_triggered: true,
                board_type: board.board_type,
                combat_started: Boolean(autoCombat),
              });
            }
            return {
              stateChanges: [
                `Applied ${board.board_type} board interaction.`,
                ...(autoCombat ? ["Combat auto-started from encounter trigger."] : []),
              ],
              context: {
                mode_target: board.board_type,
                companion_followup_resolved: Boolean(companionId),
                companion_id: companionId,
                companion_turn_index: companionTurnIndex,
                companion_hook_type: companionHookType,
                transition_payload: transitionPayload,
                transition_result: transitionResult.data,
                discovery_flags: discoveryFlags,
                authoritative_mutation_applied: true,
                combat_autostart_triggered: shouldAutoStartCombat,
                ...autoCombat,
              },
            };
          }
          return {
            stateChanges: ["Narration-only action requested from board interaction."],
            context: {
              mode_target: board.board_type,
              companion_followup_resolved: Boolean(companionId),
              companion_id: companionId,
              companion_turn_index: companionTurnIndex,
              companion_hook_type: companionHookType,
              authoritative_mutation_applied: false,
            },
          };
        }

        if (resolvedIntent === "combat_start") {
          if (board.board_type !== "combat") {
            const started = await combat.startCombat(campaignId);
            if (started.ok === false) {
              setCombatStartError({ message: started.message, code: started.code, requestId: started.requestId });
              return {
                stateChanges: [],
                context: {
                  combat_start_failed: true,
                  code: started.code,
                  request_id: started.requestId,
                },
                error: started.message || "Combat session did not start.",
              };
            }
            return {
              stateChanges: ["Combat session started."],
              context: { combat_session_id: started.combatSessionId },
            };
          }
          return {
            stateChanges: ["Combat already active on current board."],
            context: { combat_session_id: combatSessionId ?? null, noop: true },
          };
        }

        return {
          stateChanges: [],
          error: `Unsupported action intent: ${action.intent}`,
        };
      },
    });
  }, [
    activeTurnCombatant?.name,
    board,
    campaignId,
    character,
    combat,
    combatSessionId,
    combatState.activeTurnCombatantId,
    combatState.combatants,
    combatState.session?.current_turn_index,
    devSurfaces.enabled,
    findVendorName,
    focusedCombatantId,
    openUtility,
    openShop,
    playerCombatantId,
    refetch,
    refetchCombatState,
    resolveActionIntent,
    runNarratedAction,
    selectBestQuickCastEnemy,
    skills,
    townVendors,
    transitionRuntime,
  ]);

  const triggerConsoleAction = useCallback((action: MythicUiAction, source: UnifiedActionSource = "console_action") => {
    void executeBoardAction(action, source);
  }, [executeBoardAction]);

  const advanceNpcTurn = useCallback(async () => {
    if (!campaignId || !combatSessionId || !canAdvanceNpcTurn) return;
    setIsAdvancingTurn(true);
    let tickSucceeded = false;
    try {
      const activeName = activeTurnCombatant?.name ?? "enemy";
      const beforeTurnIndex = Number(combatState.session?.current_turn_index ?? 0);
      await runNarratedAction({
        source: "combat_enemy_tick",
        intent: "dm_prompt",
        actionId: "enemy_auto_tick",
        appendUser: false,
        payload: {
          combat_session_id: combatSessionId,
          current_turn_index: beforeTurnIndex,
          active_turn_combatant_id: activeTurnCombatant?.id ?? null,
          auto_tick_batch: false,
          max_steps: AUTO_TICK_MAX_STEPS,
        },
        prompt: `${activeName} resolves one non-player step from committed combat events. Narrate only concrete movement, damage, status shifts, and immediate pressure.`,
        execute: async () => {
          const tickResult = await tickCombat({
            campaignId,
            combatSessionId,
            maxSteps: AUTO_TICK_MAX_STEPS,
            currentTurnIndex: beforeTurnIndex,
          });
          if (!tickResult.ok) {
            return {
              stateChanges: [],
              context: {
                combat_tick_failed: true,
              },
              error: tickResult.error || "Enemy turn failed to resolve.",
            };
          }
          tickSucceeded = true;
          await Promise.all([refetchCombatState(), refetch()]);
          const afterTurnIndex = Number(
            (tickResult.data as { current_turn_index?: unknown } | undefined)?.current_turn_index
              ?? beforeTurnIndex,
          );
          const turnAdvance = Math.max(0, afterTurnIndex - beforeTurnIndex);
          const requiresPlayerAction = (tickResult.data as { requires_player_action?: unknown } | undefined)?.requires_player_action === true;
          const combatEventBatch = (tickResult.eventBatch ?? [])
            .filter((event) => (
              event.event_type === "damage"
              || event.event_type === "miss"
              || event.event_type === "healed"
              || event.event_type === "moved"
              || event.event_type === "status_applied"
              || event.event_type === "power_gain"
              || event.event_type === "power_drain"
              || event.event_type === "death"
              || event.event_type === "combat_end"
              || event.event_type === "xp_gain"
              || event.event_type === "loot_drop"
            ))
            .slice(-8);
          const stateChanges = combatEventBatch.length > 0
            ? combatEventBatch.slice(0, 3).map((event) => {
                const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
                const amount = Number(payload.damage_to_hp ?? payload.amount ?? 0);
                if (event.event_type === "damage") return `Damage ${Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0}.`;
                if (event.event_type === "miss") return "Attack missed.";
                if (event.event_type === "healed") return `Heal ${Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0}.`;
                if (event.event_type === "moved") return "Reposition committed.";
                if (event.event_type === "status_applied") return "Status effect applied.";
                if (event.event_type === "power_gain") return `MP gained ${Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0}.`;
                if (event.event_type === "power_drain") return `MP drained ${Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0}.`;
                if (event.event_type === "death") return "A combatant dropped.";
                if (event.event_type === "combat_end") return "Combat resolved.";
                if (event.event_type === "xp_gain") return `XP awarded ${Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0}.`;
                if (event.event_type === "loot_drop") return "Loot awarded.";
                return "Combat state advanced.";
              })
            : [
                turnAdvance > 0
                  ? "Combat step committed."
                  : "Combat state advanced from authoritative tick.",
              ];
          return {
            stateChanges,
            context: {
              combat_tick: tickResult.data ?? null,
              combat_event_batch: combatEventBatch,
              auto_tick_batch: false,
              turn_advance: turnAdvance,
              requires_player_action: requiresPlayerAction,
            },
          };
        },
        onAfterExecute: ({ executionError }) => {
          if (!executionError && tickSucceeded) {
            setCombatAutoPacePhase("step_committed");
          }
        },
        onBeforeNarration: () => {
          if (tickSucceeded) {
            setCombatAutoPacePhase("narrating");
          }
        },
      });
      if (!tickSucceeded) {
        setCombatAutoPacePhase("idle");
        autoTickKeyRef.current = null;
        voiceGateDeadlineRef.current = null;
        voiceGateBaselineEndedAtRef.current = null;
        nextAutoTickReadyAtRef.current = null;
        if (autoTickDelayTimerRef.current !== null) {
          window.clearTimeout(autoTickDelayTimerRef.current);
          autoTickDelayTimerRef.current = null;
        }
        return;
      }
      setCombatAutoStepIndex((prev) => prev + 1);
      nextAutoTickReadyAtRef.current = Date.now() + AUTO_TICK_MIN_STEP_GAP_MS;
      if (shouldGateNpcStepOnVoice) {
        setCombatAutoPacePhase("waiting_voice_end");
        voiceGateDeadlineRef.current = Date.now() + AUTO_TICK_VOICE_DEADLOCK_MS;
        voiceGateBaselineEndedAtRef.current = dmVoice.speechEndedAt;
      } else {
        setCombatAutoPacePhase("next_step_ready");
        voiceGateDeadlineRef.current = null;
        voiceGateBaselineEndedAtRef.current = null;
      }
    } finally {
      setIsAdvancingTurn(false);
    }
  }, [
    activeTurnCombatant?.id,
    activeTurnCombatant?.name,
    campaignId,
    canAdvanceNpcTurn,
    combatSessionId,
    combatState.session?.current_turn_index,
    dmVoice.speechEndedAt,
    refetch,
    refetchCombatState,
    runNarratedAction,
    shouldGateNpcStepOnVoice,
    tickCombat,
  ]);

  const combatantNameById = useCallback((combatantId: string | null | undefined): string | null => {
    if (!combatantId) return null;
    const hit = combatState.combatants.find((entry) => entry.id === combatantId);
    return hit?.name ?? null;
  }, [combatState.combatants]);

  const describeCombatTarget = useCallback((target: { kind: "self" } | { kind: "combatant"; combatant_id: string } | { kind: "tile"; x: number; y: number }) => {
    if (target.kind === "self") return "self";
    if (target.kind === "combatant") return combatantNameById(target.combatant_id) ?? target.combatant_id;
    return `tile (${Math.floor(target.x)},${Math.floor(target.y)})`;
  }, [combatantNameById]);

  const executeCombatSkillNarration = useCallback(async (args: {
    source: "combat_skill" | "combat_quick_cast";
    actorCombatantId: string;
    skillId: string;
    target: { kind: "self" } | { kind: "combatant"; combatant_id: string } | { kind: "tile"; x: number; y: number };
  }) => {
    if (!campaignId || !combatSessionId) return;
    if (combatResolutionPending) {
      toast.error("Combat has resolved. Continue to leave the battlefield.");
      return;
    }
    if (args.actorCombatantId === playerCombatantId && combatState.activeTurnCombatantId !== args.actorCombatantId) {
      toast.error("Not your turn. Wait for the current turn to finish.");
      return;
    }
    const skillName = skills.find((skill) => skill.id === args.skillId)?.name ?? "skill";
    const targetLabel = describeCombatTarget(args.target);
    await runNarratedAction({
      source: args.source,
      intent: "dm_prompt",
      actionId: `${args.source}:${args.skillId}`,
      payload: {
        combat_session_id: combatSessionId,
        actor_combatant_id: args.actorCombatantId,
        skill_id: args.skillId,
        target: args.target,
      },
      prompt: `I use ${skillName} on ${targetLabel}. Narrate the committed combat result and board consequences.`,
      execute: async () => {
        const result = await combat.useSkill({
          campaignId,
          combatSessionId,
          actorCombatantId: args.actorCombatantId,
          skillId: args.skillId,
          currentTurnIndex: Number(combatState.session?.current_turn_index ?? 0),
          target: args.target,
        });
        if (!result.ok) {
          return {
            stateChanges: [],
            context: {
              skill_id: args.skillId,
              target: args.target,
              combat_use_skill_failed: true,
            },
            error: result.error || "Skill execution failed.",
          };
        }
        await Promise.all([refetchCombatState(), refetch()]);
        const combatEventBatch = (result.eventBatch ?? [])
          .filter((event) => (
            event.event_type === "damage"
            || event.event_type === "miss"
            || event.event_type === "healed"
            || event.event_type === "moved"
            || event.event_type === "status_applied"
            || event.event_type === "power_gain"
            || event.event_type === "power_drain"
            || event.event_type === "death"
            || event.event_type === "combat_end"
            || event.event_type === "xp_gain"
            || event.event_type === "loot_drop"
          ))
          .slice(-8);
        return {
          stateChanges: combatEventBatch.length > 0
            ? combatEventBatch.slice(0, 3).map((event) => {
                if (event.event_type === "damage") return `Hit landed on ${targetLabel}.`;
                if (event.event_type === "miss") return `Attack on ${targetLabel} missed.`;
                if (event.event_type === "healed") return `Healing resolved for ${targetLabel}.`;
                if (event.event_type === "moved") return "Movement resolved.";
                if (event.event_type === "status_applied") return "Status effect applied.";
                if (event.event_type === "power_gain") return "MP gained.";
                if (event.event_type === "power_drain") return "MP drained.";
                if (event.event_type === "death") return "Target dropped.";
                if (event.event_type === "combat_end") return "Combat resolved.";
                if (event.event_type === "xp_gain") return "XP granted.";
                if (event.event_type === "loot_drop") return "Loot granted.";
                return `Used ${skillName} on ${targetLabel}.`;
              })
            : [`Used ${skillName} on ${targetLabel}.`],
          context: {
            skill_id: args.skillId,
            target: args.target,
            combat_ended: result.ended,
            combat_event_batch: combatEventBatch,
          },
        };
      },
    });
  }, [
    campaignId,
    combat,
    combatResolutionPending,
    combatSessionId,
    combatState.activeTurnCombatantId,
    combatState.session?.current_turn_index,
    describeCombatTarget,
    playerCombatantId,
    refetch,
    refetchCombatState,
    runNarratedAction,
    skills,
  ]);

  const quickCastAvailability = useMemo(
    () => commandSkillAvailability.filter((entry) => entry.kind === "active" || entry.kind === "ultimate").slice(0, 8),
    [commandSkillAvailability],
  );

  const characterSheetModel = useMemo(() => {
    if (!character || !board) return null;
    return buildCharacterSheetViewModel({
      character,
      boardMode: board.board_type,
      coins,
      skills,
      inventoryRows: invRowsSafe,
      questThreads,
      companionNotes: companionCheckins.map((entry) => ({
        id: entry.id,
        companionId: entry.companionId,
        name: entry.name,
        archetype: entry.archetype,
        voice: entry.voice,
        line: entry.line,
        mood: entry.mood,
        urgency: entry.urgency,
        hookType: entry.hookType,
        turnIndex: entry.turnIndex,
        stance: entry.stance,
        directive: entry.directive,
        targetHint: entry.targetHint,
      })),
      skillAvailability: commandSkillAvailability,
      combatants: combatState.combatants,
      playerCombatantId,
      activeTurnCombatantId: combatState.activeTurnCombatantId,
      focusedCombatantId,
      combatStatus: combatState.session?.status ?? null,
      rewardSummary: combatRewardSummary,
    });
  }, [
    board,
    character,
    coins,
    commandSkillAvailability,
    companionCheckins,
    combatState.activeTurnCombatantId,
    combatState.combatants,
    combatState.session?.status,
    combatRewardSummary,
    focusedCombatantId,
    invRowsSafe,
    playerCombatantId,
    questThreads,
    skills,
  ]);

  const boardScene = useMemo(() => {
    return buildNarrativeBoardScene({
      mode: board?.board_type ?? "town",
      boardState: board?.state_json ?? {},
      dmContext: mythicDmContext.context,
      combat: {
        session: combatState.session,
        combatants: combatState.combatants,
        events: combatState.events,
        activeTurnCombatantId: combatState.activeTurnCombatantId,
        playerCombatantId,
        focusedCombatantId,
        quickCastAvailability,
        paceState: combatPaceModel,
        rewardSummary: combatRewardSummary,
        resolutionPending: combatResolutionPending,
      },
    });
  }, [
    board?.board_type,
    board?.state_json,
    combatState.activeTurnCombatantId,
    combatState.combatants,
    combatState.events,
    combatState.session,
    combatPaceModel,
    combatRewardSummary,
    combatResolutionPending,
    focusedCombatantId,
    mythicDmContext.context,
    playerCombatantId,
    quickCastAvailability,
  ]);

  const boardStripBase = useMemo(() => {
    return buildBoardBaseActions({
      assistantActions: latestAssistantActions,
      runtimeActions: persistedRuntimeActions,
      companionAction: companionFollowupAction,
      fallbackActions: boardScene.fallbackActions,
    });
  }, [boardScene.fallbackActions, companionFollowupAction, latestAssistantActions, persistedRuntimeActions]);
  const boardStripBaseActions = boardStripBase.actions;

  const selectQuickCastTarget = useCallback((targeting: string) => {
    if (targeting === "self") {
      return { kind: "self" } as const;
    }
    const selected = selectBestQuickCastEnemy();
    if (!selected) return null;
    if (targeting === "single") {
      return { kind: "combatant", combatant_id: selected.id } as const;
    }
    return { kind: "tile", x: selected.x, y: selected.y } as const;
  }, [selectBestQuickCastEnemy]);

  const triggerQuickCast = useCallback(async (skillId: string, targeting: string) => {
    if (!playerCombatantId || !combatSessionId) return;
    if (combatResolutionPending) {
      toast.error("Combat has resolved. Continue to leave the battlefield.");
      return;
    }
    if (combatState.activeTurnCombatantId !== playerCombatantId) {
      toast.error("Not your turn. Wait for the current turn to finish.");
      return;
    }
    const target = selectQuickCastTarget(targeting);
    if (!target) {
      toast.error("No valid combat target is available.");
      return;
    }
    const player = combatState.combatants.find((entry) => entry.id === playerCombatantId && entry.is_alive) ?? null;
    const targetedCombatant = target.kind === "combatant"
      ? combatState.combatants.find((entry) => entry.id === target.combatant_id && entry.is_alive) ?? null
      : null;
    const skill = skills.find((entry) => entry.id === skillId) ?? null;
    if (player && targetedCombatant && skill) {
      const metricRaw = String(skill.targeting_json?.metric ?? "manhattan").toLowerCase();
      const dx = Math.abs(player.x - targetedCombatant.x);
      const dy = Math.abs(player.y - targetedCombatant.y);
      const distance = metricRaw === "euclidean"
        ? Math.sqrt((dx * dx) + (dy * dy))
        : metricRaw === "chebyshev"
          ? Math.max(dx, dy)
          : dx + dy;
      const rangeTiles = Math.max(0, Number(skill.range_tiles ?? 0));
      if (distance > rangeTiles) {
        toast.error("Target out of range. Use Move Here or Advance on Target first.");
        return;
      }
    }
    await executeCombatSkillNarration({
      source: "combat_quick_cast",
      actorCombatantId: playerCombatantId,
      skillId,
      target,
    });
  }, [
    combatResolutionPending,
    combatSessionId,
    combatState.activeTurnCombatantId,
    combatState.combatants,
    executeCombatSkillNarration,
    playerCombatantId,
    selectQuickCastTarget,
    skills,
  ]);

  const retryLastAction = useCallback(() => {
    if (!lastPlayerInputRef.current) return;
    void handlePlayerInput(lastPlayerInputRef.current);
  }, [handlePlayerInput]);

  const retryCombatStart = useCallback(async () => {
    if (!campaignId) return;
    setCombatStartError(null);
    try {
      const started = await combat.startCombat(campaignId);
      if (started.ok === false) {
        setCombatStartError({ message: started.message, code: started.code, requestId: started.requestId });
        toast.error(started.message || "Combat session failed to start.");
        return;
      }
      await Promise.all([refetch(), refetchCombatState()]);
      toast.success("Combat started");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Combat session failed to start.";
      setCombatStartError({ message, code: null, requestId: null });
      toast.error(message);
    }
  }, [campaignId, combat, refetch, refetchCombatState]);

  useEffect(() => {
    if (canAdvanceNpcTurn) return;
    setCombatAutoPacePhase("idle");
    setCombatAutoStepIndex(0);
    autoTickKeyRef.current = null;
    voiceGateDeadlineRef.current = null;
    voiceGateBaselineEndedAtRef.current = null;
    nextAutoTickReadyAtRef.current = null;
    if (autoTickDelayTimerRef.current !== null) {
      window.clearTimeout(autoTickDelayTimerRef.current);
      autoTickDelayTimerRef.current = null;
    }
  }, [canAdvanceNpcTurn]);

  useEffect(() => {
    return () => {
      if (autoTickDelayTimerRef.current !== null) {
        window.clearTimeout(autoTickDelayTimerRef.current);
        autoTickDelayTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!canAdvanceNpcTurn) return;
    if (combatAutoPacePhase !== "waiting_voice_end") return;
    if (!shouldGateNpcStepOnVoice) {
      voiceGateDeadlineRef.current = null;
      voiceGateBaselineEndedAtRef.current = null;
      setCombatAutoPacePhase("next_step_ready");
      return;
    }
    if (dmVoice.isSpeaking) return;
    const now = Date.now();
    const deadline = voiceGateDeadlineRef.current;
    const baselineEndedAt = voiceGateBaselineEndedAtRef.current;
    const hasNewSpeechEnd = (
      typeof dmVoice.speechEndedAt === "number"
      && dmVoice.speechEndedAt > 0
      && dmVoice.speechEndedAt !== baselineEndedAt
    );
    if (hasNewSpeechEnd) {
      voiceGateDeadlineRef.current = null;
      voiceGateBaselineEndedAtRef.current = null;
      setCombatAutoPacePhase("next_step_ready");
      return;
    }
    if (deadline !== null && now >= deadline) {
      screenLogger.warn("mythic.combat.voice_gate_timeout", {
        campaign_id: campaignId,
        combat_session_id: combatSessionId,
        turn_index: combatState.session?.current_turn_index ?? null,
        phase: combatAutoPacePhase,
      });
      voiceGateDeadlineRef.current = null;
      voiceGateBaselineEndedAtRef.current = null;
      setCombatAutoPacePhase("next_step_ready");
    }
  }, [
    campaignId,
    canAdvanceNpcTurn,
    combatAutoPacePhase,
    combatSessionId,
    combatState.session?.current_turn_index,
    dmVoice.isSpeaking,
    dmVoice.speechEndedAt,
    shouldGateNpcStepOnVoice,
  ]);

  useEffect(() => {
    if (!canAdvanceNpcTurn) return;
    if (isAdvancingTurn || isNarratedActionBusy || dmLoading || combat.isTicking) return;
    if (combatAutoPacePhase === "waiting_voice_end" || combatAutoPacePhase === "narrating" || combatAutoPacePhase === "step_committed") {
      return;
    }
    if (shouldGateNpcStepOnVoice && dmVoice.isSpeaking) {
      setCombatAutoPacePhase("waiting_voice_end");
      voiceGateDeadlineRef.current = Date.now() + AUTO_TICK_VOICE_DEADLOCK_MS;
      voiceGateBaselineEndedAtRef.current = dmVoice.speechEndedAt;
      return;
    }
    const readyAt = nextAutoTickReadyAtRef.current;
    if (typeof readyAt === "number" && Date.now() < readyAt) {
      if (autoTickDelayTimerRef.current !== null) {
        window.clearTimeout(autoTickDelayTimerRef.current);
      }
      autoTickDelayTimerRef.current = window.setTimeout(() => {
        autoTickDelayTimerRef.current = null;
        setAutoTickGateNonce((prev) => prev + 1);
      }, Math.max(40, readyAt - Date.now()));
      return;
    }
    if (autoTickDelayTimerRef.current !== null) {
      window.clearTimeout(autoTickDelayTimerRef.current);
      autoTickDelayTimerRef.current = null;
    }
    const key = `${combatSessionId}:${combatState.session?.current_turn_index ?? -1}:${activeTurnCombatant?.id ?? "none"}`;
    if (autoTickKeyRef.current === key) return;
    autoTickKeyRef.current = key;
    void advanceNpcTurn();
  }, [
    advanceNpcTurn,
    activeTurnCombatant?.id,
    autoTickGateNonce,
    canAdvanceNpcTurn,
    combat.isTicking,
    combatAutoPacePhase,
    combatSessionId,
    combatState.session?.current_turn_index,
    dmVoice.isSpeaking,
    dmVoice.speechEndedAt,
    dmLoading,
    isAdvancingTurn,
    isNarratedActionBusy,
    shouldGateNpcStepOnVoice,
  ]);

  const isInitialScreenLoading = authLoading || boardInitialLoading || charInitialLoading || isBootstrapping;
  const isStateRefreshing = boardRefreshing || charRefreshing || combatState.isRefreshing;

  if (!campaignId) {
    return <div className="p-6 text-sm text-muted-foreground">Campaign not found.</div>;
  }

  if (isInitialScreenLoading) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span>Loading Mythic Weave state...</span>
      </div>
    );
  }

  if (boardError || charError) {
    return (
      <div className="space-y-3 p-6 text-sm text-muted-foreground">
        <div className="text-destructive">{boardError ?? charError}</div>
        <Button variant="outline" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="space-y-3 p-6 text-sm text-muted-foreground">
        <div>No Mythic character found for this campaign.</div>
        <Button onClick={() => navigate(`/mythic/${campaignId}/create-character`)}>Create Character</Button>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="space-y-3 p-6 text-sm text-muted-foreground">
        <div>No active Mythic board found.</div>
        <Button onClick={() => refetch()}>Refresh</Button>
      </div>
    );
  }

  const panelControlsContent = (
    <div className="space-y-3">
      {transitionError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {transitionError}
        </div>
      ) : null}
      {combatStartError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <div className="font-medium text-foreground">Failed to initiate combat</div>
          <div className="mt-1">{combatStartError.message}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {combatStartError.code ? <span>code: {combatStartError.code}</span> : null}
            {combatStartError.requestId ? <span>requestId: {combatStartError.requestId}</span> : null}
          </div>
          <div className="mt-2">
            <Button size="sm" variant="secondary" onClick={() => void retryCombatStart()}>
              Retry combat start
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={activePanel === "status" ? "default" : "secondary"} onClick={() => setActivePanel("status")}>Status</Button>
        <Button size="sm" variant={activePanel === "skills" ? "default" : "secondary"} onClick={() => setActivePanel("skills")}>Skills</Button>
        <Button size="sm" variant={activePanel === "combat" ? "default" : "secondary"} onClick={() => setActivePanel("combat")}>Combat</Button>
        <Button size="sm" variant={activePanel === "quests" ? "default" : "secondary"} onClick={() => setActivePanel("quests")}>Quests</Button>
        <Button size="sm" variant={activePanel === "companions" ? "default" : "secondary"} onClick={() => setActivePanel("companions")}>Companions</Button>
        <Button size="sm" variant={activePanel === "shop" ? "default" : "secondary"} onClick={() => setActivePanel("shop")}>Shop</Button>
      </div>

      {activePanel === "status" ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Character Sheet</div>
                <div className="text-xs text-muted-foreground">
                  Identity, stats, HP/MP gauges, companions, and quests live in the unified sheet.
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => openCharacterSheet("overview")}>
                Open Sheet
              </Button>
            </div>
            {characterSheetModel ? (
              <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                <div>{characterSheetModel.name} · Level {characterSheetModel.level}</div>
                <div>Mode {characterSheetModel.boardMode}</div>
              <div>HP {characterSheetModel.hpGauge.current}/{characterSheetModel.hpGauge.max}</div>
              <div>MP {characterSheetModel.mpGauge.current}/{characterSheetModel.mpGauge.max}</div>
              <div>Armor {characterSheetModel.combat.armor}</div>
              <div>Coins {characterSheetModel.coins}</div>
              <div>Off/Def {derivedStats.offense}/{derivedStats.defense}</div>
              <div>Ctrl/Sup {derivedStats.control}/{derivedStats.support}</div>
            </div>
          ) : null}
        </div>
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <div className="mb-2 text-sm font-semibold">Progression Feed</div>
            {progressionEvents.length === 0 ? (
              <div className="text-xs text-muted-foreground">No progression events yet.</div>
            ) : (
              <div className="space-y-1">
                {progressionEvents.slice(0, 8).map((event) => (
                  <div key={event.id} className="rounded border border-border bg-background/20 px-2 py-1 text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">{event.event_type}</div>
                    <div>{new Date(event.created_at).toLocaleTimeString()}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activePanel === "skills" ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <div className="mb-1 text-sm font-semibold">Combat Skills</div>
            <div className="mb-2 text-xs text-muted-foreground">
              All active and ultimate skills are castable from current MP/cooldown state.
            </div>
            {commandSkillAvailability.length === 0 ? (
              <div className="text-xs text-muted-foreground">No active combat skills are loaded.</div>
            ) : (
              <div className="space-y-2">
                {commandSkillAvailability.map((skill) => (
                  <div key={skill.skillId} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                    <div className="font-medium text-foreground">{skill.name}</div>
                    <div className="text-muted-foreground">
                      MP {Math.max(0, Math.floor(Number(skills.find((entry) => entry.id === skill.skillId)?.cost_json?.power ?? skills.find((entry) => entry.id === skill.skillId)?.cost_json?.mp ?? skills.find((entry) => entry.id === skill.skillId)?.cost_json?.amount ?? 0)))} · {skill.targeting} · range {skill.rangeTiles} · cooldown {skill.cooldownTurns}
                      {skill.cooldownRemaining > 0 ? ` (${skill.cooldownRemaining} remaining)` : ""}
                    </div>
                    <div className={skill.usableNow ? "mt-1 text-emerald-300" : "mt-1 text-amber-200"}>
                      {skill.usableNow ? "Ready" : (skill.reason ?? "Unavailable")}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3">
              <Button size="sm" variant="secondary" onClick={() => openCharacterSheet("skills")}>
                Open Full Skills Sheet
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <div className="mb-1 text-sm font-semibold">Passive Skills</div>
            {passiveSkills.length === 0 ? (
              <div className="text-xs text-muted-foreground">No passive skills recorded.</div>
            ) : (
              <div className="grid gap-2">
                {passiveSkills.map((skill) => (
                  <div key={skill.id} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                    <div className="font-medium text-foreground">{skill.name}</div>
                    <div className="text-muted-foreground">{skill.kind}</div>
                    {skill.description ? <div className="mt-1 text-muted-foreground">{skill.description}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activePanel === "combat" ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold">Combat Controls</div>
                <div className="text-xs text-muted-foreground">
                  Status: {combatState.session?.status ?? "idle"} · Focused target:{" "}
                  {focusedCombatantId
                    ? (combatState.combatants.find((entry) => entry.id === focusedCombatantId)?.name ?? focusedCombatantId)
                    : "none"}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void retryCombatStart()}
                disabled={combatState.session?.status === "active"}
              >
                {combatState.session?.status === "active" ? "Combat Active" : "Start Combat"}
              </Button>
            </div>
            {quickCastAvailability.length === 0 ? (
              <div className="text-xs text-muted-foreground">No active combat skills available.</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {quickCastAvailability.map((entry) => (
                  <Button
                    key={`quick-cast-${entry.skillId}`}
                    size="sm"
                    variant={entry.usableNow ? "default" : "secondary"}
                    disabled={!entry.usableNow || !playerCombatantId || !combatSessionId || combat.isActing}
                    onClick={() => void triggerQuickCast(entry.skillId, entry.targeting)}
                    className="justify-between"
                  >
                    <span className="truncate">{entry.name}</span>
                    <span className="ml-2 text-[10px] uppercase tracking-wide">
                      {entry.usableNow ? "Cast" : (entry.reason ?? "Locked")}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <div className="mb-1 text-sm font-semibold">Live Combat Skill Availability</div>
            {commandSkillAvailability.length === 0 ? (
              <div className="text-xs text-muted-foreground">No active combat skills loaded.</div>
            ) : (
              <div className="space-y-2">
                {commandSkillAvailability.map((entry) => (
                  <div key={entry.skillId} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-foreground">{entry.name}</div>
                      <div className={entry.usableNow ? "text-emerald-300" : "text-amber-200"}>
                        {entry.usableNow ? "Ready" : entry.reason ?? "Unavailable"}
                      </div>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      {entry.targeting} · range {entry.rangeTiles} · cooldown {entry.cooldownTurns}
                      {entry.rangeToFocused !== null
                        ? ` · focused range ${entry.rangeToFocused.toFixed(1)} (${entry.inRangeForFocused ? "in" : "out"})`
                        : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activePanel === "quests" ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <div className="mb-1 text-sm font-semibold">Persistent Threads</div>
            {questThreads.length === 0 ? (
              <div className="text-xs text-muted-foreground">No persistent quest threads yet.</div>
            ) : (
              <div className="max-h-[260px] space-y-2 overflow-auto pr-1">
                {questThreads.map((thread) => (
                  <div key={thread.id} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-foreground">{thread.title}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{thread.source}</div>
                    </div>
                    {thread.detail ? <div className="mt-1 text-muted-foreground">{thread.detail}</div> : null}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Severity {thread.severity} · {new Date(thread.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <div className="mb-1 text-sm font-semibold">World Hooks</div>
            {boardHooks.length === 0 ? (
              <div className="text-xs text-muted-foreground">No active hooks on this mode yet.</div>
            ) : (
              <div className="space-y-2">
                {boardHooks.map((hook) => (
                  <div key={hook.id} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                    <div className="font-medium text-foreground">{hook.title}</div>
                    {hook.detail ? <div className="mt-1 text-muted-foreground">{hook.detail}</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activePanel === "companions" ? (
        <div className="space-y-3">
          <div className="rounded-lg border border-border bg-background/30 p-3">
            <div className="mb-1 text-sm font-semibold">Companion Check-Ins</div>
            {companionCheckins.length === 0 ? (
              <div className="text-xs text-muted-foreground">No companion check-ins yet.</div>
            ) : (
              <div className="space-y-2">
                {companionCheckins.slice().reverse().slice(0, 8).map((entry) => (
                  <div key={entry.id} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                    <div className="font-medium text-foreground">{entry.companionId}</div>
                    <div className="mt-1 text-muted-foreground">{entry.line}</div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      Mood {entry.mood} · Urgency {entry.urgency}
                    </div>
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={mythicDm.isLoading}
                        onClick={() => triggerConsoleAction({
                          id: `companion-followup-${entry.id}`,
                          label: "Follow up",
                          intent: "companion_action",
                          prompt: `I follow up on ${entry.companionId}: "${entry.line}" and act on their guidance.`,
                          payload: {
                            companion_id: entry.companionId,
                            mood: entry.mood,
                            urgency: entry.urgency,
                            hook_type: entry.hookType,
                            turn_index: entry.turnIndex,
                          },
                        })}
                      >
                        Follow Up
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {activePanel === "shop" ? (
        <div className="rounded-lg border border-border bg-background/30 p-3">
          <div className="mb-1 text-sm font-semibold">Town Vendors</div>
          {townVendors.length === 0 ? (
            <div className="text-xs text-muted-foreground">No vendors available in this mode. Move to town to trade.</div>
          ) : (
            <div className="space-y-2">
              {townVendors.map((vendor) => (
                <div key={vendor.id} className="flex items-center justify-between gap-2 rounded border border-border bg-background/20 px-2 py-2">
                  <div className="text-sm font-medium">{vendor.name}</div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void executeBoardAction({
                      id: `shop-open-${vendor.id}`,
                      label: `Open ${vendor.name}`,
                      intent: "shop_action",
                      payload: { vendorId: vendor.id },
                      prompt: `I open ${vendor.name} and review current stock.`,
                    }, "console_action")}
                  >
                    Open Shop
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );

  return (
    <>
      <BookShell
        title="Mythic Weave"
        subtitle={(
          <>
            Mode: <span className="font-medium capitalize">{board.board_type}</span>
            <span className="ml-2 text-amber-100/70">Campaign: {campaignId.slice(0, 8)}...</span>
            {isStateRefreshing ? (
              <span className="ml-3 inline-flex items-center gap-1 text-amber-100/75">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Syncing state
              </span>
            ) : null}
          </>
        )}
        actions={(
          <Button
            size="sm"
            onClick={() => openUtility("panels")}
            className="border border-amber-200/40 bg-amber-300/20 text-amber-50 hover:bg-amber-300/30"
          >
            Menu
          </Button>
        )}
        leftPage={(
          <NarrativePage
            messages={mythicDm.messages}
            isDmLoading={mythicDm.isLoading || isNarratedActionBusy}
            currentResponse={mythicDm.currentResponse}
            dmPhase={mythicDm.phase}
            operationAttempt={mythicDm.operation?.attempt}
            operationNextRetryAt={mythicDm.operation?.next_retry_at}
            actionError={actionError}
            voiceEnabled={dmVoice.enabled}
            voiceSupported={dmVoice.supported}
            voiceBlocked={dmVoice.blocked}
            onToggleVoice={dmVoice.setEnabled}
            onSpeakLatest={() => {
              if (!latestAssistantNarration) return;
              if (dmVoice.blocked && dmVoice.hasPreparedAudio) {
                void dmVoice.resumeLatest();
                return;
              }
              dmVoice.speak(latestAssistantNarration, latestAssistantMessage?.id ?? null, { force: true });
            }}
            onStopVoice={dmVoice.stop}
            autoFollow={runtimeSettings.chatAutoFollow}
            onRetryAction={retryLastAction}
            onSendMessage={(message) => void handlePlayerInput(message)}
            onCancelMessage={() => mythicDm.cancelMessage()}
          />
        )}
        rightPage={(
          <div className="flex h-full min-h-0 flex-col gap-2 p-2">
            <div className="min-h-0 flex-1">
              <NarrativeBoardPage
                scene={boardScene}
                baseActions={boardStripBaseActions}
                isBusy={mythicDm.isLoading || isNarratedActionBusy || combat.isActing || combat.isTicking}
                isStateRefreshing={isStateRefreshing}
                transitionError={transitionError}
                combatStartError={combatStartError}
                dmContextError={mythicDmContext.error}
                showDevDetails={devSurfaces.enabled}
                onRetryCombatStart={() => void retryCombatStart()}
                onQuickCast={(skillId, targeting) => void triggerQuickCast(skillId, targeting)}
                onContinueCombatResolution={() => void continueAfterCombatResolution()}
                onAction={(action, source) => triggerConsoleAction(action, source === "board_hotspot" ? "board_hotspot" : "console_action")}
              />
            </div>
          </div>
        )}
      />

      {characterSheetModel && profileDraft ? (
        <CharacterSheetSurface
          open={characterSheetOpen}
          onOpenChange={setCharacterSheetOpen}
          model={characterSheetModel}
          section={characterSheetSection}
          onSectionChange={setCharacterSheetSection}
          draft={profileDraft}
          onDraftChange={handleProfileDraftChange}
          saveState={profileSaveState}
          equipmentBusy={isEquipmentBusy}
          equipmentError={equipmentActionError}
          onEquipItem={(inventoryId) => { void equipInventoryItem(inventoryId); }}
          onUnequipItem={(inventoryId) => { void unequipInventoryItem(inventoryId); }}
          partyBusy={isPartyCommandBusy}
          partyError={partyCommandError}
          onIssueCompanionCommand={(payload) => { void issueCompanionCommand(payload); }}
        />
      ) : null}

      <Sheet open={utilityDrawerOpen} onOpenChange={setUtilityDrawerOpen}>
        <SheetContent side="right" className="w-[420px] border border-amber-200/20 bg-[linear-gradient(180deg,rgba(17,14,10,0.95),rgba(8,10,16,0.98))] text-amber-50 sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle className="font-display text-amber-100">Utility Drawer</SheetTitle>
            <SheetDescription className="text-amber-100/70">
              {devSurfaces.enabled
                ? "Character controls, settings, logs, and diagnostics."
                : "Character controls and settings."}
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant={utilityTab === "panels" ? "default" : "secondary"} onClick={() => setUtilityTab("panels")}>Panels</Button>
            <Button size="sm" variant={utilityTab === "settings" ? "default" : "secondary"} onClick={() => setUtilityTab("settings")}>Settings</Button>
            {devSurfaces.enabled ? (
              <>
                <Button size="sm" variant={utilityTab === "logs" ? "default" : "secondary"} onClick={() => setUtilityTab("logs")}>Logs</Button>
                <Button size="sm" variant={utilityTab === "diagnostics" ? "default" : "secondary"} onClick={() => setUtilityTab("diagnostics")}>Diagnostics</Button>
              </>
            ) : null}
          </div>
          <div className="mt-4 max-h-[calc(100vh-170px)] overflow-auto pr-1">
            {utilityTab === "panels" ? panelControlsContent : null}

            {utilityTab === "settings" ? (
              <div className="space-y-3">
                <SettingsPanel
                  settings={runtimeSettings}
                  onSettingsChange={setRuntimeSettings}
                  voiceEnabled={dmVoice.enabled}
                  voiceSupported={dmVoice.supported}
                  voiceBlocked={dmVoice.blocked}
                  onToggleVoice={dmVoice.setEnabled}
                  onSpeakLatest={() => {
                    if (!latestAssistantNarration) return;
                    if (dmVoice.blocked && dmVoice.hasPreparedAudio) {
                      void dmVoice.resumeLatest();
                      return;
                    }
                    dmVoice.speak(latestAssistantNarration, latestAssistantMessage?.id ?? null, { force: true });
                  }}
                  onStopVoice={dmVoice.stop}
                />

                {devSurfaces.allowed ? (
                  <div className="rounded-lg border border-border bg-background/30 p-3">
                    <div className="mb-1 text-sm font-semibold">Developer Surfaces</div>
                    <div className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={devSurfaces.enabled}
                        onCheckedChange={devSurfaces.setEnabled}
                        aria-label="Toggle developer surfaces"
                      />
                      <span className="text-muted-foreground">
                        {devSurfaces.enabled
                          ? "Logs, diagnostics, and technical detail are visible."
                          : "Player-facing mode is active. Developer panels are hidden."}
                      </span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {devSurfaces.enabled && utilityTab === "logs" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-amber-200/20 bg-background/20 p-3">
                  <div className="mb-1 text-sm font-semibold">Command Reference</div>
                  <div className="grid gap-1 text-xs text-amber-100/80">
                    <div><span className="font-medium text-amber-100">Natural:</span> "go to town", "travel to dungeon", "start combat", "use fireball on raider"</div>
                    <div><span className="font-medium text-amber-100">Slash:</span> <code>/travel town|travel|dungeon</code></div>
                    <div><span className="font-medium text-amber-100">Slash:</span> <code>/combat start</code></div>
                    <div><span className="font-medium text-amber-100">Slash:</span> <code>/skills</code> <code>/status</code> <code>/menu skills</code></div>
                    <div><span className="font-medium text-amber-100">Slash:</span> <code>/skill &lt;name&gt; @&lt;target&gt;</code></div>
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200/20 bg-background/20 p-3">
                  <div className="mb-1 text-sm font-semibold">Recent Narrative Messages</div>
                  {mythicDm.messages.length === 0 ? (
                    <div className="text-xs text-amber-100/70">No messages yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {mythicDm.messages.slice(-8).reverse().map((message) => (
                        <div key={`log-${message.id}`} className="rounded border border-amber-200/15 bg-background/20 px-2 py-2 text-xs">
                          <div className="font-medium uppercase tracking-wide text-amber-100/80">{message.role}</div>
                          <div className="mt-1 whitespace-pre-wrap text-amber-100/80">
                            {(message.role === "assistant" ? (message.parsed?.narration ?? message.content) : message.content).slice(0, 280)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {devSurfaces.enabled && utilityTab === "diagnostics" ? (
              <div className="rounded-lg border border-amber-200/20 bg-background/20 p-3 text-xs text-amber-100/80">
                <div className="mb-2 text-sm font-semibold">Runtime Diagnostics</div>
                <div>campaign_id: {campaignId}</div>
                <div>mode: {board.board_type}</div>
                <div>dm_messages: {mythicDm.messages.length}</div>
                <div>dm_loading: {mythicDm.isLoading ? "true" : "false"}</div>
                <div>dm_last_error_kind: {mythicDm.lastError?.kind ?? "none"}</div>
                <div>dm_last_error_code: {mythicDm.lastError?.code ?? "none"}</div>
                <div>dm_last_error_request_id: {mythicDm.lastError?.requestId ?? "none"}</div>
                <div>dm_last_response_request_id: {mythicDm.lastResponseMeta?.requestId ?? "none"}</div>
                <div>dm_last_response_recovery_used: {mythicDm.lastResponseMeta?.recoveryUsed ? "true" : "false"}</div>
                <div>dm_last_response_recovery_reason: {mythicDm.lastResponseMeta?.recoveryReason ?? "none"}</div>
                <div>dm_last_response_validation_attempts: {mythicDm.lastResponseMeta?.validationAttempts ?? "none"}</div>
                <div>narrated_action_busy: {isNarratedActionBusy ? "true" : "false"}</div>
                <div>state_refreshing: {isStateRefreshing ? "true" : "false"}</div>
                <div>board_id: {board.id}</div>
                <div>combat_session_id: {combatSessionId ?? "none"}</div>
                <div>active_panel: {activePanel}</div>
                <div>board_actions: {boardStripBaseActions.length}</div>
                <div>board_layout_seed: {boardScene.layout.seed}</div>
                <div>board_legend_items: {boardScene.legend.length}</div>
                <div>dm_context_loading: {mythicDmContext.isInitialLoading || mythicDmContext.isRefreshing ? "true" : "false"}</div>
                <div>dm_context_warnings: {mythicDmContext.context?.warnings?.length ?? 0}</div>
                {transitionError ? <div className="mt-2 text-destructive">transition_error: {transitionError}</div> : null}
                {actionError ? <div className="mt-1 text-destructive">action_error: {actionError}</div> : null}
                {mythicDmContext.error ? <div className="mt-1 text-amber-200">dm_context_error: {mythicDmContext.error}</div> : null}
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <ShopDialog
        open={shopOpen}
        campaignId={campaignId}
        characterId={character.id}
        vendorId={shopVendor?.id ?? null}
        vendorName={shopVendor?.name ?? null}
        coins={coins}
        onOpenChange={(open) => {
          setShopOpen(open);
          if (!open) setShopVendor(null);
        }}
        onPurchased={async () => {
          await refetchCharacter();
        }}
      />
    </>
  );
}
