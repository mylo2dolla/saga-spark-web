import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { PromptAssistField } from "@/components/PromptAssistField";
import { useAuth } from "@/hooks/useAuth";
import { useMythicCreator } from "@/hooks/useMythicCreator";
import { useMythicBoard } from "@/hooks/useMythicBoard";
import { useMythicCharacter } from "@/hooks/useMythicCharacter";
import {
  useMythicDungeonMaster,
  type MythicDmParsedPayload,
  type MythicUiAction,
} from "@/hooks/useMythicDungeonMaster";
import { useMythicDmVoice } from "@/hooks/useMythicDmVoice";
import { useMythicCombat } from "@/hooks/useMythicCombat";
import { useMythicCombatState } from "@/hooks/useMythicCombatState";
import { MythicInventoryPanel } from "@/components/mythic/MythicInventoryPanel";
import { callEdgeFunction } from "@/lib/edge";
import { sumStatMods, splitInventory, type MythicInventoryRow } from "@/lib/mythicEquipment";
import { parsePlayerCommand, type PlayerCommandPanel } from "@/lib/mythic/playerCommandParser";
import { executePlayerCommand } from "@/lib/mythic/playerCommandExecutor";
import { buildSkillAvailability } from "@/lib/mythic/skillAvailability";
import { createLogger } from "@/lib/observability/logger";
import { toast } from "sonner";
import { BookShell } from "@/ui/components/mythic/BookShell";
import { NarrativePage } from "@/ui/components/mythic/NarrativePage";
import { BoardPage } from "@/ui/components/mythic/BoardPage";
import { BoardInspectDialog } from "@/ui/components/mythic/BoardInspectDialog";
import { ShopDialog } from "@/ui/components/mythic/ShopDialog";
import { SettingsPanel, type MythicRuntimeSettings } from "@/ui/components/mythic/SettingsPanel";
import type { BoardInspectTarget } from "@/ui/components/mythic/board/inspectTypes";

type MythicPanelTab = "character" | "gear" | "skills" | "loadouts" | "progression" | "quests" | "commands" | "settings";
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
  const hooks = [...rawRumors, ...rawObjectives, ...rawDiscovery, ...rawCheckins];
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
  if (
    panel === "character" ||
    panel === "gear" ||
    panel === "skills" ||
    panel === "loadouts" ||
    panel === "progression" ||
    panel === "quests" ||
    panel === "commands" ||
    panel === "settings"
  ) {
    return panel;
  }
  return null;
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

const MAX_DYNAMIC_CHIPS = 6;
const LOW_SIGNAL_CHIP_LABEL = /^(action\s+\d+|narrative update)$/i;
const screenLogger = createLogger("mythic-game-screen");

type UnifiedActionSource =
  | "typed_command"
  | "dm_chip"
  | "board_hotspot"
  | "combat_skill"
  | "combat_quick_cast"
  | "combat_enemy_tick";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isUiIntent(value: string): value is MythicUiAction["intent"] {
  return value === "town"
    || value === "travel"
    || value === "dungeon"
    || value === "combat_start"
    || value === "shop"
    || value === "focus_target"
    || value === "open_panel"
    || value === "dm_prompt"
    || value === "refresh";
}

function normalizeUiActionFromUnknown(entry: unknown, fallbackId: string): MythicUiAction | null {
  const raw = asRecord(entry);
  if (!raw) return null;
  const rawIntent = String(raw.intent ?? "").trim().toLowerCase();
  if (!isUiIntent(rawIntent)) return null;
  const label = typeof raw.label === "string" && raw.label.trim().length > 0 ? raw.label.trim() : fallbackId;
  const boardTargetRaw = String(raw.boardTarget ?? raw.board_target ?? "").trim().toLowerCase();
  const boardTarget = boardTargetRaw === "town" || boardTargetRaw === "travel" || boardTargetRaw === "dungeon" || boardTargetRaw === "combat"
    ? boardTargetRaw
    : undefined;
  const panelRaw = String(raw.panel ?? "").trim().toLowerCase();
  const panel = panelRaw === "character" || panelRaw === "gear" || panelRaw === "skills" || panelRaw === "loadouts" || panelRaw === "progression" || panelRaw === "quests" || panelRaw === "commands" || panelRaw === "settings"
    ? panelRaw
    : undefined;
  const prompt = typeof raw.prompt === "string" && raw.prompt.trim().length > 0 ? raw.prompt.trim() : undefined;
  const payload = asRecord(raw.payload) ?? undefined;
  return {
    id: typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : fallbackId,
    label,
    intent: rawIntent,
    boardTarget,
    panel,
    prompt,
    payload,
  };
}

function normalizeChipLabel(action: MythicUiAction): MythicUiAction {
  const label = action.label.trim();
  if (!LOW_SIGNAL_CHIP_LABEL.test(label)) return action;
  const next = action.prompt?.trim() || label;
  return { ...action, label: next.length > 42 ? `${next.slice(0, 42).trim()}...` : next };
}

