import type { MythicSkill } from "@/types/mythic";
import type { MythicCombatantRow } from "@/hooks/useMythicCombatState";
import type { PlayerCommandParseResult, PlayerCommandPanel } from "@/lib/mythic/playerCommandParser";
import { buildSkillAvailability, resolveSkillTarget } from "@/lib/mythic/skillAvailability";

export interface PlayerCommandResolution {
  handled: boolean;
  error?: string;
  combatStartError?: { message: string; code: string | null; requestId: string | null } | null;
  stateChanges: string[];
  narrationContext?: Record<string, unknown>;
}

interface ExecutorArgs {
  campaignId: string;
  boardType: "town" | "travel" | "dungeon" | "combat";
  command: PlayerCommandParseResult;
  skills: MythicSkill[];
  combatants: MythicCombatantRow[];
  currentTurnIndex: number;
  activeTurnCombatantId: string | null;
  playerCombatantId: string | null;
  focusedTargetCombatantId: string | null;
  transitionBoard: (
    toBoardType: "town" | "travel" | "dungeon",
    reason: string,
    payload?: Record<string, unknown>,
  ) => Promise<{ ok: boolean; data: Record<string, unknown> | null }>;
  startCombat: (
    campaignId: string,
  ) => Promise<{ ok: true; combatSessionId: string } | { ok: false; message: string; code: string | null; requestId: string | null }>;
  useSkill: (args: {
    campaignId: string;
    combatSessionId: string;
    actorCombatantId: string;
    skillId: string;
    currentTurnIndex?: number;
    target:
      | { kind: "self" }
      | { kind: "combatant"; combatant_id: string }
      | { kind: "tile"; x: number; y: number };
  }) => Promise<{ ok: true; ended: boolean } | { ok: false; error: string }>;
  combatSessionId: string | null;
  refetchBoard: () => Promise<void>;
  refetchCombat: () => Promise<void>;
  refetchCharacter: () => Promise<void>;
  openMenu: (panel: PlayerCommandPanel) => void;
}

function narrativeBase(args: ExecutorArgs): Record<string, unknown> {
  return {
    command: args.command.cleaned,
    intent: args.command.intent,
    mode: args.boardType,
    board_type: args.boardType,
    explicit_command: args.command.explicit,
  };
}

