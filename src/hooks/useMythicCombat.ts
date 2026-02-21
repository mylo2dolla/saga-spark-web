import { useCallback, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunction } from "@/lib/edge";
import { parseEdgeError } from "@/lib/edgeError";
import { supabase } from "@/integrations/supabase/client";
import { runOperation } from "@/lib/ops/runOperation";
import type { OperationState } from "@/lib/ops/operationState";
import { createLogger } from "@/lib/observability/logger";
import type {
  MythicActionEventRow,
  MythicCombatantRow,
  MythicCombatSessionRow,
  MythicTurnOrderRow,
} from "@/hooks/useMythicCombatState";

const logger = createLogger("mythic-combat-hook");

export type MythicCombatStartResult =
  | { ok: true; combatSessionId: string }
  | { ok: false; message: string; code: string | null; requestId: string | null };

export interface MythicCombatMutationSnapshot {
  session: MythicCombatSessionRow | null;
  combatants: MythicCombatantRow[];
  turnOrder: MythicTurnOrderRow[];
  events: MythicActionEventRow[];
  activeTurnCombatantId: string | null;
}

function extractRecentEventBatch(events: MythicActionEventRow[], maxItems = 12): MythicActionEventRow[] {
  return events.slice(-Math.max(1, maxItems));
}

