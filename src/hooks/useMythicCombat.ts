import { useCallback, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunction } from "@/lib/edge";
import { runOperation } from "@/lib/ops/runOperation";
import type { OperationState } from "@/lib/ops/operationState";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("mythic-combat-hook");

export function useMythicCombat() {
  const [isStarting, setIsStarting] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isTicking, setIsTicking] = useState(false);
  const [startOperation, setStartOperation] = useState<OperationState | null>(null);
  const [actionOperation, setActionOperation] = useState<OperationState | null>(null);
  const [tickOperation, setTickOperation] = useState<OperationState | null>(null);

  const startCombat = useCallback(async (campaignId: string) => {
    setIsStarting(true);
    try {
      const { result: data } = await runOperation({
        name: "combat.start",
        // Combat start can legitimately take longer (DB writes + board transition).
        timeoutMs: 25_000,
        // Never retry combat start automatically; it risks creating duplicate sessions.
        maxRetries: 0,
        onUpdate: setStartOperation,
        run: async ({ signal }) => {
          const { data, error } = await callEdgeFunction<{ ok: boolean; combat_session_id: string }>("mythic-combat-start", {
            requireAuth: true,
            signal,
            idempotencyKey: `${campaignId}:start`,
            body: { campaignId },
          });
          if (error) throw error;
          if (!data?.ok) throw new Error("Combat start failed");
          return data;
        },
      });
      toast.success("Combat started");
      return data.combat_session_id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start combat";
      logger.error("combat.start.failed", e);
      toast.error(msg);
      return null;
    } finally {
      setIsStarting(false);
    }
  }, []);

  const useSkill = useCallback(async (args: {
    campaignId: string;
    combatSessionId: string;
    actorCombatantId: string;
    skillId: string;
    turnIndex?: number;
    target:
      | { kind: "self" }
      | { kind: "combatant"; combatant_id: string }
      | { kind: "tile"; x: number; y: number };
  }) => {
    setIsActing(true);
    try {
      const compactTarget = (() => {
        if (args.target.kind === "self") return "self";
        if (args.target.kind === "combatant") return `c:${args.target.combatant_id}`;
        return `t:${args.target.x},${args.target.y}`;
      })();
      const { turnIndex, ...body } = args;
      const { result: data } = await runOperation({
        name: "combat.use_skill",
        timeoutMs: 15_000,
        maxRetries: 1,
        onUpdate: setActionOperation,
        run: async ({ signal }) => {
          const { data, error } = await callEdgeFunction<{ ok: boolean; ended?: boolean; next_turn_index?: number }>(
            "mythic-combat-use-skill",
            {
              requireAuth: true,
              signal,
              // Include turn index to prevent duplicate casts under fast taps / replays.
              idempotencyKey: `${args.combatSessionId}:use:t${Number.isFinite(turnIndex) ? turnIndex : "?"}:a${args.actorCombatantId}:s${args.skillId}:${compactTarget}`,
              body,
            },
          );
          if (error) throw error;
          if (!data?.ok) throw new Error("Skill failed");
          return data;
        },
      });
      return { ok: true as const, ended: Boolean(data.ended) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to use skill";
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
      const steps = Math.max(1, Math.min(10, Math.floor(args.maxSteps ?? 1)));
      const compactTurn = Number.isFinite(args.currentTurnIndex) ? Math.floor(args.currentTurnIndex as number) : null;
      const { result: data } = await runOperation({
        name: "combat.tick",
        timeoutMs: 15_000,
        maxRetries: 1,
        onUpdate: setTickOperation,
        run: async ({ signal }) => {
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
              // Include current turn index to prevent duplicate ticks under fast UI retries.
              idempotencyKey: `${args.combatSessionId}:tick:t${compactTurn ?? "?"}:steps${steps}`,
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
      return { ok: true as const, data };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to advance combat";
      logger.error("combat.tick.failed", e);
      toast.error(msg);
      return { ok: false as const, error: msg };
    } finally {
      setIsTicking(false);
    }
  }, []);

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
