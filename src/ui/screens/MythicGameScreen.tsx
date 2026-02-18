import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useMythicCreator } from "@/hooks/useMythicCreator";
import { useMythicBoard } from "@/hooks/useMythicBoard";
import { useMythicCharacter } from "@/hooks/useMythicCharacter";
import { useMythicDmContext } from "@/hooks/useMythicDmContext";
import { useMythicDungeonMaster } from "@/hooks/useMythicDungeonMaster";
import { MythicDMChat } from "@/components/MythicDMChat";
import { useMythicCombat, type MythicCombatRewardSummary } from "@/hooks/useMythicCombat";
import { useMythicCombatState } from "@/hooks/useMythicCombatState";
import { MythicCombatPanel } from "@/components/mythic/MythicCombatPanel";
import { MythicInventoryPanel } from "@/components/mythic/MythicInventoryPanel";
import { MythicQuestPanel } from "@/components/mythic/MythicQuestPanel";
import { MythicStoryTimeline } from "@/components/mythic/MythicStoryTimeline";
import { useMythicQuestArcs } from "@/hooks/useMythicQuestArcs";
import { useMythicStoryTimeline } from "@/hooks/useMythicStoryTimeline";
import { callEdgeFunction } from "@/lib/edge";
import { sumStatMods, splitInventory, type MythicInventoryRow as EquipmentInventoryRow } from "@/lib/mythicEquipment";
import { MythicBoardViewport } from "@/components/mythic/boards/MythicBoardViewport";
import type { MythicDirection } from "@/types/mythicBoard";

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export default function MythicGameScreen() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === "true";

  const { bootstrapCampaign, isBootstrapping } = useMythicCreator();
  const {
    board,
    boardStateV2,
    chunkMeta,
    biome,
    parseDiagnostics,
    parseError,
    recentTransitions,
    isLoading: boardLoading,
    error: boardError,
    refetch,
  } = useMythicBoard(campaignId);
  const { character, skills, items, isLoading: charLoading, error: charError, refetch: refetchCharacter } = useMythicCharacter(campaignId);
  const dm = useMythicDmContext(campaignId, Boolean(campaignId && board && character));
  const mythicDm = useMythicDungeonMaster(campaignId);
  const questArcs = useMythicQuestArcs(campaignId);
  const storyTimeline = useMythicStoryTimeline(campaignId);
  const combat = useMythicCombat();
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [combatRewards, setCombatRewards] = useState<MythicCombatRewardSummary | null>(null);

  const [bootstrapped, setBootstrapped] = useState(false);
  const bootstrapOnceRef = useRef(false);

  useEffect(() => {
    if (!campaignId) return;
    if (!E2E_BYPASS_AUTH && authLoading) return;
    if (!E2E_BYPASS_AUTH && !user) {
      navigate("/login");
      return;
    }
    if (bootstrapOnceRef.current) return;
    bootstrapOnceRef.current = true;

    if (E2E_BYPASS_AUTH) {
      setBootstrapped(true);
      return;
    }

    (async () => {
      await bootstrapCampaign(campaignId);
      setBootstrapped(true);
      await refetch();
    })();
  }, [E2E_BYPASS_AUTH, authLoading, bootstrapCampaign, campaignId, navigate, refetch, user]);

  const combatSessionId = useMemo(() => {
    if (!board) return null;
    const stateJson = asRecord(board.state_json);
    const stateSessionId = typeof stateJson.combat_session_id === "string" ? stateJson.combat_session_id : null;
    return board.combat_session_id ?? stateSessionId;
  }, [board]);

  const combatState = useMythicCombatState(campaignId, board?.board_type === "combat" ? combatSessionId : null);
  const combatGrid = useMemo(() => {
    const fallback = { width: 12, height: 8, blockedTiles: [] as Array<{ x: number; y: number }> };
    if (!board || board.board_type !== "combat") return fallback;
    const state = asRecord(board.state_json);
    const grid = asRecord(state.grid);
    const width = Number.isFinite(Number(grid.width)) ? Math.max(4, Math.floor(Number(grid.width))) : fallback.width;
    const height = Number.isFinite(Number(grid.height)) ? Math.max(4, Math.floor(Number(grid.height))) : fallback.height;
    const blockedTiles = asArray(state.blocked_tiles)
      .map((entry) => asRecord(entry))
      .filter((entry) => Number.isFinite(Number(entry.x)) && Number.isFinite(Number(entry.y)))
      .map((entry) => ({ x: Math.floor(Number(entry.x)), y: Math.floor(Number(entry.y)) }));
    return { width, height, blockedTiles };
  }, [board]);
  const playerCombatantId = useMemo(() => {
    if (user) {
      const currentUserCombatant = combatState.combatants.find((x) => x.entity_type === "player" && x.player_id === user.id);
      if (currentUserCombatant) return currentUserCombatant.id;
    }
    return combatState.combatants.find((x) => x.entity_type === "player")?.id ?? null;
  }, [combatState.combatants, user]);

  const combatItems = useMemo(() => {
    return items
      .filter((row) => row.quantity > 0 && row.container === "backpack" && row.item !== null)
      .filter((row) => row.item.slot === "consumable" || row.item.item_type === "consumable")
      .map((row) => {
        const effects = asRecord(row.item.effects_json);
        const rawDamage = effects.damage;
        const nestedDamage = asRecord(rawDamage).amount;
        const damage =
          typeof rawDamage === "number"
            ? rawDamage
            : typeof nestedDamage === "number"
              ? nestedDamage
              : Number(nestedDamage);
        const targeting: "self" | "single" = Number.isFinite(damage) && damage > 0 ? "single" : "self";
        return {
          inventoryId: row.id,
          itemId: row.item.id,
          name: row.item.name,
          quantity: row.quantity,
          container: row.container,
          itemType: row.item.item_type,
          slot: row.item.slot,
          targeting,
        };
      });
  }, [items]);

  const invRowsSafe = useMemo<EquipmentInventoryRow[]>(() => {
    return items.map((row) => ({
      id: row.id,
      container: row.container === "equipment" ? "equipment" : "backpack",
      equip_slot: row.equip_slot,
      quantity: row.quantity,
      item: row.item
        ? {
            id: row.item.id,
            name: row.item.name,
            slot: row.item.slot,
            stat_mods: asRecord(row.item.stat_mods),
            effects_json: asRecord(row.item.effects_json),
            rarity: row.item.rarity,
          }
        : null,
    }));
  }, [items]);

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

  if (!campaignId) {
    return <div className="p-6 text-sm text-muted-foreground">Campaign not found.</div>;
  }

  if ((!E2E_BYPASS_AUTH && authLoading) || boardLoading || charLoading || isBootstrapping) {
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

  const boardState = asRecord(board.state_json);
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

  const stepBoard = async (direction: MythicDirection) => {
    if (!campaignId || board.board_type === "combat") return;
    setIsTransitioning(true);
    setTransitionError(null);
    try {
      const { error } = await callEdgeFunction("mythic-board-step", {
        requireAuth: true,
        body: { campaignId, direction },
      });
      if (error) throw error;
      await refetch();
      await questArcs.refetch();
      await storyTimeline.refetch();
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : "Failed to step board");
    } finally {
      setIsTransitioning(false);
    }
  };

  const interactBoard = async (args: { entityId: string; entityKind: string; action: "interact" | "destroy" | "open" }) => {
    if (!campaignId || board.board_type === "combat") return;
    try {
      const { error } = await callEdgeFunction("mythic-board-interact", {
        requireAuth: true,
        body: {
          campaignId,
          entityId: args.entityId,
          entityKind: args.entityKind,
          action: args.action,
        },
      });
      if (error) throw error;
      await refetch();
      await questArcs.refetch();
      await storyTimeline.refetch();
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : "Interaction failed");
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

  return (
    <div className="space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-display text-2xl">Mythic Weave</div>
          <div className="text-sm text-muted-foreground">
            Board: <span className="font-medium">{board.board_type}</span>{" "}
            {lastTransition ? (
              <span className="text-muted-foreground">
                (last transition: {lastTransition.from_board_type ?? "?"} → {lastTransition.to_board_type}, {lastTransition.reason})
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("/dashboard")}>Dashboard</Button>
          <Button variant="outline" onClick={() => navigate(`/game/${campaignId}`)}>Legacy Game</Button>
          <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
          <Button variant="outline" onClick={() => setShowAdvanced((prev) => !prev)}>
            {showAdvanced ? "Hide Advanced" : "Show Advanced"}
          </Button>
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
                    setCombatRewards(null);
                    await refetch();
                    await dm.refetch();
                  }
                }}
                disabled={combat.isStarting || combat.isBusy}
              >
                {combat.isStarting ? "Starting..." : "Start Combat"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {combatRewards ? (
        <div className="mythic-reward-flip rounded-xl border border-primary/40 bg-card/60 p-4">
          <div className="mb-2 text-sm font-semibold">Battle Rewards</div>
          <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
            <div>
              <div>XP gained: <span className="font-medium text-foreground">{combatRewards.xp_gained}</span></div>
              <div>
                Level:{" "}
                <span className="font-medium text-foreground">
                  {combatRewards.level_before} → {combatRewards.level_after}
                </span>
                {combatRewards.level_ups > 0 ? ` (+${combatRewards.level_ups})` : ""}
              </div>
              <div>
                Progress:{" "}
                <span className="font-medium text-foreground">
                  {combatRewards.xp_after}/{combatRewards.xp_to_next}
                </span>
              </div>
            </div>
            <div>
              <div>Defeated enemies: <span className="font-medium text-foreground">{combatRewards.outcome.defeated_npcs}</span></div>
              <div>Surviving allies: <span className="font-medium text-foreground">{combatRewards.outcome.surviving_players}</span></div>
              <div>Loot drops: <span className="font-medium text-foreground">{combatRewards.loot.length}</span></div>
            </div>
          </div>
          {combatRewards.loot.length > 0 ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {combatRewards.loot.map((loot) => (
                <div key={loot.item_id} className="rounded-md border border-border bg-background/30 p-2 text-xs">
                  <div className="font-medium text-foreground">{loot.name}</div>
                  <div className="text-muted-foreground">
                    {loot.rarity} · {loot.slot} · power {loot.item_power}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-3 flex justify-end">
            <Button variant="secondary" onClick={() => setCombatRewards(null)}>
              Continue Exploring
            </Button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Character</div>
          <div className="text-sm">
            <div className="font-medium">{character.name}</div>
            <div className="text-muted-foreground">{String(asRecord(character.class_json).class_name ?? "(class)")}</div>
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
                <div className="text-xs text-muted-foreground">
                  {s.kind} · {s.targeting} · r{s.range_tiles} · cd{s.cooldown_turns}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {board.board_type !== "combat" && boardStateV2 ? (
            <MythicBoardViewport
              boardState={boardStateV2}
              isBusy={isTransitioning}
              onEdgeStep={stepBoard}
              onInteract={interactBoard}
            />
          ) : (
            <div className="rounded-xl border border-border bg-card/40 p-4 text-sm text-muted-foreground">
              Board renderer unavailable for this board mode.
            </div>
          )}

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
            <div className="mt-3 text-xs text-muted-foreground">
              Chunk: {chunkMeta ? `${chunkMeta.coord_x},${chunkMeta.coord_y}` : "-"} · Biome: {biome ?? "-"}
              {bootstrapped ? " · bootstrapped" : ""}
            </div>
          </div>
        </div>
      </div>

      {board.board_type === "combat" && combatSessionId ? (
        <div className="rounded-xl border border-border bg-card/40 p-4">
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
              turnOrder={combatState.turnOrder}
              activeTurnCombatantId={combatState.activeTurnCombatantId}
              events={combatState.events}
              playerCombatantId={playerCombatantId}
              currentTurnIndex={combatState.session?.current_turn_index ?? 0}
              grid={combatGrid}
              skills={skills.map((s) => ({
                id: s.id,
                kind: s.kind,
                name: s.name,
                description: s.description,
                targeting: s.targeting,
                range_tiles: s.range_tiles,
                cooldown_turns: s.cooldown_turns,
              }))}
              items={combatItems}
              isActing={combat.isActing || combat.isClaimingRewards}
              onMove={async ({ actorCombatantId, to }) => {
                const result = await combat.moveActor({
                  campaignId,
                  combatSessionId,
                  actorCombatantId,
                  to,
                });
                if (result?.ok) {
                  await combatState.refetch();
                }
              }}
              onWait={async ({ actorCombatantId }) => {
                const result = await combat.waitTurn({
                  campaignId,
                  combatSessionId,
                  actorCombatantId,
                });
                if (result?.ok) {
                  await combatState.refetch();
                }
              }}
              onUseSkill={async ({ actorCombatantId, skillId, target }) => {
                const result = await combat.useSkill({
                  campaignId,
                  combatSessionId,
                  actorCombatantId,
                  skillId,
                  target,
                });
                await combatState.refetch();
                if (result.ok && result.ended) {
                  const rewards = await combat.claimRewards({
                    campaignId,
                    combatSessionId,
                  });
                  if (rewards) {
                    setCombatRewards(rewards);
                  }
                  await refetchCharacter();
                  await refetch();
                  await dm.refetch();
                  await questArcs.refetch();
                  await storyTimeline.refetch();
                }
              }}
              onUseItem={async ({ actorCombatantId, inventoryItemId, target }) => {
                const result = await combat.useItem({
                  campaignId,
                  combatSessionId,
                  actorCombatantId,
                  inventoryItemId,
                  target,
                });
                await combatState.refetch();
                await refetchCharacter();
                if (result.ok && result.ended) {
                  const rewards = await combat.claimRewards({
                    campaignId,
                    combatSessionId,
                  });
                  if (rewards) {
                    setCombatRewards(rewards);
                  }
                  await refetch();
                  await dm.refetch();
                  await questArcs.refetch();
                  await storyTimeline.refetch();
                }
              }}
            />
          )}
        </div>
      ) : null}

      <MythicInventoryPanel
        rows={invRowsSafe}
        onChanged={async () => {
          await recomputeCharacter();
          await refetch();
          await questArcs.refetch();
        }}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <MythicQuestPanel
          arcs={questArcs.arcs}
          isLoading={questArcs.isLoading}
          error={questArcs.error}
        />
        <MythicStoryTimeline
          beats={storyTimeline.beats}
          isLoading={storyTimeline.isLoading}
          error={storyTimeline.error}
        />
      </div>

      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-2 text-sm font-semibold">Mythic DM (DB-driven narration)</div>
        <div className="h-[520px] overflow-hidden rounded-lg border border-border bg-background/30">
          <MythicDMChat
            messages={mythicDm.messages}
            isLoading={mythicDm.isLoading}
            currentResponse={mythicDm.currentResponse}
            onSendMessage={async (msg, actionTags) => {
              await mythicDm.sendMessage(msg, { actionTags });
              await dm.refetch();
              await questArcs.refetch();
              await storyTimeline.refetch();
            }}
          />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          Uses edge function <code>mythic-dungeon-master</code> with DB-authoritative rules, board state, character state, and adaptive DM mood.
        </div>
      </div>

      {showAdvanced ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="mb-2 text-sm font-semibold">Board State JSON (Advanced)</div>
            <pre className="max-h-[520px] overflow-auto text-xs text-muted-foreground">{prettyJson(board.state_json)}</pre>
            {parseError ? <div className="mt-2 text-xs text-destructive">{parseError}</div> : null}
            {parseDiagnostics.length > 0 ? (
              <pre className="mt-2 max-h-[140px] overflow-auto text-[11px] text-amber-200/90">
                {prettyJson(parseDiagnostics)}
              </pre>
            ) : null}
          </div>

          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="mb-2 text-sm font-semibold">Recent Board Transitions (Advanced)</div>
            <pre className="max-h-[280px] overflow-auto text-xs text-muted-foreground">{prettyJson(recentTransitions)}</pre>
          </div>

          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold">DM Context JSON (Advanced)</div>
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

          <div className="rounded-xl border border-border bg-card/40 p-4">
            <div className="mb-2 text-sm font-semibold">System Notes (Advanced)</div>
            <div className="text-sm text-muted-foreground">
              Combat actions are committed as append-only <code>mythic.action_events</code>. Tokens on the grid render real
              <code>mythic.combatants</code> rows (HP/armor/position), and turns advance by updating
              <code>mythic.combat_sessions.current_turn_index</code>.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
