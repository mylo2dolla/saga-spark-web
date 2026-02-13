import { useCallback, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunction } from "@/lib/edge";

export function useMythicCombat() {
  const [isStarting, setIsStarting] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isTicking, setIsTicking] = useState(false);

  const startCombat = useCallback(async (campaignId: string) => {
    setIsStarting(true);
    try {
      const { data, error } = await callEdgeFunction<{ ok: boolean; combat_session_id: string }>("mythic-combat-start", {
        requireAuth: true,
        body: { campaignId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Combat start failed");
      toast.success("Combat started");
      return data.combat_session_id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start combat";
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
    target:
      | { kind: "self" }
      | { kind: "combatant"; combatant_id: string }
      | { kind: "tile"; x: number; y: number };
  }) => {
    setIsActing(true);
    try {
      const { data, error } = await callEdgeFunction<{ ok: boolean; ended?: boolean; next_turn_index?: number }>(
        "mythic-combat-use-skill",
        {
          requireAuth: true,
          body: args,
        },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error("Skill failed");
      return { ok: true as const, ended: Boolean(data.ended) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to use skill";
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
  }) => {
    setIsTicking(true);
    try {
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
          body: {
            campaignId: args.campaignId,
            combatSessionId: args.combatSessionId,
            maxSteps: Math.max(1, Math.min(10, Math.floor(args.maxSteps ?? 1))),
          },
        },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error("Combat tick failed");
      return { ok: true as const, data };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to advance combat";
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
  };
}