export function useMythicCombat() {
  const [isStarting, setIsStarting] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isTicking, setIsTicking] = useState(false);
  const [startOperation, setStartOperation] = useState<OperationState | null>(null);
  const [actionOperation, setActionOperation] = useState<OperationState | null>(null);
  const [tickOperation, setTickOperation] = useState<OperationState | null>(null);

  const loadSnapshot = useCallback(async (
    campaignId: string,
    combatSessionId: string,
  ): Promise<MythicCombatMutationSnapshot | null> => {
    const [{ data: session }, { data: combatants }, { data: turnOrder }, { data: events }] = await Promise.all([
      supabase
        .schema("mythic")
        .from("combat_sessions")
        .select("id,campaign_id,seed,status,current_turn_index,scene_json,updated_at")
        .eq("id", combatSessionId)
        .eq("campaign_id", campaignId)
        .maybeSingle(),
      supabase
        .schema("mythic")
        .from("combatants")
        .select("*")
        .eq("combat_session_id", combatSessionId)
        .order("initiative", { ascending: false })
        .order("name", { ascending: true }),
      supabase
        .schema("mythic")
        .from("turn_order")
        .select("*")
        .eq("combat_session_id", combatSessionId)
        .order("turn_index", { ascending: true }),
      supabase
        .schema("mythic")
        .from("action_events")
        .select("*")
        .eq("combat_session_id", combatSessionId)
        .order("created_at", { ascending: true })
        .limit(500),
    ]);
    const sessionRow = (session ?? null) as unknown as MythicCombatSessionRow | null;
    const combatantRows = (combatants ?? []) as unknown as MythicCombatantRow[];
    const turnRows = (turnOrder ?? []) as unknown as MythicTurnOrderRow[];
    const eventRows = (events ?? []) as unknown as MythicActionEventRow[];
    const activeTurnCombatantId = sessionRow
      ? turnRows.find((row) => row.turn_index === sessionRow.current_turn_index)?.combatant_id ?? null
      : null;
    return {
      session: sessionRow,
      combatants: combatantRows,
      turnOrder: turnRows,
      events: eventRows,
      activeTurnCombatantId,
    };
  }, []);

  const startCombat = useCallback(async (campaignId: string): Promise<MythicCombatStartResult> => {
    setIsStarting(true);
    try {
      const { result: data } = await runOperation({
        name: "combat.start",
        timeoutMs: 30_000,
        maxRetries: 0,
        onUpdate: setStartOperation,
        run: async ({ signal }) => {
          const { data, error } = await callEdgeFunction<{ ok: boolean; combat_session_id: string }>("mythic-combat-start", {
            requireAuth: true,
            signal,
            timeoutMs: 25_000,
            maxRetries: 0,
            idempotencyKey: `${campaignId}:start`,
            body: { campaignId },
          });
          if (error) throw error;
          if (!data?.ok) throw new Error("Combat start failed");
          return data;
        },
      });
      return { ok: true, combatSessionId: data.combat_session_id };
    } catch (e) {
      const parsed = parseEdgeError(e, "Failed to start combat");
      const message = parsed.message;
      const code = parsed.code;
      const requestId = parsed.requestId;
      logger.error("combat.start.failed", e, { code: code ?? undefined, requestId: requestId ?? undefined });
      return { ok: false, message, code, requestId };
    } finally {
      setIsStarting(false);
    }
  }, [loadSnapshot]);

  const useSkill = useCallback(async (args: {
    campaignId: string;
    combatSessionId: string;
    actorCombatantId: string;
    skillId: string;
    currentTurnIndex?: number;
    target:
      | { kind: "self" }
      | { kind: "combatant"; combatant_id: string }
      | { kind: "tile"; x: number; y: number };
  }) => {
    setIsActing(true);
    try {
      const { result: data } = await runOperation({
        name: "combat.use_skill",
        timeoutMs: 15_000,
        maxRetries: 1,
        onUpdate: setActionOperation,
        run: async ({ signal }) => {
          const targetSig = args.target.kind === "self"
            ? "self"
            : args.target.kind === "combatant"
              ? `c${args.target.combatant_id}`
              : `t${args.target.x},${args.target.y}`;
          const turnKey = Number.isFinite(args.currentTurnIndex)
            ? Math.max(0, Math.floor(args.currentTurnIndex ?? 0))
            : 0;
          const { data, error } = await callEdgeFunction<{ ok: boolean; ended?: boolean; next_turn_index?: number }>(
            "mythic-combat-use-skill",
            {
              requireAuth: true,
              signal,
              idempotencyKey: `${args.combatSessionId}:use:t${turnKey}:actor${args.actorCombatantId}:skill${args.skillId}:target${targetSig}`,
              body: args,
            },
          );
          if (error) throw error;
          if (!data?.ok) throw new Error("Skill failed");
          return data;
        },
      });
      const snapshot = await loadSnapshot(args.campaignId, args.combatSessionId).catch((error) => {
        logger.warn("combat.use_skill.snapshot_failed", { error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      return {
        ok: true as const,
        ended: Boolean(data.ended),
        data,
        snapshot,
        eventBatch: snapshot ? extractRecentEventBatch(snapshot.events) : [],
      };
    } catch (e) {
      const parsed = parseEdgeError(e, "Failed to use skill");
      const msg = parsed.message.toLowerCase().includes("not your turn")
        ? "Not your turn. Wait for the current turn to finish."
        : parsed.message;
      logger.error("combat.use_skill.failed", e);
      toast.error(msg);
      return { ok: false as const, error: msg };
    } finally {
      setIsActing(false);
    }
  }, []);

  const tickCombat = useCallback(async (args: {
    campaignId: string;
    combatSessionId: string;
    maxSteps?: number;
    currentTurnIndex?: number;
  }) => {
    setIsTicking(true);
    try {
      const { result: data } = await runOperation({
        name: "combat.tick",
        timeoutMs: 15_000,
        maxRetries: 1,
        onUpdate: setTickOperation,
        run: async ({ signal }) => {
          const steps = Math.max(1, Math.min(10, Math.floor(args.maxSteps ?? 1)));
          const turnKey = Number.isFinite(args.currentTurnIndex)
            ? Math.max(0, Math.floor(args.currentTurnIndex ?? 0))
            : 0;
          const { data, error } = await callEdgeFunction<{
            ok: boolean;
            ended?: boolean;
            requires_player_action?: boolean;
            current_turn_index?: number;
            next_actor_combatant_id?: string | null;
          }>(
            "mythic-combat-tick",
            {
              requireAuth: true,
              signal,
              idempotencyKey: `${args.combatSessionId}:tick:t${turnKey}:steps${steps}`,
              body: {
                campaignId: args.campaignId,
                combatSessionId: args.combatSessionId,
                maxSteps: steps,
              },
            },
          );
          if (error) throw error;
          if (!data?.ok) throw new Error("Combat tick failed");
          return data;
        },
      });
      const snapshot = await loadSnapshot(args.campaignId, args.combatSessionId).catch((error) => {
        logger.warn("combat.tick.snapshot_failed", { error: error instanceof Error ? error.message : String(error) });
        return null;
      });
      return {
        ok: true as const,
        data,
        snapshot,
        eventBatch: snapshot ? extractRecentEventBatch(snapshot.events) : [],
      };
    } catch (e) {
      const parsed = parseEdgeError(e, "Failed to advance combat");
      const msg = parsed.message;
      logger.error("combat.tick.failed", e);
      toast.error(msg);
      return { ok: false as const, error: msg };
    } finally {
      setIsTicking(false);
    }
  }, [loadSnapshot]);

  return {
    isStarting,
    startCombat,
    isActing,
    useSkill,
    isTicking,
    tickCombat,
    startOperation,
    actionOperation,
    tickOperation,
  };
}
