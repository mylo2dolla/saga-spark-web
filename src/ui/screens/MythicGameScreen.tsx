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
import { toast } from "sonner";
import { BookShell } from "@/ui/components/mythic/BookShell";
import { NarrativePage } from "@/ui/components/mythic/NarrativePage";
import { BoardPage } from "@/ui/components/mythic/BoardPage";
import { BoardInspectDialog } from "@/ui/components/mythic/BoardInspectDialog";
import { ShopDialog } from "@/ui/components/mythic/ShopDialog";
import type { BoardInspectTarget } from "@/ui/components/mythic/board/inspectTypes";

type MythicPanelTab = "character" | "gear" | "skills" | "loadouts" | "progression" | "quests" | "commands";

function summarizeBoardHooks(state: unknown): Array<{ id: string; title: string; detail: string | null }> {
  const payload = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  const rawRumors = Array.isArray(payload.rumors) ? payload.rumors : [];
  const rawObjectives = Array.isArray(payload.objectives) ? payload.objectives : [];
  const hooks = [...rawRumors, ...rawObjectives];
  return hooks.slice(0, 12).map((entry, idx) => {
    if (typeof entry === "string") {
      return { id: `hook:${idx}`, title: entry, detail: null };
    }
    if (entry && typeof entry === "object") {
      const raw = entry as Record<string, unknown>;
      const title =
        typeof raw.title === "string"
          ? raw.title
          : typeof raw.name === "string"
            ? raw.name
            : typeof raw.label === "string"
              ? raw.label
              : `Hook ${idx + 1}`;
      const detail =
        typeof raw.description === "string"
          ? raw.description
          : typeof raw.detail === "string"
            ? raw.detail
            : typeof raw.prompt === "string"
              ? raw.prompt
              : null;
      return { id: `hook:${idx}`, title, detail };
    }
    return { id: `hook:${idx}`, title: `Hook ${idx + 1}`, detail: null };
  });
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
    panel === "commands"
  ) {
    return panel;
  }
  return null;
}

