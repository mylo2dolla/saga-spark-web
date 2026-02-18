import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunction } from "@/lib/edge";
import {
  claimMythicE2ECombatRewards,
  executeItemMythicE2E,
  executeSkillMythicE2E,
  isMythicE2E,
  moveMythicE2ECombat,
  startMythicE2ECombat,
} from "@/ui/e2e/mythicState";

export type MythicCombatTarget =
  | { kind: "self" }
  | { kind: "combatant"; combatant_id: string }
  | { kind: "tile"; x: number; y: number };

export interface MythicCombatSkillResult {
  ok: boolean;
  ended: boolean;
  outcome?: { alive_players: number; alive_npcs: number };
  next_turn_index?: number;
  next_actor_combatant_id?: string;
  animation_hint?: Record<string, unknown>;
  error?: string;
}

export interface MythicCombatMoveResult {
  ok: boolean;
  moved: boolean;
  waited: boolean;
  movement_budget: number;
  steps_used: number;
  path: Array<{ x: number; y: number }>;
  to: { x: number; y: number };
  next_turn_index: number;
  next_actor_combatant_id: string;
}

export interface MythicCombatRewardSummary {
  xp_gained: number;
  level_before: number;
  level_after: number;
  level_ups: number;
  xp_after: number;
  xp_to_next: number;
  loot: Array<{
    item_id: string;
    name: string;
    rarity: string;
    slot: string;
    item_power: number;
  }>;
  outcome: {
    defeated_npcs: number;
    surviving_players: number;
    surviving_npcs: number;
    player_alive: boolean;
  };
}

interface CombatRewardsResponse {
  ok: boolean;
  already_granted?: boolean;
  rewards: MythicCombatRewardSummary | null;
}