function actionTargetSignature(action: MythicUiAction): string {
  const normalizedPrompt = (action.prompt ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (action.intent === "dm_prompt") {
    const textKey = (action.prompt ?? action.label)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    return `${action.intent}:${textKey || action.id}:${normalizedPrompt}`;
  }

  const payload = action.payload ?? {};
  const target = typeof payload.target_combatant_id === "string"
    ? payload.target_combatant_id
    : typeof payload.vendorId === "string"
      ? payload.vendorId
      : typeof payload.room_id === "string"
        ? payload.room_id
        : typeof payload.to_room_id === "string"
          ? payload.to_room_id
          : typeof payload.searchTarget === "string"
            ? payload.searchTarget
            : action.boardTarget ?? action.panel ?? action.id;
  return `${action.intent}:${target}:${normalizedPrompt}`;
}

function dedupeDynamicActions(candidates: MythicUiAction[]): MythicUiAction[] {
  const unique: MythicUiAction[] = [];
  const seen = new Set<string>();
  for (const entry of candidates) {
    const normalized = normalizeChipLabel(entry);
    if (LOW_SIGNAL_CHIP_LABEL.test(normalized.label.trim())) continue;
    const key = actionTargetSignature(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
    if (unique.length >= MAX_DYNAMIC_CHIPS) break;
  }
  return unique;
}

function synthesizePromptFromAction(action: MythicUiAction, args: {
  boardType: "town" | "travel" | "dungeon" | "combat";
  vendorName: string | null;
  activeTurnCombatantName: string | null;
}): string {
  if (action.prompt && action.prompt.trim().length > 0) return action.prompt.trim();
  if (action.intent === "shop") {
    const vendorLabel = args.vendorName ?? "the vendor";
    return `I check ${vendorLabel}'s stock and ask what changed since the last turn.`;
  }
  if (action.intent === "combat_start") {
    return "I commit to combat now and want the exact mechanical outcome narrated.";
  }
  if (action.intent === "open_panel") {
    return `I open the ${action.panel ?? "character"} panel and cross-check it against current narrative state.`;
  }
  if (action.intent === "focus_target") {
    const target = typeof action.payload?.target_combatant_id === "string"
      ? action.payload.target_combatant_id
      : args.activeTurnCombatantName ?? "the active target";
    return `I focus ${target} and set up the next strike.`;
  }
  if (action.intent === "town" || action.intent === "travel" || action.intent === "dungeon") {
    return `I transition to ${action.intent} and continue from committed board state.`;
  }
  if (action.intent === "refresh") {
    return "Refresh the current state and narrate what changed on the board.";
  }
  return `I take the action "${action.label}" on the ${args.boardType} board and continue.`;
}

function deriveHookActions(args: {
  boardType: "town" | "travel" | "dungeon" | "combat";
  boardHooks: Array<{ id: string; title: string; detail: string | null }>;
  townVendors: Array<{ id: string; name: string }>;
}): MythicUiAction[] {
  const hookActions: MythicUiAction[] = [];
  for (const hook of args.boardHooks) {
    if (hookActions.length >= 3) break;
    const normalizedTitle = hook.title.trim().toLowerCase().replace(/\s+/g, "_");
    if (normalizedTitle === "companion_checkin" || normalizedTitle === "narrative_update") {
      // Companion follow-ups are injected separately with dedicated context.
      // Skip generic placeholders that cause low-signal chips.
      continue;
    }
    const joined = [hook.title, hook.detail].filter((entry): entry is string => Boolean(entry)).join(": ");
    hookActions.push({
      id: `hook-followup-${hook.id || hookActions.length + 1}`,
      label: hook.title.length > 42 ? `${hook.title.slice(0, 42).trim()}...` : hook.title,
      intent: "dm_prompt",
      prompt: `I pursue this lead: ${joined}. Give a concrete next move tied to board state.`,
      payload: { hook_id: hook.id, hook_title: hook.title },
    });
  }

  if (args.boardType === "town" && args.townVendors[0]) {
    const vendor = args.townVendors[0];
    hookActions.push({
      id: `board-chip-shop-${vendor.id}`,
      label: `Check ${vendor.name}`,
      intent: "shop",
      payload: { vendorId: vendor.id },
      prompt: `I check ${vendor.name} for contracts and inventory changes tied to current rumors.`,
    });
  } else if (args.boardType === "travel") {
    hookActions.push({
      id: "board-chip-travel-dungeon",
      label: "Press Toward Dungeon",
      intent: "dungeon",
      boardTarget: "dungeon",
      prompt: "I press toward the dungeon route and commit to entry if we confirm the approach.",
    });
  } else if (args.boardType === "dungeon") {
    hookActions.push({
      id: "board-chip-dungeon-assess",
      label: "Pressure Room",
      intent: "dm_prompt",
      prompt: "I pressure the current room objective and force a meaningful outcome this turn.",
    });
  } else if (args.boardType === "combat") {
    hookActions.push({
      id: "board-chip-combat-status",
      label: "Combat Read",
      intent: "dm_prompt",
      prompt: "Give me the immediate tactical combat read from current turn and statuses.",
    });
  }
  return hookActions;
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
      intent: "dm_prompt",
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
    recentTransitions,
    isInitialLoading: boardInitialLoading,
    isRefreshing: boardRefreshing,
    error: boardError,
    refetch,
  } = useMythicBoard(campaignId);
  const {
    character,
    skills,
    items,
    loadouts,
    progressionEvents,
    questThreads,
    loadoutSlotCap,
    isInitialLoading: charInitialLoading,
    isRefreshing: charRefreshing,
    error: charError,
    refetch: refetchCharacter,
  } = useMythicCharacter(campaignId);
  const mythicDm = useMythicDungeonMaster(campaignId);
  const dmVoice = useMythicDmVoice(campaignId);
  const combat = useMythicCombat();
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [combatStartError, setCombatStartError] = useState<{ message: string; code: string | null; requestId: string | null } | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<BoardInspectTarget | null>(null);
  const [recentInspectActions, setRecentInspectActions] = useState<MythicUiAction[]>([]);
  const [shopOpen, setShopOpen] = useState(false);
  const [shopVendor, setShopVendor] = useState<{ id: string; name: string | null } | null>(null);

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

  const modeKey = useMemo(() => {
    return board ? `${board.board_type}:${board.id}:${board.updated_at}` : "none";
  }, [board]);

  useEffect(() => {
    setRecentInspectActions([]);
  }, [board?.id, board?.updated_at]);

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
  const executeBoardActionRef = useRef<((action: MythicUiAction, source?: UnifiedActionSource) => Promise<void>) | null>(null);

  const handleInspect = useCallback((target: BoardInspectTarget) => {
    const inspectedActions = target.actions.map((action) => ({
      ...action,
      payload: {
        ...(action.payload ?? {}),
        inspect_target_id: target.id,
        inspect_target_kind: target.kind,
        inspect_target_title: target.title,
        inspect_rect: target.rect ?? null,
        inspect_meta: target.meta ?? null,
        inspect_interaction_source: target.interaction?.source ?? "hotspot",
        inspect_click_x: target.interaction?.x ?? null,
        inspect_click_y: target.interaction?.y ?? null,
      },
    }));
    setRecentInspectActions(inspectedActions.slice(0, MAX_DYNAMIC_CHIPS));
    if (target.autoRunPrimaryAction && inspectedActions[0]) {
      setInspectOpen(false);
      setInspectTarget(null);
      void executeBoardActionRef.current?.(inspectedActions[0], "board_hotspot");
      return;
    }
    setInspectTarget({
      ...target,
      actions: inspectedActions,
    });
    setInspectOpen(true);
  }, []);

  const openShop = useCallback((vendorId: string, vendorName?: string | null) => {
    setInspectOpen(false);
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
  const activeSkillPool = useMemo(
    () => skills.filter((s) => s.kind === "active" || s.kind === "ultimate"),
    [skills],
  );
  const activeLoadout = useMemo(
    () => loadouts.find((l) => l.is_active) ?? loadouts[0] ?? null,
    [loadouts],
  );
  const equippedSkillIds = useMemo(
    () => new Set((activeLoadout?.slots_json ?? []).filter((id): id is string => typeof id === "string" && id.length > 0)),
    [activeLoadout],
  );
  const equippedActiveSkills = useMemo(
    () => activeSkillPool.filter((skill) => equippedSkillIds.has(skill.id ?? "")),
    [activeSkillPool, equippedSkillIds],
  );
  const knownUnequippedActiveSkills = useMemo(
    () => activeSkillPool.filter((skill) => !equippedSkillIds.has(skill.id ?? "")),
    [activeSkillPool, equippedSkillIds],
  );
  const passiveSkills = useMemo(
    () => skills.filter((skill) => skill.kind === "passive"),
    [skills],
  );
  const [loadoutName, setLoadoutName] = useState("Default");
  const [selectedLoadoutSkillIds, setSelectedLoadoutSkillIds] = useState<string[]>([]);
  const [isSavingLoadout, setIsSavingLoadout] = useState(false);
  const [isAdvancingTurn, setIsAdvancingTurn] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const autoTickKeyRef = useRef<string | null>(null);
  const lastPlayerInputRef = useRef<string>("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<MythicPanelTab>("character");
  const [focusedCombatantId, setFocusedCombatantId] = useState<string | null>(null);
  const [runtimeSettings, setRuntimeSettings] = useState<MythicRuntimeSettings>(() => loadMythicSettings());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MYTHIC_SETTINGS_STORAGE_KEY, JSON.stringify(runtimeSettings));
  }, [runtimeSettings]);

  useEffect(() => {
    const currentCap = Math.max(1, loadoutSlotCap);
    if (!activeLoadout) {
      const fallback = activeSkillPool
        .slice(0, currentCap)
        .map((s) => s.id ?? "")
        .filter(Boolean);
      setSelectedLoadoutSkillIds((prev) => {
        if (prev.length === fallback.length && prev.every((id, idx) => id === fallback[idx])) {
          return prev;
        }
        return fallback;
      });
      setLoadoutName((prev) => (prev === "Default" ? prev : "Default"));
      return;
    }
    const next = Array.isArray(activeLoadout.slots_json) ? activeLoadout.slots_json : [];
    const normalizedNext = next.slice(0, currentCap);
    setSelectedLoadoutSkillIds((prev) => {
      if (prev.length === normalizedNext.length && prev.every((id, idx) => id === normalizedNext[idx])) {
        return prev;
      }
      return normalizedNext;
    });
    setLoadoutName((prev) => {
      const targetName = activeLoadout.name ?? "Default";
      return prev === targetName ? prev : targetName;
    });
  }, [activeLoadout, activeSkillPool, loadoutSlotCap]);

  const boardStateRecord = useMemo(
    () => (board?.state_json && typeof board.state_json === "object" ? board.state_json as Record<string, unknown> : {}),
    [board?.state_json],
  );

  const boardHooks = useMemo(() => summarizeBoardHooks(boardStateRecord), [boardStateRecord]);

  const boardActionChips = useMemo(() => {
    const raw = Array.isArray(boardStateRecord.action_chips) ? boardStateRecord.action_chips : [];
    return raw
      .map((entry, index) => {
        const record = asRecord(entry);
        const payload = asRecord(record?.payload);
        if (record?.resolved === true || payload?.resolved === true) return null;
        return normalizeUiActionFromUnknown(entry, `board-chip-${index + 1}`);
      })
      .filter((entry): entry is MythicUiAction => Boolean(entry))
      .slice(0, MAX_DYNAMIC_CHIPS);
  }, [boardStateRecord.action_chips]);

  const companionFollowupAction = useMemo(
    () => deriveCompanionFollowup(boardStateRecord),
    [boardStateRecord],
  );

  const derivedHookChipActions = useMemo(() => {
    if (!board) return [];
    return deriveHookActions({
      boardType: board.board_type,
      boardHooks,
      townVendors,
    });
  }, [board, boardHooks, townVendors]);

  const transitionBoard = useCallback(async (
    toBoardType: "town" | "travel" | "dungeon",
    reason: string,
    payload?: Record<string, unknown>,
  ) => {
    if (!campaignId) return;
    setTransitionError(null);
    try {
      const { error } = await callEdgeFunction("mythic-board-transition", {
        requireAuth: true,
        body: { campaignId, toBoardType, reason, payload: payload ?? {} },
      });
      if (error) throw error;
      await refetch();
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : "Failed to transition board");
    }
  }, [campaignId, refetch]);

  const recomputeCharacter = async () => {
    if (!campaignId || !character) return;
    await callEdgeFunction("mythic-recompute-character", {
      requireAuth: true,
      body: { campaignId, characterId: character.id },
    });
    await refetchCharacter();
  };

  const saveLoadout = async () => {
    if (!campaignId || !character) return;
    const normalized = Array.from(new Set(selectedLoadoutSkillIds)).slice(0, Math.max(1, loadoutSlotCap));
    setIsSavingLoadout(true);
    try {
      const { data, error } = await callEdgeFunction<{
        ok: boolean;
        slot_cap: number;
        truncated?: boolean;
      }>("mythic-set-loadout", {
        requireAuth: true,
        body: {
          campaignId,
          characterId: character.id,
          name: (loadoutName || "Default").trim().slice(0, 60),
          skillIds: normalized,
          activate: true,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Failed to save loadout");
      if (data.truncated) {
        toast("Loadout trimmed to slot cap.");
      } else {
        toast.success("Loadout saved.");
      }
      await refetchCharacter();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save loadout");
    } finally {
      setIsSavingLoadout(false);
    }
  };

  const activateLoadout = async (loadoutId: string) => {
    if (!campaignId || !character) return;
    const selected = loadouts.find((l) => l.id === loadoutId);
    if (!selected) return;
    setIsSavingLoadout(true);
    try {
      const { data, error } = await callEdgeFunction<{ ok: boolean }>("mythic-set-loadout", {
        requireAuth: true,
        body: {
          campaignId,
          characterId: character.id,
          name: selected.name,
          skillIds: selected.slots_json,
          activate: true,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Failed to activate loadout");
      setLoadoutName(selected.name);
      setSelectedLoadoutSkillIds(selected.slots_json.slice(0, Math.max(1, loadoutSlotCap)));
      await refetchCharacter();
      toast.success(`Activated ${selected.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to activate loadout");
    } finally {
      setIsSavingLoadout(false);
    }
  };

  const activeTurnCombatant = useMemo(
    () => combatState.combatants.find((c) => c.id === combatState.activeTurnCombatantId) ?? null,
    [combatState.activeTurnCombatantId, combatState.combatants],
  );
  const canAdvanceNpcTurn = Boolean(
    board?.board_type === "combat" &&
    combatSessionId &&
    combatState.session?.status === "active" &&
    activeTurnCombatant &&
    activeTurnCombatant.entity_type !== "player",
  );
  const tickCombat = combat.tickCombat;
  const refetchCombatState = combatState.refetch;

  const bossPhaseLabel = useMemo(() => {
    if (!combatState.events.length) return null;
    const phaseShift = [...combatState.events].reverse().find((e) => e.event_type === "phase_shift");
    if (!phaseShift) return null;
    const phase = Number((phaseShift.payload as Record<string, unknown>)?.phase ?? 0);
    return phase > 0 ? `Boss Phase ${phase}` : "Boss Phase";
  }, [combatState.events]);

  const latestAssistantParsed = useMemo<MythicDmParsedPayload | null>(() => {
    for (let index = mythicDm.messages.length - 1; index >= 0; index -= 1) {
      const entry = mythicDm.messages[index];
      if (entry?.role === "assistant" && entry.parsed) {
        return entry.parsed;
      }
    }
    return null;
  }, [mythicDm.messages]);

  const latestAssistantActions = useMemo(() => (latestAssistantParsed?.ui_actions ?? []).slice(0, MAX_DYNAMIC_CHIPS), [latestAssistantParsed?.ui_actions]);

  const chatActions = useMemo(() => {
    const dynamicSources: MythicUiAction[] = [
      ...latestAssistantActions,
      ...boardActionChips,
      ...recentInspectActions,
      ...(companionFollowupAction ? [companionFollowupAction] : []),
      ...derivedHookChipActions,
    ];
    return dedupeDynamicActions(dynamicSources);
  }, [boardActionChips, companionFollowupAction, derivedHookChipActions, latestAssistantActions, recentInspectActions]);

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

  const sceneHints = useMemo(() => {
    const persisted = asRecord(boardStateRecord.scene_cache) ?? {};
    const overlay = latestAssistantParsed?.scene && typeof latestAssistantParsed.scene === "object"
      ? latestAssistantParsed.scene
      : null;
    if (!overlay && Object.keys(persisted).length === 0) return null;
    return {
      ...persisted,
      ...(overlay ?? {}),
    };
  }, [boardStateRecord.scene_cache, latestAssistantParsed?.scene]);

  const speakDmNarration = dmVoice.speak;

  useEffect(() => {
    if (!latestAssistantMessage) return;
    if (!latestAssistantNarration) return;
    speakDmNarration(latestAssistantNarration, latestAssistantMessage.id);
  }, [latestAssistantMessage, latestAssistantNarration, speakDmNarration]);

  const openPanel = useCallback((tab: MythicPanelTab) => {
    setActivePanel(tab);
    setPanelOpen(true);
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

  const runNarratedAction = useCallback(async (args: {
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
  }) => {
    if (!campaignId) return;

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

    const narrationPrompt = prompt.length > 0
      ? prompt
      : executionError
        ? `I attempted ${args.intent}, but it failed: ${executionError}. Narrate the failure against committed state.`
        : `I execute ${args.intent}. Narrate outcome from committed Mythic state.`;

    try {
      await mythicDm.sendMessage(narrationPrompt, {
        appendUser: args.appendUser !== false,
        timeoutMs: 95_000,
        idempotencyKey: `${campaignId}:${actionTraceId}`,
        actionContext: {
          action_trace_id: actionTraceId,
          source: args.source,
          intent: args.intent,
          action_id: args.actionId ?? null,
          payload: args.payload ?? null,
          state_changes: stateChanges,
          execution_error: executionError,
          ...context,
        },
      });
    } catch (error) {
      const dmError = error instanceof Error ? error.message : "Failed to reach Mythic DM.";
      setActionError(dmError);
      toast.error(dmError);
      screenLogger.error("mythic.action.dm_failed", error, {
        action_trace_id: actionTraceId,
        source: args.source,
        intent: args.intent,
      });
      await refreshAllState();
      return;
    }

    await refreshAllState();
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
  }, [campaignId, mythicDm, refreshAllState]);

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
            transitionBoard,
            startCombat: combat.startCombat,
            useSkill: combat.useSkill,
            combatSessionId,
            refetchBoard: refetch,
            refetchCombat: refetchCombatState,
            refetchCharacter,
            openMenu: (panel: PlayerCommandPanel) => {
              openPanel(panel);
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
    openPanel,
    playerCombatantId,
    refetch,
    refetchCharacter,
    refetchCombatState,
    runNarratedAction,
    skills,
    transitionBoard,
  ]);

  const executeBoardAction = useCallback(async (action: MythicUiAction, source: UnifiedActionSource = "dm_chip") => {
    if (!campaignId || !board) return;
    setActionError(null);
    if (action.intent !== "combat_start") {
      setCombatStartError(null);
    }

    let vendorName: string | null = null;
    if (action.intent === "shop") {
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
        if (action.intent === "refresh") {
          return {
            stateChanges: ["Requested a full state refresh and narration sync."],
            context: { refresh: true },
          };
        }

        if (action.intent === "focus_target") {
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

        if (action.intent === "shop") {
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

        if (action.intent === "open_panel") {
          const tab = mapPanelTab(action.panel);
          if (!tab) return { stateChanges: [], error: "Panel target missing for this interaction." };
          openPanel(tab);
          return {
            stateChanges: [`Opened ${tab} panel.`],
            context: { panel: tab },
          };
        }

        if (action.intent === "town" || action.intent === "travel" || action.intent === "dungeon") {
          const target = (action.boardTarget === "town" || action.boardTarget === "travel" || action.boardTarget === "dungeon")
            ? action.boardTarget
            : action.intent;
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
            await transitionBoard(target, reasonLabel, payload);
            return {
              stateChanges: [`Transitioned board to ${target}.`],
              context: { board_target: target, transition_payload: payload },
            };
          }
          return {
            stateChanges: [`Board already on ${target}.`],
            context: { board_target: target, noop: true },
          };
        }

        if (action.intent === "dm_prompt") {
          const companionId = typeof action.payload?.companion_id === "string"
            ? action.payload.companion_id
            : null;
          const companionTurnIndex = Number.isFinite(Number(action.payload?.turn_index))
            ? Number(action.payload?.turn_index)
            : null;
          const companionHookType = typeof action.payload?.hook_type === "string"
            ? action.payload.hook_type
            : null;
          return {
            stateChanges: ["Narration-only action requested from board interaction."],
            context: {
              board_target: board.board_type,
              companion_followup_resolved: Boolean(companionId),
              companion_id: companionId,
              companion_turn_index: companionTurnIndex,
              companion_hook_type: companionHookType,
            },
          };
        }

        if (action.intent === "combat_start") {
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
          error: `Unsupported board intent: ${action.intent}`,
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
    findVendorName,
    openPanel,
    openShop,
    runNarratedAction,
    townVendors,
    transitionBoard,
  ]);

  useEffect(() => {
    executeBoardActionRef.current = executeBoardAction;
    return () => {
      if (executeBoardActionRef.current === executeBoardAction) {
        executeBoardActionRef.current = null;
      }
    };
  }, [executeBoardAction]);

  const triggerChipAction = useCallback((action: MythicUiAction) => {
    void executeBoardAction(action, "dm_chip");
  }, [executeBoardAction]);

  const triggerBoardAction = useCallback((action: MythicUiAction) => {
    void executeBoardAction(action, "board_hotspot");
  }, [executeBoardAction]);

  const advanceNpcTurn = useCallback(async () => {
    if (!campaignId || !combatSessionId || !canAdvanceNpcTurn) return;
    setIsAdvancingTurn(true);
    try {
      const activeName = activeTurnCombatant?.name ?? "enemy";
      await runNarratedAction({
        source: "combat_enemy_tick",
        intent: "dm_prompt",
        actionId: "enemy_auto_tick",
        appendUser: false,
        payload: {
          combat_session_id: combatSessionId,
          current_turn_index: Number(combatState.session?.current_turn_index ?? 0),
          active_turn_combatant_id: activeTurnCombatant?.id ?? null,
        },
        prompt: `${activeName} takes the enemy turn. Narrate the committed combat events and new tactical pressure.`,
        execute: async () => {
          const tickResult = await tickCombat({
            campaignId,
            combatSessionId,
            maxSteps: 1,
            currentTurnIndex: Number(combatState.session?.current_turn_index ?? 0),
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
          return {
            stateChanges: ["Enemy turn resolved from authoritative combat tick."],
            context: {
              combat_tick: tickResult.data ?? null,
            },
          };
        },
      });
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
    runNarratedAction,
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
        return {
          stateChanges: [`Used ${skillName} on ${targetLabel}.`],
          context: {
            skill_id: args.skillId,
            target: args.target,
            combat_ended: result.ended,
          },
        };
      },
    });
  }, [campaignId, combat, combatSessionId, combatState.session?.current_turn_index, describeCombatTarget, runNarratedAction, skills]);

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
    if (!canAdvanceNpcTurn || isAdvancingTurn || combat.isTicking) return;
    const key = `${combatSessionId}:${combatState.session?.current_turn_index ?? -1}:${activeTurnCombatant?.id ?? "none"}`;
    if (autoTickKeyRef.current === key) return;
    autoTickKeyRef.current = key;
    void advanceNpcTurn();
  }, [
    advanceNpcTurn,
    activeTurnCombatant?.id,
    canAdvanceNpcTurn,
    combat.isTicking,
    combatSessionId,
    combatState.session?.current_turn_index,
    isAdvancingTurn,
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

  return (
    <>
      <BookShell
        title="Mythic Weave"
        subtitle={(
          <>
            Board: <span className="font-medium capitalize">{board.board_type}</span>
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
            onClick={() => openPanel("commands")}
            className="border border-amber-200/40 bg-amber-300/20 text-amber-50 hover:bg-amber-300/30"
          >
            Menu
          </Button>
        )}
        leftPage={(
          <NarrativePage
            messages={mythicDm.messages}
            isDmLoading={mythicDm.isLoading}
            currentResponse={mythicDm.currentResponse}
            actions={chatActions}
            onAction={triggerChipAction}
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
          <BoardPage
            boardType={board.board_type}
            modeKey={modeKey}
            boardState={boardStateRecord}
            sceneHints={sceneHints}
            transitionError={transitionError}
            combatStartError={combatStartError}
            onRetryCombatStart={retryCombatStart}
            combatSessionId={combatSessionId}
            combatSession={combatState.session}
            combatants={combatState.combatants}
            combatEvents={combatState.events.slice(-32)}
            activeTurnCombatantId={combatState.activeTurnCombatantId}
            playerCombatantId={playerCombatantId}
            skills={skills.map((s) => ({
              id: s.id,
              kind: s.kind,
              name: s.name,
              description: s.description,
              targeting: s.targeting,
              range_tiles: s.range_tiles,
              cooldown_turns: s.cooldown_turns,
            }))}
            skillAvailability={commandSkillAvailability}
            isActing={combat.isActing}
            isTicking={isAdvancingTurn || combat.isTicking}
            canTick={canAdvanceNpcTurn}
            bossPhaseLabel={bossPhaseLabel}
            onTickTurn={advanceNpcTurn}
            animationIntensity={runtimeSettings.animationIntensity}
            onUseSkill={async ({ actorCombatantId, skillId, target }) => {
              if (!campaignId || !combatSessionId) return;
              await executeCombatSkillNarration({
                source: "combat_skill",
                actorCombatantId,
                skillId,
                target,
              });
            }}
            onQuickCast={async ({ skillId, target }) => {
              if (!playerCombatantId || !combatSessionId) return;
              await executeCombatSkillNarration({
                source: "combat_quick_cast",
                actorCombatantId: playerCombatantId,
                skillId,
                target,
              });
            }}
            onAction={triggerBoardAction}
            onInspect={handleInspect}
            onFocusCombatant={setFocusedCombatantId}
          />
        )}
      />

      <Dialog open={panelOpen} onOpenChange={setPanelOpen}>
        <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden border border-border bg-card/85 backdrop-blur-md">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Mythic Control Panel</DialogTitle>
            <DialogDescription className="sr-only">
              Manage character, gear, skills, loadouts, progression, and quest data for the active mythic campaign.
            </DialogDescription>
          </DialogHeader>
          <div className="mb-2 flex flex-wrap gap-2">
            <Button size="sm" variant={activePanel === "character" ? "default" : "secondary"} onClick={() => setActivePanel("character")}>Character</Button>
            <Button size="sm" variant={activePanel === "gear" ? "default" : "secondary"} onClick={() => setActivePanel("gear")}>Gear</Button>
            <Button size="sm" variant={activePanel === "skills" ? "default" : "secondary"} onClick={() => setActivePanel("skills")}>Skills</Button>
            <Button size="sm" variant={activePanel === "loadouts" ? "default" : "secondary"} onClick={() => setActivePanel("loadouts")}>Loadouts</Button>
            <Button size="sm" variant={activePanel === "progression" ? "default" : "secondary"} onClick={() => setActivePanel("progression")}>Progression</Button>
            <Button size="sm" variant={activePanel === "quests" ? "default" : "secondary"} onClick={() => setActivePanel("quests")}>Quests</Button>
            <Button size="sm" variant={activePanel === "commands" ? "default" : "secondary"} onClick={() => setActivePanel("commands")}>Commands</Button>
            <Button size="sm" variant={activePanel === "settings" ? "default" : "secondary"} onClick={() => setActivePanel("settings")}>Settings</Button>
          </div>
          <div className="max-h-[68vh] overflow-auto pr-1">
            {activePanel === "character" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="text-sm font-semibold">{character.name}</div>
                  <div className="text-xs text-muted-foreground">{String((character.class_json as any)?.class_name ?? "(class)")}</div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>Level: {character.level}</div>
                    <div>Unspent Points: {character.unspent_points ?? 0}</div>
                    <div>XP: {character.xp ?? 0}</div>
                    <div>XP to Next: {character.xp_to_next ?? 0}</div>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="mb-2 text-sm font-semibold">Derived Stats</div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>Offense: {derivedStats.offense}</div>
                    <div>Defense: {derivedStats.defense}</div>
                    <div>Control: {derivedStats.control}</div>
                    <div>Support: {derivedStats.support}</div>
                    <div>Mobility: {derivedStats.mobility}</div>
                    <div>Utility: {derivedStats.utility}</div>
                  </div>
                </div>
              </div>
            ) : null}

            {activePanel === "gear" ? (
              <MythicInventoryPanel
                campaignId={campaignId}
                characterId={character.id}
                rows={invRowsSafe}
                onChanged={async () => {
                  await recomputeCharacter();
                  await refetch();
                }}
              />
            ) : null}

            {activePanel === "skills" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="mb-1 text-sm font-semibold">Equipped Abilities</div>
                  <div className="mb-2 text-xs text-muted-foreground">
                    Equipped slots: {equippedActiveSkills.length}/{Math.max(1, loadoutSlotCap)}
                  </div>
                  {equippedActiveSkills.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No equipped active abilities. Open Loadouts to equip skills.</div>
                  ) : (
                    <div className="space-y-2">
                      {equippedActiveSkills.map((skill) => (
                        <div key={skill.id} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                          <div className="font-medium text-foreground">{skill.name}</div>
                          <div className="text-muted-foreground">
                            {skill.kind} · {skill.targeting} · range {skill.range_tiles} · cooldown {skill.cooldown_turns}
                          </div>
                          {skill.description ? <div className="mt-1 text-muted-foreground">{skill.description}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="mb-1 text-sm font-semibold">Known Active Abilities</div>
                  <div className="mb-2 text-xs text-muted-foreground">Known abilities can exceed equipped slots. Use Loadouts to swap.</div>
                  {knownUnequippedActiveSkills.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No additional known active abilities.</div>
                  ) : (
                    <div className="grid gap-2">
                      {knownUnequippedActiveSkills.map((skill) => (
                        <div key={skill.id} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                          <div className="font-medium text-foreground">{skill.name}</div>
                          <div className="text-muted-foreground">
                            {skill.kind} · {skill.targeting} · range {skill.range_tiles} · cooldown {skill.cooldown_turns}
                          </div>
                          {skill.description ? <div className="mt-1 text-muted-foreground">{skill.description}</div> : null}
                        </div>
                      ))}
                    </div>
                  )}
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

            {activePanel === "loadouts" ? (
              <div className="rounded-lg border border-border bg-background/30 p-3">
                <div className="mb-2 text-sm font-semibold">Skill Loadouts</div>
                <div className="mb-2 text-xs text-muted-foreground">
                  Slots unlocked: {Math.max(1, loadoutSlotCap)} · Selected: {selectedLoadoutSkillIds.length}
                </div>
                <PromptAssistField
                  value={loadoutName}
                  onChange={setLoadoutName}
                  fieldType="generic"
                  campaignId={campaignId}
                  context={{
                    kind: "loadout_name",
                    character_name: character.name,
                    class_name: String((character.class_json as any)?.class_name ?? ""),
                    selected_skill_names: activeSkillPool
                      .filter((skill) => selectedLoadoutSkillIds.includes(skill.id ?? ""))
                      .map((skill) => skill.name),
                  }}
                  placeholder="Loadout name"
                  maxLength={60}
                  className="mb-2"
                  disabled={isSavingLoadout}
                />
                <div className="mb-3 flex flex-wrap gap-2">
                  {activeSkillPool.map((skill) => {
                    const id = skill.id ?? "";
                    const isSelected = selectedLoadoutSkillIds.includes(id);
                    return (
                      <Button
                        key={id}
                        size="sm"
                        variant={isSelected ? "default" : "secondary"}
                        onClick={() => {
                          setSelectedLoadoutSkillIds((prev) => {
                            if (prev.includes(id)) return prev.filter((x) => x !== id);
                            if (prev.length >= Math.max(1, loadoutSlotCap)) return prev;
                            return [...prev, id];
                          });
                        }}
                      >
                        {skill.name}
                      </Button>
                    );
                  })}
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => void saveLoadout()} disabled={isSavingLoadout}>
                    {isSavingLoadout ? "Saving..." : "Save + Activate"}
                  </Button>
                </div>
                <div className="space-y-1">
                  {loadouts.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No saved loadouts.</div>
                  ) : (
                    loadouts.map((loadout) => (
                      <div key={loadout.id} className="flex items-center justify-between rounded border border-border bg-background/20 px-2 py-1">
                        <div className="text-xs">
                          <span className="font-medium">{loadout.name}</span>
                          {loadout.is_active ? <span className="ml-2 text-primary">(active)</span> : null}
                        </div>
                        {!loadout.is_active ? (
                          <Button size="sm" variant="outline" onClick={() => void activateLoadout(loadout.id)} disabled={isSavingLoadout}>
                            Activate
                          </Button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {activePanel === "progression" ? (
              <div className="rounded-lg border border-border bg-background/30 p-3">
                <div className="mb-2 text-sm font-semibold">Progression</div>
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>Level: {character.level}</div>
                  <div>Unspent Points: {character.unspent_points ?? 0}</div>
                  <div>XP: {character.xp ?? 0}</div>
                  <div>XP to Next: {character.xp_to_next ?? 0}</div>
                </div>
                <div className="space-y-1">
                  {progressionEvents.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No progression events yet.</div>
                  ) : (
                    progressionEvents.map((event) => (
                      <div key={event.id} className="rounded border border-border bg-background/20 px-2 py-1 text-xs text-muted-foreground">
                        <div className="font-medium text-foreground">{event.event_type}</div>
                        <div>{new Date(event.created_at).toLocaleTimeString()}</div>
                      </div>
                    ))
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
                  <div className="mb-1 text-sm font-semibold">Board Hooks</div>
                  {boardHooks.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No active hooks on this board yet.</div>
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
                <div className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="mb-1 text-sm font-semibold">Recent Transitions</div>
                  {recentTransitions.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No transitions yet.</div>
                  ) : (
                    <div className="max-h-[220px] space-y-2 overflow-auto">
                      {recentTransitions.slice(0, 12).map((transition) => (
                        <div key={transition.id} className="rounded border border-border bg-background/20 px-2 py-2 text-xs">
                          <div className="font-medium text-foreground">
                            {(transition.from_board_type ?? "?").toUpperCase()}{" -> "}{transition.to_board_type.toUpperCase()}
                          </div>
                          <div className="text-muted-foreground">Reason: {transition.reason}</div>
                          <div className="text-muted-foreground">{new Date(transition.created_at).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {activePanel === "commands" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="mb-2 text-sm font-semibold">DM Voice</div>
                  <div className="mb-3 flex flex-wrap items-center gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={dmVoice.enabled}
                        onCheckedChange={dmVoice.setEnabled}
                        disabled={!dmVoice.supported}
                        aria-label="Toggle DM voice"
                      />
                      <span className="text-muted-foreground">
                        {dmVoice.enabled ? "Voice enabled" : "Voice muted"}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (!latestAssistantNarration) return;
                        if (dmVoice.blocked && dmVoice.hasPreparedAudio) {
                          void dmVoice.resumeLatest();
                          return;
                        }
                        dmVoice.speak(latestAssistantNarration, latestAssistantMessage?.id ?? null, { force: true });
                      }}
                      disabled={!dmVoice.supported || !latestAssistantNarration}
                    >
                      Speak Latest
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => dmVoice.stop()}
                      disabled={!dmVoice.supported}
                    >
                      Stop
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Rate</span>
                        <span>{dmVoice.rate.toFixed(2)}</span>
                      </div>
                      <Slider
                        value={[dmVoice.rate]}
                        min={0.6}
                        max={1.8}
                        step={0.05}
                        onValueChange={(value) => dmVoice.setRate(value[0] ?? 1)}
                        disabled={!dmVoice.supported}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Pitch</span>
                        <span>{dmVoice.pitch.toFixed(2)}</span>
                      </div>
                      <Slider
                        value={[dmVoice.pitch]}
                        min={0.6}
                        max={1.8}
                        step={0.05}
                        onValueChange={(value) => dmVoice.setPitch(value[0] ?? 1)}
                        disabled={!dmVoice.supported}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Volume</span>
                        <span>{dmVoice.volume.toFixed(2)}</span>
                      </div>
                      <Slider
                        value={[dmVoice.volume]}
                        min={0}
                        max={1}
                        step={0.05}
                        onValueChange={(value) => dmVoice.setVolume(value[0] ?? 0.85)}
                        disabled={!dmVoice.supported}
                      />
                    </div>
                  </div>

                  {!dmVoice.supported ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Browser speech synthesis is unavailable in this runtime.
                    </div>
                  ) : null}
                  {dmVoice.blocked ? (
                    <div className="mt-2 text-xs text-amber-200">
                      Audio playback was blocked by browser policy. Click <span className="font-medium">Speak Latest</span> after interacting with the page.
                    </div>
                  ) : null}
                  {dmVoice.lastError ? (
                    <div className="mt-2 text-xs text-destructive">
                      Voice error: {dmVoice.lastError.message}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="mb-1 text-sm font-semibold">Command Reference</div>
                  <div className="grid gap-1 text-xs text-muted-foreground">
                    <div><span className="font-medium text-foreground">Natural:</span> "go to town", "travel to dungeon", "start combat", "use fireball on raider"</div>
                    <div><span className="font-medium text-foreground">Slash:</span> <code>/travel town|travel|dungeon</code></div>
                    <div><span className="font-medium text-foreground">Slash:</span> <code>/combat start</code></div>
                    <div><span className="font-medium text-foreground">Slash:</span> <code>/skills</code> <code>/status</code> <code>/menu gear</code></div>
                    <div><span className="font-medium text-foreground">Slash:</span> <code>/skill &lt;name&gt; @&lt;target&gt;</code></div>
                    <div><span className="font-medium text-foreground">Travel probes:</span> "scout route", "search for treasure", "forage"</div>
                  </div>
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

                <div className="rounded-lg border border-border bg-background/30 p-3 text-xs text-muted-foreground">
                  Focused combat target:{" "}
                  <span className="text-foreground">
                    {focusedCombatantId
                      ? (combatState.combatants.find((entry) => entry.id === focusedCombatantId)?.name ?? focusedCombatantId)
                      : "none"}
                  </span>
                </div>
              </div>
            ) : null}

            {activePanel === "settings" ? (
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
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <BoardInspectDialog
        open={inspectOpen}
        target={inspectTarget}
        questThreads={questThreads}
        onOpenChange={(open) => {
          setInspectOpen(open);
          if (!open) setInspectTarget(null);
        }}
        onAction={triggerBoardAction}
      />

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
