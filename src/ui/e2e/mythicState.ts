import type { MythicBoardRow, MythicBoardTransitionRow } from "@/hooks/useMythicBoard";
import type { MythicCharacterBundle, MythicCharacterRow, MythicInventoryRow, MythicSkillRow } from "@/types/mythic";
import type { Json } from "@/integrations/supabase/types";
import type {
  MythicDmContextPayload,
  MythicDmTurnResponse,
  MythicQuestArc,
  MythicQuestObjective,
  MythicStoryBeat,
} from "@/types/mythicDm";

type E2EMood = "taunting" | "predatory" | "merciful" | "chaotic-patron";

interface MythicE2ECampaignState {
  board: MythicBoardRow;
  transitions: MythicBoardTransitionRow[];
  characterBundle: MythicCharacterBundle;
  questArcs: MythicQuestArc[];
  storyBeats: MythicStoryBeat[];
  mood: E2EMood;
  turnCounter: number;
}

declare global {
  var __MYTHIC_E2E_STATE__: Record<string, MythicE2ECampaignState> | undefined;
}

const nowIso = () => new Date().toISOString();

const defaultSkillRows = (campaignId: string, characterId: string): MythicSkillRow[] => ([
  {
    id: "e2e-skill-1",
    campaign_id: campaignId,
    character_id: characterId,
    cooldown_turns: 1,
    cost_json: {},
    counterplay: {},
    created_at: nowIso(),
    description: "Test strike with aggressive momentum.",
    effects_json: {},
    kind: "active",
    name: "Momentum Slash",
    narration_style: "brutal",
    range_tiles: 1,
    scaling_json: {},
    targeting: "single",
    targeting_json: {},
    updated_at: nowIso(),
  },
  {
    id: "e2e-skill-2",
    campaign_id: campaignId,
    character_id: characterId,
    cooldown_turns: 2,
    cost_json: {},
    counterplay: {},
    created_at: nowIso(),
    description: "Hold your line and punish overreach.",
    effects_json: {},
    kind: "active",
    name: "Iron Stance",
    narration_style: "stoic",
    range_tiles: 0,
    scaling_json: {},
    targeting: "self",
    targeting_json: {},
    updated_at: nowIso(),
  },
]);

const defaultInventoryRows = (campaignId: string): MythicInventoryRow[] => ([
  {
    id: "e2e-inv-1",
    container: "equipment",
    equip_slot: "weapon",
    quantity: 1,
    equipped_at: nowIso(),
    item: {
      id: "e2e-item-1",
      affixes: {},
      bind_policy: "character",
      campaign_id: campaignId,
      created_at: nowIso(),
      drawback_json: {},
      drop_tier: "common",
      durability_json: {},
      effects_json: {},
      item_power: 8,
      item_type: "weapon",
      name: "Test Cleaver",
      narrative_hook: null,
      owner_character_id: null,
      rarity: "common",
      required_level: 1,
      set_tag: null,
      slot: "weapon",
      stat_mods: { offense: 3, defense: 1 },
      updated_at: nowIso(),
      weapon_family: "blades",
      weapon_profile: {},
    },
  },
]);