export async function executePlayerCommand(args: ExecutorArgs): Promise<PlayerCommandResolution> {
  const result: PlayerCommandResolution = {
    handled: false,
    stateChanges: [],
  };
  const command = args.command;

  if (command.intent === "unknown") {
    return result;
  }

  if (command.intent === "open_menu") {
    args.openMenu(command.panel ?? "character");
    result.handled = true;
    result.stateChanges.push(`Opened ${command.panel ?? "character"} panel.`);
    result.narrationContext = {
      ...narrativeBase(args),
      state_changes: result.stateChanges,
      menu_panel: command.panel ?? "character",
    };
    return result;
  }

  if (command.intent === "skills_list") {
    const skills = buildSkillAvailability({
      skills: args.skills,
      combatants: args.combatants,
      playerCombatantId: args.playerCombatantId,
      activeTurnCombatantId: args.activeTurnCombatantId,
      currentTurnIndex: args.currentTurnIndex,
    });
    result.handled = true;
    result.stateChanges.push(`Reported ${skills.length} combat skills with live availability.`);
    result.narrationContext = {
      ...narrativeBase(args),
      state_changes: result.stateChanges,
      available_skills: skills,
    };
    return result;
  }

  if (command.intent === "status_check") {
    const player = args.playerCombatantId
      ? args.combatants.find((entry) => entry.id === args.playerCombatantId) ?? null
      : null;
    result.handled = true;
    result.stateChanges.push("Status check requested.");
    result.narrationContext = {
      ...narrativeBase(args),
      state_changes: result.stateChanges,
      player_status: player
        ? {
            hp: Math.floor(player.hp),
            hp_max: Math.floor(player.hp_max),
            power: Math.floor(player.power),
            power_max: Math.floor(player.power_max),
            armor: Math.floor(player.armor),
            resist: Math.floor(player.resist),
            statuses: player.statuses,
          }
        : null,
    };
    return result;
  }

  if (command.intent === "town" || command.intent === "travel" || command.intent === "dungeon" || command.intent === "shop") {
    const target =
      command.intent === "shop"
        ? "town"
        : command.intent === "town" || command.intent === "travel" || command.intent === "dungeon"
          ? command.intent
          : "town";
    const transitionPayload: Record<string, unknown> = {};
    if (command.intent === "travel") {
      transitionPayload.travel_goal = command.travelGoal ?? (command.searchTarget === "dungeon" ? "find_dungeon" : "explore_wilds");
      transitionPayload.search_target = command.searchTarget ?? null;
      if (command.probeKind) transitionPayload.travel_probe = command.probeKind;
      if (command.searchTarget === "dungeon") {
        transitionPayload.discovery_flags = { searching_for_dungeon: true };
      }
    } else if (command.intent === "dungeon") {
      transitionPayload.travel_goal = command.travelGoal ?? "enter_dungeon";
      transitionPayload.search_target = command.searchTarget ?? "dungeon";
      transitionPayload.discovery_flags = { entered_dungeon: true };
    } else if (target === "town") {
      transitionPayload.travel_goal = "return_town";
      if (command.intent === "shop") transitionPayload.discovery_flags = { shopping: true };
    }

    if (args.boardType !== target) {
      const transition = await args.transitionBoard(target, `command:${command.intent}`, transitionPayload);
      if (!transition.ok) {
        return {
          handled: true,
          error: `Failed to transition mode to ${target}.`,
          stateChanges: result.stateChanges,
          narrationContext: {
            ...narrativeBase(args),
            state_changes: result.stateChanges,
            mode_target: target,
            board_target: target,
            transition_payload: transitionPayload,
            transition_failed: true,
          },
        };
      }
      await Promise.all([args.refetchBoard(), args.refetchCombat()]);
      result.stateChanges.push(`Transitioned mode to ${target}.`);
    } else {
      result.stateChanges.push(`Already in ${target} mode.`);
    }
    result.handled = true;
    result.narrationContext = {
      ...narrativeBase(args),
      state_changes: result.stateChanges,
      mode_target: target,
      board_target: target,
      transition_payload: transitionPayload,
    };
    return result;
  }

  if (command.intent === "combat_start") {
    if (args.boardType !== "combat") {
      const started = await args.startCombat(args.campaignId);
      if (started.ok === false) {
        return {
          handled: true,
          error: started.message || "Combat session failed to start.",
          combatStartError: {
            message: started.message || "Combat session failed to start.",
            code: started.code ?? null,
            requestId: started.requestId ?? null,
          },
          stateChanges: result.stateChanges,
          narrationContext: {
            ...narrativeBase(args),
            state_changes: result.stateChanges,
            start_combat_failed: true,
            error_code: started.code ?? null,
            request_id: started.requestId ?? null,
          },
        };
      }
      await Promise.all([args.refetchBoard(), args.refetchCombat()]);
      result.stateChanges.push("Combat session started.");
    } else {
      result.stateChanges.push("Combat already active.");
    }
    result.handled = true;
    result.narrationContext = {
      ...narrativeBase(args),
      state_changes: result.stateChanges,
    };
    return result;
  }

  if (command.intent === "loot" || command.intent === "steal") {
    if (args.boardType === "travel") {
      const probe = command.intent === "steal" ? "steal" : command.probeKind ?? "loot";
      const payload = {
        travel_probe: probe,
        travel_goal: command.travelGoal ?? "explore_wilds",
        search_target: command.searchTarget ?? null,
        discovery_flags: {
          explicit_probe: true,
          probe,
        },
        from_chat: true,
      };
      const transition = await args.transitionBoard("travel", `command:${probe}`, {
        ...payload,
      });
      if (!transition.ok) {
        return {
          handled: true,
          error: `Travel probe failed (${probe}).`,
          stateChanges: result.stateChanges,
          narrationContext: {
            ...narrativeBase(args),
            state_changes: result.stateChanges,
            probe,
            transition_failed: true,
          },
        };
      }
      await Promise.all([args.refetchBoard(), args.refetchCombat()]);
      result.stateChanges.push(`Travel probe rolled (${probe}).`);
    } else {
      result.stateChanges.push(`${command.intent === "steal" ? "Steal attempt" : "Loot check"} queued for narration on current board.`);
    }
    result.handled = true;
    result.narrationContext = {
      ...narrativeBase(args),
      state_changes: result.stateChanges,
      probe: command.intent === "steal" ? "steal" : command.probeKind ?? "loot",
      search_target: command.searchTarget ?? null,
      travel_goal: command.travelGoal ?? null,
    };
    return result;
  }

  if (command.intent === "use_skill") {
    if (!args.combatSessionId) {
      return {
        handled: true,
        error: "No active combat session.",
        stateChanges: result.stateChanges,
        narrationContext: {
          ...narrativeBase(args),
          state_changes: result.stateChanges,
          use_skill_error: "no_active_combat_session",
        },
      };
    }
    if (!args.playerCombatantId) {
      return {
        handled: true,
        error: "Player combatant not found in session.",
        stateChanges: result.stateChanges,
        narrationContext: {
          ...narrativeBase(args),
          state_changes: result.stateChanges,
          use_skill_error: "player_combatant_missing",
        },
      };
    }
    if (!command.skillQuery) {
      return {
        handled: true,
        error: "Skill command requires a skill name.",
        stateChanges: result.stateChanges,
        narrationContext: {
          ...narrativeBase(args),
          state_changes: result.stateChanges,
          use_skill_error: "skill_name_missing",
        },
      };
    }

    const resolved = resolveSkillTarget({
      skills: args.skills,
      combatants: args.combatants,
      playerCombatantId: args.playerCombatantId,
      activeTurnCombatantId: args.activeTurnCombatantId,
      currentTurnIndex: args.currentTurnIndex,
      skillQuery: command.skillQuery,
      targetQuery: command.targetQuery,
      focusedTargetCombatantId: args.focusedTargetCombatantId,
    });
    if (resolved.ok === false) {
      const resolveError = resolved.error;
      return {
        handled: true,
        error: resolveError,
        stateChanges: result.stateChanges,
        narrationContext: {
          ...narrativeBase(args),
          state_changes: result.stateChanges,
          use_skill_error: resolveError,
          requested_skill: command.skillQuery,
          requested_target: command.targetQuery ?? null,
        },
      };
    }

    const skillResult = await args.useSkill({
      campaignId: args.campaignId,
      combatSessionId: args.combatSessionId,
      actorCombatantId: args.playerCombatantId,
      skillId: resolved.value.skill.id as string,
      currentTurnIndex: args.currentTurnIndex,
      target: resolved.value.target,
    });
    if (skillResult.ok === false) {
      const skillError = skillResult.error;
      return {
        handled: true,
        error: skillError,
        stateChanges: result.stateChanges,
        narrationContext: {
          ...narrativeBase(args),
          state_changes: result.stateChanges,
          use_skill_error: skillError,
          skill_id: resolved.value.skill.id,
        },
      };
    }

    const refreshTasks: Array<Promise<unknown>> = [args.refetchBoard(), args.refetchCombat()];
    if (skillResult.ended) {
      refreshTasks.push(args.refetchCharacter());
    }
    await Promise.all(refreshTasks);
    result.handled = true;
    result.stateChanges.push(`Used ${resolved.value.skill.name}.`);
    result.narrationContext = {
      ...narrativeBase(args),
      state_changes: result.stateChanges,
      skill_used: {
        id: resolved.value.skill.id,
        name: resolved.value.skill.name,
        target_combatant_id: resolved.value.targetCombatantId ?? null,
      },
    };
    return result;
  }

  return result;
}
