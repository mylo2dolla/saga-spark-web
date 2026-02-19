import { useCallback, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunction } from "@/lib/edge";
import { parseEdgeError } from "@/lib/edgeError";
import { runOperation } from "@/lib/ops/runOperation";
import type { OperationState } from "@/lib/ops/operationState";
import { createLogger } from "@/lib/observability/logger";

const logger = createLogger("mythic-combat-hook");

export type MythicCombatStartResult =
  | { ok: true; combatSessionId: string }
  | { ok: false; message: string; code: string | null; requestId: string | null };

export function useMythicCombat() {
  const [isStarting, setIsStarting] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isTicking, setIsTicking] = useState(false);
  const [startOperation, setStartOperation] = useState<OperationState | null>(null);
  const [actionOperation, setActionOperation] = useState<OperationState | null>(null);
  const [tickOperation, setTickOperation] = useState<OperationState | null>(null);

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
  }, []);

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