const buildDefaultState = (campaignId: string): MythicE2ECampaignState => {
  const characterId = "e2e-character-1";
  const character: MythicCharacterRow = {
    id: characterId,
    campaign_id: campaignId,
    player_id: "e2e-user",
    name: "E2E Vanguard",
    level: 3,
    offense: 12,
    defense: 11,
    control: 8,
    support: 7,
    mobility: 10,
    utility: 9,
    class_json: { class_name: "Edgebreaker" },
    derived_json: {},
    progression_json: {},
    resources: {},
    last_level_up_at: null,
    unspent_points: 0,
    xp: 250,
    xp_to_next: 500,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  return {
    board: {
      id: "e2e-board-1",
      campaign_id: campaignId,
      board_type: "town",
      status: "active",
      state_json: {
        vendors: ["smith", "broker"],
        services: ["rest", "trade"],
        factions_present: ["Iron Court"],
        rumors: ["A bounty was posted at dusk."],
      },
      ui_hints_json: {},
      active_scene_id: null,
      combat_session_id: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    transitions: [],
    characterBundle: {
      character,
      skills: defaultSkillRows(campaignId, characterId),
      items: defaultInventoryRows(campaignId),
    },
    questArcs: [],
    storyBeats: [],
    mood: "taunting",
    turnCounter: 0,
  };
};

export function isMythicE2E(campaignId: string | undefined): campaignId is string {
  if (!campaignId) return false;
  if (import.meta.env.VITE_E2E_BYPASS_AUTH !== "true") return false;
  return campaignId.startsWith("e2e");
}

function getStore() {
  if (!globalThis.__MYTHIC_E2E_STATE__) {
    globalThis.__MYTHIC_E2E_STATE__ = {};
  }
  return globalThis.__MYTHIC_E2E_STATE__;
}

export function getMythicE2EState(campaignId: string): MythicE2ECampaignState {
  const store = getStore();
  if (!store[campaignId]) {
    store[campaignId] = buildDefaultState(campaignId);
  }
  return store[campaignId];
}

export function getMythicE2EBoard(campaignId: string): {
  board: MythicBoardRow;
  transitions: MythicBoardTransitionRow[];
} {
  const state = getMythicE2EState(campaignId);
  return {
    board: state.board,
    transitions: state.transitions,
  };
}

export function getMythicE2ECharacterBundle(campaignId: string): MythicCharacterBundle {
  return getMythicE2EState(campaignId).characterBundle;
}

export function getMythicE2EQuestArcs(campaignId: string): MythicQuestArc[] {
  return getMythicE2EState(campaignId).questArcs.map((arc) => ({
    ...arc,
    objectives: arc.objectives.map((objective) => ({ ...objective })),
  }));
}

export function getMythicE2EStoryBeats(campaignId: string): MythicStoryBeat[] {
  return getMythicE2EState(campaignId).storyBeats.map((beat) => ({ ...beat }));
}

export function getMythicE2EDmContext(campaignId: string): MythicDmContextPayload {
  const state = getMythicE2EState(campaignId);
  return {
    ok: true,
    campaign_id: campaignId,
    player_id: "e2e-user",
    board: {
      campaign_id: campaignId,
      board_id: state.board.id,
      board_type: state.board.board_type,
      status: state.board.status,
      state_json: state.board.state_json,
      ui_hints_json: state.board.ui_hints_json,
      active_scene_id: state.board.active_scene_id,
      combat_session_id: state.board.combat_session_id,
      recent_transitions: state.transitions,
      updated_at: state.board.updated_at,
    },
    character: {
      campaign_id: campaignId,
      character_id: state.characterBundle.character.id,
      player_id: state.characterBundle.character.player_id,
      class_json: state.characterBundle.character.class_json,
      name: state.characterBundle.character.name,
      level: state.characterBundle.character.level,
      resources: state.characterBundle.character.resources,
      updated_at: state.characterBundle.character.updated_at,
      base_stats: {
        offense: state.characterBundle.character.offense,
        defense: state.characterBundle.character.defense,
        control: state.characterBundle.character.control,
        support: state.characterBundle.character.support,
        mobility: state.characterBundle.character.mobility,
        utility: state.characterBundle.character.utility,
      },
      derived_json: state.characterBundle.character.derived_json,
      items: state.characterBundle.items,
      skills: state.characterBundle.skills,
    },
    combat: null,
    rules: {
      name: "mythic-weave-rules-v1",
      version: 1,
      rules: {},
    },
    script: {
      name: "mythic-weave-core",
      version: 1,
      is_active: true,
      content: "E2E deterministic script",
    },
    dm_campaign_state: {
      campaign_id: campaignId,
      cruelty: 0.6,
      honesty: 0.4,
      playfulness: 0.7,
      intervention: 0.5,
      favoritism: 0.4,
      irritation: 0.5,
      amusement: 0.6,
      menace: 0.6,
      respect: 0.4,
      boredom: 0.2,
      updated_at: nowIso(),
    },
    dm_world_tension: {
      campaign_id: campaignId,
      tension: 0.4,
      doom: 0.2,
      spectacle: 0.5,
      updated_at: nowIso(),
    },
    dm_player_model: {
      campaign_id: campaignId,
      player_id: "e2e-user",
      cruelty_score: 35,
      heroism_score: 22,
      cunning_score: 41,
      chaos_score: 38,
      honor_score: 19,
      greed_score: 26,
      boredom_signals: 0,
      exploit_signals: 0,
      preferred_tactics: {},
      updated_at: nowIso(),
    },
    active_quest_arcs: state.questArcs,
    recent_story_beats: state.storyBeats,
    mood_summary: {
      current: state.mood,
      confidence: 0.76,
      reasons: ["E2E deterministic mood profile"],
    },
  };
}

function upsertArc(state: MythicE2ECampaignState, arcKey: string, title?: string, summary?: string, nextState?: MythicQuestArc["state"]) {
  const found = state.questArcs.find((arc) => arc.arc_key === arcKey);
  if (found) {
    found.title = title ?? found.title;
    found.summary = summary ?? found.summary;
    found.state = nextState ?? found.state;
    found.updated_at = nowIso();
    return found;
  }
  const created: MythicQuestArc = {
    id: crypto.randomUUID(),
    campaign_id: state.board.campaign_id,
    arc_key: arcKey,
    title: title ?? "Unnamed Arc",
    summary: summary ?? "",
    state: nextState ?? "active",
    priority: 3,
    source: "dm",
    created_at: nowIso(),
    updated_at: nowIso(),
    objectives: [],
  };
  state.questArcs.unshift(created);
  return created;
}

function upsertObjective(arc: MythicQuestArc, objectiveKey: string, description?: string, targetCount = 1, objectiveState: MythicQuestObjective["state"] = "active") {
  const found = arc.objectives.find((objective) => objective.objective_key === objectiveKey);
  if (found) {
    found.description = description ?? found.description;
    found.target_count = targetCount;
    found.state = objectiveState;
    found.updated_at = nowIso();
    return found;
  }
  const created: MythicQuestObjective = {
    id: crypto.randomUUID(),
    campaign_id: arc.campaign_id,
    arc_id: arc.id,
    objective_key: objectiveKey,
    description: description ?? objectiveKey,
    target_count: targetCount,
    current_count: 0,
    state: objectiveState,
    sort_order: arc.objectives.length,
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  arc.objectives.push(created);
  return created;
}

export function applyMythicE2ETurn(campaignId: string, turn: MythicDmTurnResponse, actionText: string) {
  const state = getMythicE2EState(campaignId);
  state.turnCounter += 1;
  state.mood = turn.mood_after;

  for (const op of turn.quest_ops) {
    const arc = upsertArc(state, op.arc_key, op.title, op.summary, op.state ?? "active");
    if (op.type === "set_arc_state" && op.state) {
      arc.state = op.state;
      arc.updated_at = nowIso();
      continue;
    }

    if (op.type === "upsert_objective" && op.objective_key) {
      upsertObjective(
        arc,
        op.objective_key,
        op.objective_description,
        op.objective_target_count ?? 1,
        op.objective_state ?? "active",
      );
      arc.updated_at = nowIso();
      continue;
    }

    if (op.type === "progress_objective" && op.objective_key) {
      const existing = arc.objectives.find((objective) => objective.objective_key === op.objective_key);
      const objective = existing ?? upsertObjective(
        arc,
        op.objective_key,
        op.objective_description,
        op.objective_target_count ?? 1,
        op.objective_state ?? "active",
      );
      if (op.objective_target_count && op.objective_target_count > 0) {
        objective.target_count = op.objective_target_count;
      }
      if (op.type === "progress_objective") {
        objective.current_count = Math.min(objective.target_count, Math.max(0, objective.current_count + (op.objective_delta ?? 1)));
        if (objective.current_count >= objective.target_count) {
          objective.state = "completed";
        }
        objective.updated_at = nowIso();
      }
      arc.updated_at = nowIso();
    }
  }

  if (turn.story_beat) {
    state.storyBeats.unshift({
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      beat_type: turn.story_beat.beat_type ?? "dm_turn",
      title: turn.story_beat.title,
      narrative: turn.story_beat.narrative,
      emphasis: turn.story_beat.emphasis ?? "normal",
      metadata: (turn.story_beat.metadata ?? {}) as Json,
      created_by: "dm",
      created_at: nowIso(),
    });
  } else {
    state.storyBeats.unshift({
      id: crypto.randomUUID(),
      campaign_id: campaignId,
      beat_type: "dm_turn",
      title: `Turn ${state.turnCounter}`,
      narrative: `${turn.narration} (action: ${actionText})`,
      emphasis: "normal",
      metadata: {},
      created_by: "dm",
      created_at: nowIso(),
    });
  }
}
