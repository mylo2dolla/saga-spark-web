import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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

const pageTurn = {
  initial: { rotateY: -90, opacity: 0, transformOrigin: "left center" },
  animate: { rotateY: 0, opacity: 1, transformOrigin: "left center" },
  exit: { rotateY: 90, opacity: 0, transformOrigin: "right center" },
};

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
    () => (Array.isArray(items) ? (items as MythicInventoryRow[]) : []),
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
  const [isApplyingXp, setIsApplyingXp] = useState(false);
  const [isRollingLoot, setIsRollingLoot] = useState(false);
  const [isAdvancingTurn, setIsAdvancingTurn] = useState(false);
  const autoTickKeyRef = useRef<string | null>(null);

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

  const applyXp = async (amount: number) => {
    if (!campaignId || !character) return;
    setIsApplyingXp(true);
    try {
      const { data, error } = await callEdgeFunction<{ ok: boolean }>("mythic-apply-xp", {
        requireAuth: true,
        body: {
          campaignId,
          characterId: character.id,
          amount,
          reason: "manual_progression",
          metadata: { source: "mythic_screen_quick_action" },
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Failed to apply XP");
      await refetchCharacter();
      toast.success(`Applied ${amount} XP`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to apply XP");
    } finally {
      setIsApplyingXp(false);
    }
  };

  const generateLoot = async () => {
    if (!campaignId || !character) return;
    setIsRollingLoot(true);
    try {
      const { data, error } = await callEdgeFunction<{ ok: boolean; count: number }>("mythic-generate-loot", {
        requireAuth: true,
        body: {
          campaignId,
          characterId: character.id,
          count: 1,
          source: "manual_debug_drop",
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Failed to generate loot");
      await refetchCharacter();
      toast.success("Loot generated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to generate loot");
    } finally {
      setIsRollingLoot(false);
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
    <div className="p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-2xl">Mythic Weave</div>
          <div className="text-sm text-muted-foreground">
            Board: <span className="font-medium">{board.board_type}</span>{" "}
            {lastTransition ? (
              <span className="text-muted-foreground">(last transition: {lastTransition.from_board_type ?? "?"} → {lastTransition.to_board_type}, {lastTransition.reason})</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate(`/dashboard`)}>Dashboard</Button>
          <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          <Button variant="outline" onClick={() => dm.refetch()}>Refresh DM</Button>
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
            </>
          ) : null}
          {board.board_type !== "combat" ? (
            <Button
              onClick={async () => {
                const combatId = await combat.startCombat(campaignId);
                if (combatId) {
                  // Board switch + action_events are written server-side. Pull fresh state.
                  await refetch();
                  await dm.refetch();
                }
              }}
              disabled={combat.isStarting}
            >
              {combat.isStarting ? "Starting..." : "Start Combat"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Character</div>
          <div className="text-sm">
            <div className="font-medium">{character.name}</div>
            <div className="text-muted-foreground">{String((character.class_json as any)?.class_name ?? "(class)")}</div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">Derived Stats (equipment applied)</div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>Offense: {derivedStats.offense}</div>
            <div>Defense: {derivedStats.defense}</div>
            <div>Control: {derivedStats.control}</div>
            <div>Support: {derivedStats.support}</div>
            <div>Mobility: {derivedStats.mobility}</div>
            <div>Utility: {derivedStats.utility}</div>
          </div>
          <div className="mt-3 text-xs text-muted-foreground">Skills</div>
          <div className="mt-2 grid gap-2">
            {skills.slice(0, 6).map((s) => (
              <div key={s.id} className="rounded-md border border-border bg-background/30 p-2">
                <div className="text-sm font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.kind} · {s.targeting} · r{s.range_tiles} · cd{s.cooldown_turns}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/40 p-4 [perspective:1200px]">
          <div className="mb-2 text-sm font-semibold">Board State (authoritative)</div>
          <AnimatePresence mode="wait">
            <motion.div
              key={modeKey}
              variants={pageTurn}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35, ease: "easeInOut" }}
              className="rounded-lg border border-border bg-background/30 p-3"
            >
              <pre className="max-h-[520px] overflow-auto text-xs text-muted-foreground">{prettyJson(board.state_json)}</pre>
            </motion.div>
          </AnimatePresence>
          <div className="mt-3 text-xs text-muted-foreground">
            UI contract: board + transitions + action_events are sufficient for deterministic replay.
            {bootstrapped ? " (bootstrapped)" : ""}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Progression</div>
          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
            <div>Level: {character.level}</div>
            <div>Unspent Points: {character.unspent_points ?? 0}</div>
            <div>XP: {character.xp ?? 0}</div>
            <div>XP to Next: {character.xp_to_next ?? 0}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void applyXp(250)} disabled={isApplyingXp}>
              {isApplyingXp ? "Applying XP..." : "+250 XP"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => void generateLoot()} disabled={isRollingLoot}>
              {isRollingLoot ? "Rolling..." : "Generate Loot"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void recomputeCharacter()}>
              Recompute
            </Button>
          </div>
          <div className="mt-3 text-xs font-semibold text-muted-foreground">Recent Progression Events</div>
          <div className="mt-2 max-h-[180px] overflow-auto space-y-1 text-xs text-muted-foreground">
            {progressionEvents.length === 0 ? (
              <div>No progression events yet.</div>
            ) : (
              progressionEvents.map((event) => (
                <div key={event.id} className="rounded border border-border bg-background/20 px-2 py-1">
                  <div className="font-medium text-foreground">{event.event_type}</div>
                  <div>{new Date(event.created_at).toLocaleTimeString()}</div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Skill Loadout</div>
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
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void saveLoadout()} disabled={isSavingLoadout}>
              {isSavingLoadout ? "Saving..." : "Save + Activate"}
            </Button>
          </div>
          <div className="mt-3 text-xs font-semibold text-muted-foreground">Saved Loadouts</div>
          <div className="mt-2 space-y-1">
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
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Board Summary</div>
          {board.board_type === "town" ? (
            <div className="space-y-2 text-xs text-muted-foreground">
              <div>Vendors: {Array.isArray((board.state_json as any)?.vendors) ? (board.state_json as any).vendors.length : 0}</div>
              <div>Services: {Array.isArray((board.state_json as any)?.services) ? (board.state_json as any).services.join(", ") : "-"}</div>
              <div>Factions: {Array.isArray((board.state_json as any)?.factions_present) ? (board.state_json as any).factions_present.join(", ") : "-"}</div>
              <div>Rumors: {Array.isArray((board.state_json as any)?.rumors) ? (board.state_json as any).rumors.join(" · ") : "-"}</div>
            </div>
          ) : null}
          {board.board_type === "travel" ? (
            <div className="space-y-2 text-xs text-muted-foreground">
              <div>Weather: {String((board.state_json as any)?.weather ?? "-")}</div>
              <div>Hazard: {String((board.state_json as any)?.hazard_meter ?? "-")}</div>
              <div>Segments: {Array.isArray((board.state_json as any)?.route_segments) ? (board.state_json as any).route_segments.length : 0}</div>
            </div>
          ) : null}
          {board.board_type === "dungeon" ? (
            <div className="space-y-2 text-xs text-muted-foreground">
              <div>Rooms: {Array.isArray((board.state_json as any)?.room_graph?.rooms) ? (board.state_json as any).room_graph.rooms.length : 0}</div>
              <div>Loot nodes: {String((board.state_json as any)?.loot_nodes ?? "-")}</div>
              <div>Trap signals: {String((board.state_json as any)?.trap_signals ?? "-")}</div>
              <div>Faction presence: {Array.isArray((board.state_json as any)?.faction_presence) ? (board.state_json as any).faction_presence.join(", ") : "-"}</div>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Board Actions</div>
          <div className="flex flex-wrap gap-2">
            {board.board_type === "travel" ? (
              <>
                <Button variant="secondary" disabled={isTransitioning} onClick={() => transitionBoard("town", "arrival")}>
                  Arrive Town
                </Button>
                <Button variant="secondary" disabled={isTransitioning} onClick={() => transitionBoard("dungeon", "arrival")}>
                  Arrive Dungeon
                </Button>
              </>
            ) : null}
            {board.board_type === "dungeon" ? (
              <>
                <Button variant="secondary" disabled={isTransitioning} onClick={() => transitionBoard("town", "exit_dungeon")}>
                  Exit to Town
                </Button>
                <Button variant="secondary" disabled={isTransitioning} onClick={() => transitionBoard("travel", "exit_dungeon")}>
                  Exit to Travel
                </Button>
              </>
            ) : null}
            {board.board_type === "town" ? (
              <Button variant="secondary" disabled={isTransitioning} onClick={() => transitionBoard("travel", "depart")}>
                Depart Travel
              </Button>
            ) : null}
          </div>
          {transitionError ? <div className="mt-2 text-xs text-destructive">{transitionError}</div> : null}
        </div>
      </div>

      {board.board_type === "combat" && combatSessionId ? (
        <div className="mt-6 rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold">Combat Playback (DB is truth)</div>
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
                await combat.useSkill({
                  campaignId,
                  combatSessionId,
                  actorCombatantId,
                  skillId,
                  target,
                });
                await combatState.refetch();
              }}
            />
          )}
        </div>
      ) : null}

      <div className="mt-6">
        <MythicInventoryPanel
          rows={invRowsSafe}
          onChanged={async () => {
            await recomputeCharacter();
            await refetch();
          }}
        />
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-2 text-sm font-semibold">Recent Board Transitions (append-only)</div>
        <pre className="max-h-[280px] overflow-auto text-xs text-muted-foreground">{prettyJson(recentTransitions)}</pre>
        {transitionError ? <div className="mt-2 text-xs text-destructive">{transitionError}</div> : null}
      </div>

      <div className="mt-6 rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold">DM Context (from mythic.v_*_for_dm + canonical rules/script)</div>
          <div className="text-xs text-muted-foreground">
            {dm.isLoading ? "loading..." : dm.error ? "error" : "ok"}
          </div>
        </div>
        {dm.error ? (
          <div className="text-sm text-destructive">{dm.error}</div>
        ) : (
          <pre className="max-h-[360px] overflow-auto text-xs text-muted-foreground">{prettyJson(dm.data)}</pre>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Mythic DM (DB-driven narration)</div>
          <div className="h-[520px] overflow-hidden rounded-lg border border-border bg-background/30">
            <MythicDMChat
              campaignId={campaignId}
              messages={mythicDm.messages}
              isLoading={mythicDm.isLoading}
              currentResponse={mythicDm.currentResponse}
              onSendMessage={(msg) => mythicDm.sendMessage(msg)}
            />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Uses edge function <code>mythic-dungeon-master</code> and feeds it canonical rules/script + mythic.v_*_for_dm payloads.
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">System Notes</div>
          <div className="text-sm text-muted-foreground">
            Combat actions are committed as append-only <code>mythic.action_events</code>. Tokens on the grid render the real
            <code>mythic.combatants</code> rows (HP/armor/position), and turns advance by updating
            <code>mythic.combat_sessions.current_turn_index</code>.
          </div>
        </div>
      </div>
    </div>
  );
}