export default function MythicGameScreen() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();

  const { bootstrapCampaign, isBootstrapping } = useMythicCreator();
  const { board, recentTransitions, isLoading: boardLoading, error: boardError, refetch } = useMythicBoard(campaignId);
  const {
    character,
    skills,
    items,
    loadouts,
    progressionEvents,
    questThreads,
    loadoutSlotCap,
    isLoading: charLoading,
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

  const handleInspect = useCallback((target: BoardInspectTarget) => {
    setInspectTarget(target);
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

  const boardHooks = useMemo(() => summarizeBoardHooks(board?.state_json ?? null), [board?.state_json]);

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

  const advanceNpcTurn = useCallback(async () => {
    if (!campaignId || !combatSessionId || !canAdvanceNpcTurn) return;
    setIsAdvancingTurn(true);
    try {
      await tickCombat({ campaignId, combatSessionId, maxSteps: 1 });
      await Promise.all([refetchCombatState(), refetch()]);
    } finally {
      setIsAdvancingTurn(false);
    }
  }, [campaignId, canAdvanceNpcTurn, combatSessionId, refetch, refetchCombatState, tickCombat]);

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

  const chatActions = useMemo(() => {
    const actions = latestAssistantParsed?.ui_actions ?? [];
    return actions.slice(0, 4);
  }, [latestAssistantParsed]);

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

  const handlePlayerInput = useCallback(async (message: string) => {
    if (!campaignId) return;
    const rawMessage = message.trim();
    if (!rawMessage) return;
    lastPlayerInputRef.current = rawMessage;
    setActionError(null);
    setCombatStartError(null);

    const command = parsePlayerCommand(rawMessage);
    let commandContext: Record<string, unknown> | null = null;

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
        openMenu: (panel: PlayerCommandPanel) => {
          openPanel(panel);
        },
      });
      if (resolution.combatStartError) {
        setCombatStartError(resolution.combatStartError);
      }
      if (resolution.error) {
        setActionError(resolution.error);
        toast.error(resolution.error);
      }
      commandContext = resolution.narrationContext ?? {
        command: rawMessage,
        intent: command.intent,
        handled: resolution.handled,
        state_changes: resolution.stateChanges,
        error: resolution.error ?? null,
      };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Failed to process command.";
      setActionError(messageText);
      toast.error(messageText);
      commandContext = {
        command: rawMessage,
        intent: command.intent,
        handled: false,
        state_changes: [],
        error: messageText,
      };
    }

    try {
      await mythicDm.sendMessage(rawMessage, commandContext ? { actionContext: commandContext } : undefined);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Failed to reach Mythic DM.";
      setActionError(messageText);
    }
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
    mythicDm,
    openPanel,
    playerCombatantId,
    refetch,
    refetchCombatState,
    skills,
    transitionBoard,
  ]);

  const executeBoardAction = useCallback(async (action: MythicUiAction) => {
    if (!campaignId) return;
    setActionError(null);
    if (action.intent !== "combat_start") {
      setCombatStartError(null);
    }
    try {
      if (action.intent === "refresh") {
        await Promise.all([refetch(), refetchCharacter(), refetchCombatState()]);
        return;
      }

      if (action.intent === "shop") {
        if (!character) throw new Error("No character loaded for this campaign.");
        if (!board || board.board_type !== "town") throw new Error("Shops are only available while in town.");
        const payloadVendor = action.payload && typeof action.payload.vendorId === "string" ? action.payload.vendorId : null;
        let vendorId: string | null = payloadVendor;
        if (!vendorId) {
          const haystack = `${action.label ?? ""} ${action.prompt ?? ""}`.toLowerCase();
          const matched = townVendors.find((vendor) => haystack.includes(vendor.name.toLowerCase()));
          vendorId = matched?.id ?? townVendors[0]?.id ?? null;
        }
        if (!vendorId) throw new Error("No vendors are available on this town board.");
        openShop(vendorId, findVendorName(vendorId));
        return;
      }

      if (action.intent === "open_panel") {
        const tab = mapPanelTab(action.panel);
        if (!tab) throw new Error("Panel target missing for this interaction.");
        openPanel(tab);
        if (action.prompt) {
          await mythicDm.sendMessage(action.prompt, {
            actionContext: {
              source: "board_hotspot",
              intent: action.intent,
              panel: tab,
            },
          });
        }
        return;
      }

      if (action.intent === "town" || action.intent === "travel" || action.intent === "dungeon") {
        const target = (action.boardTarget === "town" || action.boardTarget === "travel" || action.boardTarget === "dungeon")
          ? action.boardTarget
          : action.intent;
        if (board?.board_type !== target) {
          await transitionBoard(target, `narrative:${action.id}`);
          await Promise.all([refetch(), refetchCombatState()]);
        }
        if (action.prompt) {
          await mythicDm.sendMessage(action.prompt, {
            actionContext: {
              source: "board_hotspot",
              intent: action.intent,
              board_target: target,
            },
          });
        }
        return;
      }

      if (action.intent === "dm_prompt") {
        const prompt = action.prompt?.trim();
        if (!prompt) throw new Error("Prompt action is missing prompt text.");
        await mythicDm.sendMessage(prompt, {
          actionContext: {
            source: "board_hotspot",
            intent: action.intent,
            action_id: action.id,
          },
        });
        return;
      }

      if (action.intent === "combat_start") {
        if (board?.board_type !== "combat") {
          setCombatStartError(null);
          const started = await combat.startCombat(campaignId);
          if (started.ok === false) {
            setCombatStartError({ message: started.message, code: started.code, requestId: started.requestId });
            throw new Error(started.message || "Combat session did not start.");
          }
          await Promise.all([refetch(), refetchCombatState()]);
        }
        if (action.prompt) {
          await mythicDm.sendMessage(action.prompt, {
            actionContext: {
              source: "board_hotspot",
              intent: action.intent,
            },
          });
        }
        return;
      }

      throw new Error(`Unsupported board intent: ${action.intent}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to apply board interaction.";
      setActionError(message);
      toast.error(message);
    }
  }, [
    board,
    campaignId,
    character,
    combat,
    findVendorName,
    mythicDm,
    openPanel,
    openShop,
    refetch,
    refetchCharacter,
    refetchCombatState,
    townVendors,
    transitionBoard,
  ]);

  const triggerBoardAction = useCallback((action: MythicUiAction) => {
    void executeBoardAction(action);
  }, [executeBoardAction]);

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

  if (!campaignId) {
    return <div className="p-6 text-sm text-muted-foreground">Campaign not found.</div>;
  }

  if (authLoading || boardLoading || charLoading || isBootstrapping) {
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
            onAction={triggerBoardAction}
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
            onRetryAction={retryLastAction}
            onSendMessage={(message) => void handlePlayerInput(message)}
            onCancelMessage={() => mythicDm.cancelMessage()}
          />
        )}
        rightPage={(
          <BoardPage
            boardType={board.board_type}
            modeKey={modeKey}
            boardState={(board.state_json && typeof board.state_json === "object")
              ? (board.state_json as Record<string, unknown>)
              : {}}
            sceneHints={(latestAssistantParsed?.scene && typeof latestAssistantParsed.scene === "object")
              ? latestAssistantParsed.scene
              : null}
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
            isActing={combat.isActing}
            isTicking={isAdvancingTurn || combat.isTicking}
            canTick={canAdvanceNpcTurn}
            bossPhaseLabel={bossPhaseLabel}
            onTickTurn={advanceNpcTurn}
            onUseSkill={async ({ actorCombatantId, skillId, target }) => {
              await combat.useSkill({
                campaignId,
                combatSessionId,
                actorCombatantId,
                skillId,
                target,
              });
              await Promise.all([refetchCombatState(), refetch()]);
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
                rows={invRowsSafe}
                onChanged={async () => {
                  await recomputeCharacter();
                  await refetch();
                }}
              />
            ) : null}

            {activePanel === "skills" ? (
              <div className="grid gap-2">
                {skills.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No skills found.</div>
                ) : (
                  skills.map((skill) => (
                    <div key={skill.id} className="rounded-lg border border-border bg-background/30 p-3">
                      <div className="text-sm font-semibold">{skill.name}</div>
                      <div className="text-xs text-muted-foreground">{skill.kind} · {skill.targeting} · range {skill.range_tiles} · cooldown {skill.cooldown_turns}</div>
                      {skill.description ? <div className="mt-1 text-xs text-muted-foreground">{skill.description}</div> : null}
                    </div>
                  ))
                )}
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
