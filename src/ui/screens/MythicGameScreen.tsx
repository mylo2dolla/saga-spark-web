import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PromptAssistField } from "@/components/PromptAssistField";
import { useAuth } from "@/hooks/useAuth";
import { useMythicCreator } from "@/hooks/useMythicCreator";
import { useMythicBoard } from "@/hooks/useMythicBoard";
import { useMythicCharacter } from "@/hooks/useMythicCharacter";
import { useMythicDmContext } from "@/hooks/useMythicDmContext";
import { useMythicDungeonMaster } from "@/hooks/useMythicDungeonMaster";
import { MythicDMChat } from "@/components/MythicDMChat";
import { useMythicCombat } from "@/hooks/useMythicCombat";
import { useMythicCombatState } from "@/hooks/useMythicCombatState";
import { MythicCombatPanel } from "@/components/mythic/MythicCombatPanel";
import { MythicInventoryPanel } from "@/components/mythic/MythicInventoryPanel";
import { callEdgeFunction } from "@/lib/edge";
import { sumStatMods, splitInventory, type MythicInventoryRow } from "@/lib/mythicEquipment";
import { toast } from "sonner";

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateText(value: unknown, maxLen = 280): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}...`;
}

function summarizeBoardState(boardType: string | null | undefined, state: unknown) {
  const safeType = boardType ?? "unknown";
  const raw = state && typeof state === "object" ? (state as Record<string, unknown>) : {};
  if (safeType === "town") {
    const worldSeed =
      raw.world_seed && typeof raw.world_seed === "object"
        ? (raw.world_seed as Record<string, unknown>)
        : null;
    const vendors = Array.isArray(raw.vendors)
      ? raw.vendors.map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>).name : null)).filter(Boolean)
      : [];
    return {
      board_type: safeType,
      template_key: raw.template_key ?? null,
      world_title: worldSeed?.title ?? null,
      world_description: truncateText(worldSeed?.description ?? null),
      vendor_count: Array.isArray(raw.vendors) ? raw.vendors.length : 0,
      vendor_names: vendors,
      service_count: Array.isArray(raw.services) ? raw.services.length : 0,
      rumor_count: Array.isArray(raw.rumors) ? raw.rumors.length : 0,
      faction_count: Array.isArray(raw.factions_present) ? raw.factions_present.length : 0,
      guard_alertness: raw.guard_alertness ?? null,
    };
  }
  if (safeType === "travel") {
    return {
      board_type: safeType,
      weather: raw.weather ?? null,
      hazard_meter: raw.hazard_meter ?? null,
      route_segments: Array.isArray(raw.route_segments) ? raw.route_segments.length : 0,
      scouting: raw.scouting ?? null,
      encounter_seeds: Array.isArray(raw.encounter_seeds) ? raw.encounter_seeds.length : 0,
    };
  }
  if (safeType === "dungeon") {
    const roomGraph = raw.room_graph && typeof raw.room_graph === "object"
      ? (raw.room_graph as Record<string, unknown>)
      : null;
    return {
      board_type: safeType,
      rooms: Array.isArray(roomGraph?.rooms) ? roomGraph?.rooms.length : 0,
      loot_nodes: raw.loot_nodes ?? null,
      trap_signals: raw.trap_signals ?? null,
      fog_of_war: raw.fog_of_war ?? null,
      faction_presence: Array.isArray(raw.faction_presence) ? raw.faction_presence.length : 0,
    };
  }
  if (safeType === "combat") {
    const grid = raw.grid && typeof raw.grid === "object" ? (raw.grid as Record<string, unknown>) : null;
    return {
      board_type: safeType,
      combat_session_id: raw.combat_session_id ?? null,
      grid_width: grid?.width ?? null,
      grid_height: grid?.height ?? null,
      blocked_tile_count: Array.isArray(raw.blocked_tiles) ? raw.blocked_tiles.length : 0,
      seed: raw.seed ?? null,
    };
  }
  return {
    board_type: safeType,
    state: truncateText(prettyJson(raw), 400),
  };
}

function summarizeDmContextPayload(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const raw = value as Record<string, unknown>;
  const board = raw.board && typeof raw.board === "object" ? (raw.board as Record<string, unknown>) : null;
  const character = raw.character && typeof raw.character === "object"
    ? (raw.character as Record<string, unknown>)
    : null;
  const combat = raw.combat && typeof raw.combat === "object" ? (raw.combat as Record<string, unknown>) : null;
  const rules = raw.rules && typeof raw.rules === "object" ? (raw.rules as Record<string, unknown>) : null;
  const script = raw.script && typeof raw.script === "object" ? (raw.script as Record<string, unknown>) : null;
  const dmState = raw.dm_campaign_state && typeof raw.dm_campaign_state === "object"
    ? (raw.dm_campaign_state as Record<string, unknown>)
    : null;
  const tension = raw.dm_world_tension && typeof raw.dm_world_tension === "object"
    ? (raw.dm_world_tension as Record<string, unknown>)
    : null;
  return {
    ok: raw.ok ?? null,
    campaign_id: raw.campaign_id ?? null,
    player_id: raw.player_id ?? null,
    warnings: Array.isArray(raw.warnings) ? raw.warnings : [],
    board: board
      ? {
          board_type: board.board_type ?? null,
          status: board.status ?? null,
          combat_session_id: board.combat_session_id ?? null,
          updated_at: board.updated_at ?? null,
          state_summary:
            board.state_summary && typeof board.state_summary === "object"
              ? board.state_summary
              : summarizeBoardState(
                  typeof board.board_type === "string" ? board.board_type : null,
                  board.state_json ?? null,
                ),
        }
      : null,
    character: character
      ? {
          character_id: character.character_id ?? null,
          name: character.name ?? null,
          level: character.level ?? null,
          role: (character.class_json as Record<string, unknown> | null)?.role ?? null,
          class_name: (character.class_json as Record<string, unknown> | null)?.class_name ?? null,
          skill_count: Array.isArray(character.skills) ? character.skills.length : 0,
          resource_primary: (character.resources as Record<string, unknown> | null)?.primary_id ?? null,
        }
      : null,
    combat: combat
      ? {
          combat_session_id: combat.combat_session_id ?? null,
          status: combat.status ?? null,
          current_turn_index: combat.current_turn_index ?? null,
          actor: (combat.dm_payload as Record<string, unknown> | null)?.turn_actor_name ?? null,
          enemies_count: (combat.dm_payload as Record<string, unknown> | null)?.enemies_count ?? null,
          allies_count: (combat.dm_payload as Record<string, unknown> | null)?.allies_count ?? null,
        }
      : null,
    rules: rules ? { name: rules.name ?? null, version: rules.version ?? null } : null,
    script: script ? { name: script.name ?? null, version: script.version ?? null, is_active: script.is_active ?? null } : null,
    dm_campaign_state: dmState
      ? {
          menace: dmState.menace ?? null,
          amusement: dmState.amusement ?? null,
          respect: dmState.respect ?? null,
          boredom: dmState.boredom ?? null,
        }
      : null,
    dm_world_tension: tension
      ? {
          tension: tension.tension ?? null,
          doom: tension.doom ?? null,
          spectacle: tension.spectacle ?? null,
        }
      : null,
  };
}

const pageTurn = {
  initial: { rotateY: -90, opacity: 0, transformOrigin: "left center" },
  animate: { rotateY: 0, opacity: 1, transformOrigin: "left center" },
  exit: { rotateY: 90, opacity: 0, transformOrigin: "right center" },
};

type MythicPanelTab = "character" | "gear" | "skills" | "loadouts" | "progression" | "quests";

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
    loadoutSlotCap,
    isLoading: charLoading,
    error: charError,
    refetch: refetchCharacter,
  } = useMythicCharacter(campaignId);
  const dm = useMythicDmContext(campaignId, Boolean(campaignId && board && character));
  const mythicDm = useMythicDungeonMaster(campaignId);
  const combat = useMythicCombat();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const [bootstrapped, setBootstrapped] = useState(false);
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
      setBootstrapped(true);
      await refetch();
    })();
  }, [authLoading, bootstrapCampaign, campaignId, navigate, refetch, user]);

  const modeKey = useMemo(() => {
    return board ? `${board.board_type}:${board.id}:${board.updated_at}` : "none";
  }, [board]);

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
  const autoTickKeyRef = useRef<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [activePanel, setActivePanel] = useState<MythicPanelTab>("character");

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

  const lastTransition = recentTransitions[0] ?? null;
  const boardStateSummary = useMemo(
    () => summarizeBoardState(board?.board_type, board?.state_json ?? null),
    [board?.board_type, board?.state_json],
  );
  const dmContextSummary = useMemo(() => summarizeDmContextPayload(dm.data), [dm.data]);

  const transitionBoard = async (toBoardType: "town" | "travel" | "dungeon", reason: string) => {
    if (!campaignId) return;
    setIsTransitioning(true);
    setTransitionError(null);
    try {
      const { error } = await callEdgeFunction("mythic-board-transition", {
        requireAuth: true,
        body: { campaignId, toBoardType, reason },
      });
      if (error) throw error;
      await refetch();
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : "Failed to transition board");
    } finally {
      setIsTransitioning(false);
    }
  };

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
  const refetchDm = dm.refetch;

  const advanceNpcTurn = useCallback(async () => {
    if (!campaignId || !combatSessionId || !canAdvanceNpcTurn) return;
    setIsAdvancingTurn(true);
    try {
      const result = await tickCombat({ campaignId, combatSessionId, maxSteps: 1 });
      await Promise.all([refetchCombatState(), refetch()]);
      if (result.ok && result.data?.ended) {
        await refetchCharacter();
      }
    } finally {
      setIsAdvancingTurn(false);
    }
  }, [campaignId, canAdvanceNpcTurn, combatSessionId, refetch, refetchCharacter, refetchCombatState, tickCombat]);

  const bossPhaseLabel = useMemo(() => {
    if (!combatState.events.length) return null;
    const phaseShift = [...combatState.events].reverse().find((e) => e.event_type === "phase_shift");
    if (!phaseShift) return null;
    const phase = Number((phaseShift.payload as Record<string, unknown>)?.phase ?? 0);
    return phase > 0 ? `Boss Phase ${phase}` : "Boss Phase";
  }, [combatState.events]);

  const storyActions = useMemo(() => {
    const boardType = board?.board_type ?? "town";
    if (boardType === "town") {
      return [
        { id: "town-gossip", label: "Gather Rumors", prompt: "I want to gather rumors about immediate threats and opportunities in town." },
        { id: "town-vendor", label: "Check Vendors", prompt: "I inspect vendor stock for upgrades and consumables that fit our current threat profile." },
        { id: "town-faction", label: "Faction Play", prompt: "I approach local faction agents and probe for high-value contracts with clear risks." },
        { id: "town-rest", label: "Regroup", prompt: "I regroup the party, recover resources, and prepare our next objective." },
      ];
    }
    if (boardType === "travel") {
      return [
        { id: "travel-scout", label: "Scout Route", prompt: "I scout the route ahead, mark ambush lanes, and identify the safest advance path." },
        { id: "travel-fast", label: "Push Pace", prompt: "We push pace for a faster arrival while managing exposure to hazard spikes." },
        { id: "travel-cautious", label: "Move Cautious", prompt: "We move cautiously, prioritize survival, and avoid unnecessary engagements." },
        { id: "travel-salvage", label: "Salvage Stop", prompt: "We stop briefly to salvage useful materials without losing momentum." },
      ];
    }
    if (boardType === "dungeon") {
      return [
        { id: "dungeon-traps", label: "Check Traps", prompt: "I search for trap patterns and safe traversal routes through this section." },
        { id: "dungeon-loot", label: "Sweep Loot", prompt: "I sweep for hidden loot nodes and relic caches while maintaining formation." },
        { id: "dungeon-stealth", label: "Stealth Advance", prompt: "I lead with stealth and line-of-sight control to isolate targets before engagement." },
        { id: "dungeon-breach", label: "Force Breach", prompt: "I force a fast breach and commit to decisive close-quarters pressure." },
      ];
    }
    return [
      { id: "combat-focus", label: "Call Focus", prompt: "Focus fire on the highest-threat enemy and keep pressure until it breaks." },
      { id: "combat-control", label: "Control Field", prompt: "Control the battlefield with status and positioning to deny enemy tempo." },
      { id: "combat-survive", label: "Stabilize", prompt: "Stabilize the team, protect low HP allies, and preserve cooldown windows." },
      { id: "combat-finish", label: "Execute", prompt: "Execute the current advantage window and secure the kill cleanly." },
    ];
  }, [board?.board_type]);

  const openPanel = useCallback((tab: MythicPanelTab) => {
    setActivePanel(tab);
    setPanelOpen(true);
  }, []);

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
      <div className="p-4 md:p-6">
        <div className="mx-auto max-w-[1700px] space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-display text-2xl tracking-wide">Mythic Weave</div>
              <div className="text-sm text-muted-foreground">
                Board: <span className="font-medium capitalize">{board.board_type}</span>
                {lastTransition ? (
                  <span className="ml-2">
                    Last transition: {lastTransition.from_board_type ?? "?"} → {lastTransition.to_board_type} ({lastTransition.reason})
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => navigate("/dashboard")}>Dashboard</Button>
              <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
              <Button variant="outline" onClick={() => refetchDm()}>Refresh DM</Button>
              {board.board_type !== "combat" ? (
                <>
                  <Button variant="secondary" disabled={isTransitioning} onClick={() => transitionBoard("town", "return")}>
                    Town
                  </Button>
                  <Button variant="secondary" disabled={isTransitioning} onClick={() => transitionBoard("travel", "travel")}>
                    Travel
                  </Button>
                  <Button variant="secondary" disabled={isTransitioning} onClick={() => transitionBoard("dungeon", "enter_dungeon")}>
                    Dungeon
                  </Button>
                  <Button
                    onClick={async () => {
                      const combatId = await combat.startCombat(campaignId);
                      if (combatId) {
                        await Promise.all([refetch(), refetchDm()]);
                      }
                    }}
                    disabled={combat.isStarting}
                  >
                    {combat.isStarting ? "Starting..." : "Start Combat"}
                  </Button>
                </>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <Button variant="secondary" className="justify-start" onClick={() => openPanel("character")}>Character</Button>
            <Button variant="secondary" className="justify-start" onClick={() => openPanel("gear")}>Gear</Button>
            <Button variant="secondary" className="justify-start" onClick={() => openPanel("skills")}>Skills</Button>
            <Button variant="secondary" className="justify-start" onClick={() => openPanel("loadouts")}>Loadouts</Button>
            <Button variant="secondary" className="justify-start" onClick={() => openPanel("progression")}>Progression</Button>
            <Button variant="secondary" className="justify-start" onClick={() => openPanel("quests")}>Quests</Button>
          </div>

          <div className="rounded-2xl border border-border bg-gradient-to-b from-card/80 to-card/30 p-3 md:p-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <section className="min-h-[760px] overflow-hidden rounded-xl border border-border bg-background/35 shadow-sm">
                <div className="border-b border-border px-4 py-3">
                  <div className="font-display text-lg">Narrative Page</div>
                  <div className="text-xs text-muted-foreground">
                    DM-driven story + contextual player actions
                  </div>
                </div>
                <div className="grid min-h-0 gap-3 p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {storyActions.map((action) => (
                      <Button
                        key={action.id}
                        variant="outline"
                        size="sm"
                        disabled={mythicDm.isLoading}
                        onClick={() => void mythicDm.sendMessage(action.prompt)}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>
                  {mythicDm.isLoading ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>
                        DM request running (attempt {mythicDm.operation?.attempt ?? 1}
                        {mythicDm.operation?.next_retry_at
                          ? ` · retry ${new Date(mythicDm.operation.next_retry_at).toLocaleTimeString()}`
                          : ""}
                        )
                      </span>
                      <Button size="sm" variant="secondary" onClick={() => mythicDm.cancelMessage()}>
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                  <div className="min-h-[420px] overflow-hidden rounded-lg border border-border bg-background/40">
                    <MythicDMChat
                      campaignId={campaignId}
                      messages={mythicDm.messages}
                      isLoading={mythicDm.isLoading}
                      currentResponse={mythicDm.currentResponse}
                      onSendMessage={(msg) => mythicDm.sendMessage(msg)}
                    />
                  </div>
                  <div className="min-h-[180px] overflow-hidden rounded-lg border border-border bg-background/30">
                    <div className="flex items-center justify-between border-b border-border px-3 py-2">
                      <div className="text-sm font-semibold">DM Context</div>
                      <div className="text-xs text-muted-foreground">
                        {dm.isLoading ? "loading..." : dm.error ? "error" : "ok"}
                      </div>
                    </div>
                    <div className="h-[132px] overflow-auto p-3 text-xs text-muted-foreground">
                      {dm.error ? (
                        <div className="text-destructive">{dm.error}</div>
                      ) : (
                        <pre>{prettyJson(dmContextSummary)}</pre>
                      )}
                    </div>
                  </div>
                </div>
              </section>

              <section className="min-h-[760px] overflow-hidden rounded-xl border border-border bg-background/35 shadow-sm">
                <div className="border-b border-border px-4 py-3">
                  <div className="font-display text-lg">Board Page</div>
                  <div className="text-xs text-muted-foreground">
                    Active board renderer + deterministic event playback
                  </div>
                </div>
                <div className="grid min-h-0 gap-3 p-3">
                  <div className="min-h-[300px] overflow-hidden rounded-lg border border-border bg-background/30 [perspective:1200px]">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={modeKey}
                        variants={pageTurn}
                        initial="initial"
                        animate="animate"
                        exit="exit"
                        transition={{ duration: 0.35, ease: "easeInOut" }}
                        className="h-full p-3"
                      >
                        <pre className="max-h-[320px] overflow-auto text-xs text-muted-foreground">{prettyJson(boardStateSummary)}</pre>
                      </motion.div>
                    </AnimatePresence>
                  </div>

                  {board.board_type === "combat" && combatSessionId ? (
                    <div className="min-h-[300px] overflow-hidden rounded-lg border border-border bg-background/30 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold">Combat Playback</div>
                        <div className="text-xs text-muted-foreground">
                          {combatState.isLoading ? "loading..." : combatState.error ? "error" : combatState.session?.status ?? "unknown"}
                        </div>
                      </div>
                      {combatState.error ? (
                        <div className="text-sm text-destructive">{combatState.error}</div>
                      ) : (
                        <MythicCombatPanel
                          campaignId={campaignId}
                          combatSessionId={combatSessionId}
                          combatants={combatState.combatants}
                          activeTurnCombatantId={combatState.activeTurnCombatantId}
                          events={combatState.events}
                          playerCombatantId={playerCombatantId}
                          currentTurnIndex={combatState.session?.current_turn_index ?? 0}
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
                          onTickTurn={async () => {
                            await advanceNpcTurn();
                          }}
                          onUseSkill={async ({ actorCombatantId, skillId, target }) => {
                            const result = await combat.useSkill({
                              campaignId,
                              combatSessionId,
                              actorCombatantId,
                              skillId,
                              target,
                            });
                            await Promise.all([combatState.refetch(), refetch()]);
                            if (result.ok && result.ended) {
                              await refetchCharacter();
                            }
                          }}
                        />
                      )}
                    </div>
                  ) : (
                    <div className="grid min-h-[300px] gap-3 rounded-lg border border-border bg-background/30 p-3">
                      <div>
                        <div className="mb-1 text-sm font-semibold">Board Summary</div>
                        <div className="max-h-[120px] overflow-auto text-xs text-muted-foreground">
                          {board.board_type === "town" ? (
                            <div className="space-y-1">
                              <div>Vendors: {Array.isArray((board.state_json as any)?.vendors) ? (board.state_json as any).vendors.length : 0}</div>
                              <div>Services: {Array.isArray((board.state_json as any)?.services) ? (board.state_json as any).services.join(", ") : "-"}</div>
                              <div>Factions: {Array.isArray((board.state_json as any)?.factions_present) ? (board.state_json as any).factions_present.join(", ") : "-"}</div>
                              <div>Rumors: {Array.isArray((board.state_json as any)?.rumors) ? (board.state_json as any).rumors.join(" · ") : "-"}</div>
                            </div>
                          ) : null}
                          {board.board_type === "travel" ? (
                            <div className="space-y-1">
                              <div>Weather: {String((board.state_json as any)?.weather ?? "-")}</div>
                              <div>Hazard: {String((board.state_json as any)?.hazard_meter ?? "-")}</div>
                              <div>Segments: {Array.isArray((board.state_json as any)?.route_segments) ? (board.state_json as any).route_segments.length : 0}</div>
                            </div>
                          ) : null}
                          {board.board_type === "dungeon" ? (
                            <div className="space-y-1">
                              <div>Rooms: {Array.isArray((board.state_json as any)?.room_graph?.rooms) ? (board.state_json as any).room_graph.rooms.length : 0}</div>
                              <div>Loot nodes: {String((board.state_json as any)?.loot_nodes ?? "-")}</div>
                              <div>Trap signals: {String((board.state_json as any)?.trap_signals ?? "-")}</div>
                              <div>Faction presence: {Array.isArray((board.state_json as any)?.faction_presence) ? (board.state_json as any).faction_presence.join(", ") : "-"}</div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 text-sm font-semibold">Board Actions</div>
                        <div className="flex flex-wrap gap-2">
                          {board.board_type === "travel" ? (
                            <>
                              <Button variant="secondary" size="sm" disabled={isTransitioning} onClick={() => transitionBoard("town", "arrival")}>
                                Arrive Town
                              </Button>
                              <Button variant="secondary" size="sm" disabled={isTransitioning} onClick={() => transitionBoard("dungeon", "arrival")}>
                                Arrive Dungeon
                              </Button>
                            </>
                          ) : null}
                          {board.board_type === "dungeon" ? (
                            <>
                              <Button variant="secondary" size="sm" disabled={isTransitioning} onClick={() => transitionBoard("town", "exit_dungeon")}>
                                Exit to Town
                              </Button>
                              <Button variant="secondary" size="sm" disabled={isTransitioning} onClick={() => transitionBoard("travel", "exit_dungeon")}>
                                Exit to Travel
                              </Button>
                            </>
                          ) : null}
                          {board.board_type === "town" ? (
                            <Button variant="secondary" size="sm" disabled={isTransitioning} onClick={() => transitionBoard("travel", "depart")}>
                              Depart Travel
                            </Button>
                          ) : null}
                        </div>
                        {transitionError ? <div className="mt-1 text-xs text-destructive">{transitionError}</div> : null}
                      </div>
                    </div>
                  )}

                  <div className="min-h-[120px] overflow-hidden rounded-lg border border-border bg-background/30">
                    <div className="border-b border-border px-3 py-2 text-sm font-semibold">Recent Board Transitions</div>
                    <pre className="max-h-[86px] overflow-auto p-3 text-xs text-muted-foreground">{prettyJson(recentTransitions)}</pre>
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>

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
                campaignId={campaignId ?? ""}
                characterId={character.id}
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
                        <div className="flex flex-wrap gap-2">
                          <span>{new Date(event.created_at).toLocaleTimeString()}</span>
                          {(() => {
                            const payload = (event.payload ?? {}) as Record<string, unknown>;
                            const amt = Number((payload as any).amount ?? (payload as any).xp_amount ?? (payload as any).xp ?? NaN);
                            if (event.event_type === "xp_applied" && Number.isFinite(amt) && amt > 0) {
                              return <span className="rounded bg-muted px-2 py-0.5 text-foreground">XP +{Math.floor(amt)}</span>;
                            }
                            return null;
                          })()}
                          {(() => {
                            const payload = (event.payload ?? {}) as Record<string, unknown>;
                            const meta = (payload as any).metadata;
                            const combatSessionId = meta && typeof meta === "object" ? String((meta as any).combat_session_id ?? "") : "";
                            if (combatSessionId) {
                              return <span className="rounded bg-muted px-2 py-0.5">combat {combatSessionId.slice(0, 8)}</span>;
                            }
                            return null;
                          })()}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {activePanel === "quests" ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="mb-1 text-sm font-semibold">Board Hooks</div>
                  <pre className="max-h-[220px] overflow-auto text-xs text-muted-foreground">{prettyJson((board.state_json as any)?.rumors ?? [])}</pre>
                </div>
                <div className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="mb-1 text-sm font-semibold">Transition Log</div>
                  <pre className="max-h-[220px] overflow-auto text-xs text-muted-foreground">{prettyJson(recentTransitions)}</pre>
                </div>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
