import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  const { character, skills, items, isLoading: charLoading, error: charError } = useMythicCharacter(campaignId);
  const dm = useMythicDmContext(campaignId);
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
        <Button onClick={() => navigate(`/game/${campaignId}/create-character`)}>Create Character</Button>
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

  const lastTransition = recentTransitions[0] ?? null;
  const combatSessionId =
    board.combat_session_id
    ?? (typeof (board.state_json as any)?.combat_session_id === "string" ? String((board.state_json as any).combat_session_id) : null);
  const combatState = useMythicCombatState(campaignId, board.board_type === "combat" ? combatSessionId : null);
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
    offense: Math.min(100, Math.max(0, Math.floor(character.offense + (equipBonuses.offense ?? 0)))),
    defense: Math.min(100, Math.max(0, Math.floor(character.defense + (equipBonuses.defense ?? 0)))),
    control: Math.min(100, Math.max(0, Math.floor(character.control + (equipBonuses.control ?? 0)))),
    support: Math.min(100, Math.max(0, Math.floor(character.support + (equipBonuses.support ?? 0)))),
    mobility: Math.min(100, Math.max(0, Math.floor(character.mobility + (equipBonuses.mobility ?? 0)))),
    utility: Math.min(100, Math.max(0, Math.floor(character.utility + (equipBonuses.utility ?? 0)))),
  };

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
          <Button variant="outline" onClick={() => navigate(`/game/${campaignId}`)}>Legacy Game</Button>
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