export function useMythicCombat() {
  const [isStarting, setIsStarting] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isClaimingRewards, setIsClaimingRewards] = useState(false);

  const startCombat = useCallback(async (campaignId: string) => {
    setIsStarting(true);
    try {
      if (isMythicE2E(campaignId)) {
        const data = startMythicE2ECombat(campaignId);
        if (!data.ok) throw new Error("Combat start failed");
        toast.success("Combat started");
        return data.combat_session_id;
      }

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
    target: MythicCombatTarget;
  }): Promise<MythicCombatSkillResult> => {
    setIsActing(true);
    try {
      if (isMythicE2E(args.campaignId)) {
        const data = executeSkillMythicE2E(args);
        if (!data.ok) throw new Error(data.error ?? "Skill failed");
        return {
          ok: true,
          ended: Boolean(data.ended),
          outcome: data.outcome,
          next_turn_index: data.next_turn_index,
          next_actor_combatant_id: data.next_actor_combatant_id,
          animation_hint: data.animation_hint,
        };
      }

      const { data, error } = await callEdgeFunction<{
        ok: boolean;
        ended?: boolean;
        outcome?: { alive_players: number; alive_npcs: number };
        next_turn_index?: number;
        next_actor_combatant_id?: string;
        animation_hint?: Record<string, unknown>;
      }>("mythic-combat-use-skill", {
        requireAuth: true,
        body: args,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Skill failed");
      return {
        ok: true,
        ended: Boolean(data.ended),
        outcome: data.outcome,
        next_turn_index: data.next_turn_index,
        next_actor_combatant_id: data.next_actor_combatant_id,
        animation_hint: data.animation_hint,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to use skill";
      toast.error(msg);
      return {
        ok: false,
        ended: false,
        error: msg,
      };
    } finally {
      setIsActing(false);
    }
  }, []);

  const useItem = useCallback(async (args: {
    campaignId: string;
    combatSessionId: string;
    actorCombatantId: string;
    inventoryItemId: string;
    target?: MythicCombatTarget;
  }): Promise<MythicCombatSkillResult> => {
    setIsActing(true);
    try {
      if (isMythicE2E(args.campaignId)) {
        const data = executeItemMythicE2E(args);
        if (!data.ok) throw new Error(data.error ?? "Item failed");
        return {
          ok: true,
          ended: Boolean(data.ended),
          outcome: data.outcome,
          next_turn_index: data.next_turn_index,
          next_actor_combatant_id: data.next_actor_combatant_id,
          animation_hint: data.animation_hint,
        };
      }

      const { data, error } = await callEdgeFunction<{
        ok: boolean;
        ended?: boolean;
        outcome?: { alive_players: number; alive_npcs: number };
        next_turn_index?: number;
        next_actor_combatant_id?: string;
        animation_hint?: Record<string, unknown>;
      }>("mythic-combat-use-item", {
        requireAuth: true,
        body: args,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Item failed");
      return {
        ok: true,
        ended: Boolean(data.ended),
        outcome: data.outcome,
        next_turn_index: data.next_turn_index,
        next_actor_combatant_id: data.next_actor_combatant_id,
        animation_hint: data.animation_hint,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to use item";
      toast.error(msg);
      return {
        ok: false,
        ended: false,
        error: msg,
      };
    } finally {
      setIsActing(false);
    }
  }, []);

  const moveActor = useCallback(async (args: {
    campaignId: string;
    combatSessionId: string;
    actorCombatantId: string;
    to: { x: number; y: number };
  }) => {
    setIsActing(true);
    try {
      if (isMythicE2E(args.campaignId)) {
        const data = moveMythicE2ECombat(args);
        if (!data.ok) throw new Error(data.error ?? "Move failed");
        return data;
      }

      const { data, error } = await callEdgeFunction<MythicCombatMoveResult>("mythic-combat-move", {
        requireAuth: true,
        body: args,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Move failed");
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to move";
      toast.error(msg);
      return null;
    } finally {
      setIsActing(false);
    }
  }, []);

  const waitTurn = useCallback(async (args: {
    campaignId: string;
    combatSessionId: string;
    actorCombatantId: string;
  }) => {
    setIsActing(true);
    try {
      if (isMythicE2E(args.campaignId)) {
        const data = moveMythicE2ECombat({ ...args, wait: true });
        if (!data.ok) throw new Error(data.error ?? "Wait action failed");
        return data;
      }

      const { data, error } = await callEdgeFunction<MythicCombatMoveResult>("mythic-combat-move", {
        requireAuth: true,
        body: {
          ...args,
          wait: true,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Wait action failed");
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to wait";
      toast.error(msg);
      return null;
    } finally {
      setIsActing(false);
    }
  }, []);

  const claimRewards = useCallback(async (args: { campaignId: string; combatSessionId: string }) => {
    setIsClaimingRewards(true);
    try {
      if (isMythicE2E(args.campaignId)) {
        const data = claimMythicE2ECombatRewards(args);
        if (!data.ok) throw new Error(data.error ?? "Failed to claim rewards");
        if (!data.rewards) throw new Error("No reward payload was returned");
        toast.success(data.already_granted ? "Rewards restored" : "Rewards claimed");
        return data.rewards;
      }

      const { data, error } = await callEdgeFunction<CombatRewardsResponse>("mythic-combat-rewards", {
        requireAuth: true,
        body: args,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Failed to claim rewards");
      if (!data.rewards) throw new Error("No reward payload was returned");
      toast.success(data.already_granted ? "Rewards restored" : "Rewards claimed");
      return data.rewards;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to claim rewards";
      toast.error(msg);
      return null;
    } finally {
      setIsClaimingRewards(false);
    }
  }, []);

  const isBusy = useMemo(() => isStarting || isActing || isClaimingRewards, [isActing, isClaimingRewards, isStarting]);

  return {
    isStarting,
    isActing,
    isClaimingRewards,
    isBusy,
    startCombat,
    useSkill,
    useItem,
    moveActor,
    waitTurn,
    claimRewards,
  };
}
