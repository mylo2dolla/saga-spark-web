import type { Tables } from "@/integrations/supabase/types";

export type MythicDmMood = "taunting" | "predatory" | "merciful" | "chaotic-patron";
export type MythicQuestArcState = "available" | "active" | "blocked" | "completed" | "failed";
export type MythicQuestObjectiveState = "active" | "completed" | "failed";

export type MythicBoardStateForDmRow = Tables<{ schema: "mythic" }, "v_board_state_for_dm">;
export type MythicCharacterStateForDmRow = Tables<{ schema: "mythic" }, "v_character_state_for_dm">;
export type MythicCombatStateForDmRow = Tables<{ schema: "mythic" }, "v_combat_state_for_dm">;
export type MythicDmCampaignStateRow = Tables<{ schema: "mythic" }, "dm_campaign_state">;
export type MythicDmWorldTensionRow = Tables<{ schema: "mythic" }, "dm_world_tension">;
export type MythicDmPlayerModelRow = Tables<{ schema: "mythic" }, "dm_player_model">;
export type MythicQuestArcRow = Tables<{ schema: "mythic" }, "quest_arcs">;
export type MythicQuestObjectiveRow = Tables<{ schema: "mythic" }, "quest_objectives">;
export type MythicStoryBeatRow = Tables<{ schema: "mythic" }, "story_beats">;

export type MythicQuestObjective = MythicQuestObjectiveRow;

export interface MythicQuestArc extends MythicQuestArcRow {
  objectives: MythicQuestObjective[];
}

export type MythicStoryBeat = MythicStoryBeatRow;

export interface MythicQuestOp {
  type: "upsert_arc" | "set_arc_state" | "upsert_objective" | "progress_objective";
  arc_key: string;
  title?: string;
  summary?: string;
  state?: MythicQuestArcState;
  priority?: number;
  objective_key?: string;
  objective_description?: string;
  objective_target_count?: number;
  objective_delta?: number;
  objective_state?: MythicQuestObjectiveState;
}

export interface MythicStoryBeatInput {
  beat_type?: string;
  title: string;
  narrative: string;
  emphasis?: "low" | "normal" | "high" | "critical";
  metadata?: Record<string, unknown>;
}

export interface MythicMemoryEventInput {
  category: string;
  severity?: number;
  payload?: Record<string, unknown>;
}

export interface MythicAppliedTurnResult {
  quest_arcs_updated: number;
  quest_objectives_updated: number;
  story_beats_created: number;
  dm_memory_events_created: number;
  mood_after: MythicDmMood | null;
}

export interface MythicDmTurnResponse {
  narration: string;
  suggestions: string[];
  quest_ops: MythicQuestOp[];
  story_beat: MythicStoryBeatInput | null;
  dm_deltas: Record<string, number>;
  tension_deltas: Record<string, number>;
  memory_events: MythicMemoryEventInput[];
  ui_hints: Record<string, unknown>;
  mood_before: MythicDmMood;
  mood_after: MythicDmMood;
  action_tags: string[];
  applied: MythicAppliedTurnResult | null;
}

export interface MythicDmContextPayload {
  ok: boolean;
  campaign_id: string;
  player_id: string;
  board: MythicBoardStateForDmRow | null;
  character: MythicCharacterStateForDmRow | null;
  combat: MythicCombatStateForDmRow | null;
  rules: {
    name: string;
    version: number;
    rules: Record<string, unknown>;
  } | null;
  script: {
    name: string;
    version: number;
    is_active: boolean;
    content: string;
  } | null;
  dm_campaign_state: MythicDmCampaignStateRow | null;
  dm_world_tension: MythicDmWorldTensionRow | null;
  dm_player_model: MythicDmPlayerModelRow | null;
  active_quest_arcs: MythicQuestArc[];
  recent_story_beats: MythicStoryBeat[];
  mood_summary: {
    current: MythicDmMood;
    confidence: number;
    reasons: string[];
  };
}
