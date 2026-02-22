export type MythicBoardType = "town" | "dungeon" | "travel" | "combat";

export interface MythicCompanionCheckin {
  companion_id: string;
  line: string;
  mood: string;
  urgency: string;
  hook_type: string;
  turn_index?: number;
}

export type MythicUiIntent =
  | "quest_action"
  | "town"
  | "travel"
  | "dungeon"
  | "combat_start"
  | "combat_action"
  | "shop_action"
  | "companion_action"
  | "shop"
  | "focus_target"
  | "open_panel"
  | "dm_prompt"
  | "refresh";

export interface MythicActionChip {
  id: string;
  label: string;
  intent: MythicUiIntent;
  hint_key?: string;
  prompt?: string;
  boardTarget?: "town" | "travel" | "dungeon" | "combat";
  panel?: "status" | "character" | "equipment" | "skills" | "progression" | "quests" | "combat" | "companions" | "shop" | "commands" | "settings";
  payload?: Record<string, unknown>;
  companion_id?: string;
  turn_index?: number;
  resolved?: boolean;
}

export interface MythicBoardTransitionPayload {
  reason_code?: string;
  reason_label?: string;
  travel_goal?: string | null;
  search_target?: string | null;
  discovery_flags?: Record<string, unknown>;
  companion_command?: {
    companion_id: string;
    stance: "aggressive" | "balanced" | "defensive";
    directive: "focus" | "protect" | "harry" | "hold";
    target_hint?: string | null;
  };
  [key: string]: unknown;
}

export interface MythicDiscoveryFlags {
  intro_pending?: boolean;
  intro_version?: number;
  intro_seeded_at?: string;
  intro_source?: "create_campaign" | "join_campaign" | "bootstrap" | "migration";
  intro_opening_requested_at?: string;
  intro_opening_failed_at?: string;
  [key: string]: unknown;
}

export interface MythicBoardState {
  combat_resolution?: MythicCombatResolutionState | null;
  scene_cache?: Record<string, unknown>;
  companion_checkins?: MythicCompanionCheckin[];
  companion_presence?: Array<Record<string, unknown>>;
  action_chips?: MythicActionChip[];
  job_postings?: Array<Record<string, unknown>>;
  room_state?: Record<string, unknown>;
  discovery_flags?: MythicDiscoveryFlags;
  town_npcs?: Array<Record<string, unknown>>;
  town_relationships?: Record<string, unknown>;
  town_grudges?: Record<string, unknown>;
  town_activity_log?: Array<Record<string, unknown> | string>;
  town_clock?: Record<string, unknown>;
  reason_code?: string;
  rumors?: unknown[];
  objectives?: unknown[];
  discovery_log?: unknown[];
  [key: string]: unknown;
}

export interface MythicCombatResolutionState {
  pending: boolean;
  combat_session_id: string;
  return_mode: MythicBoardType;
  won: boolean;
  xp_gained: number;
  loot: string[];
  ended_at?: string | null;
}

export interface MythicStoryRewardSummary {
  applied: boolean;
  turn_id?: string | null;
  character_id?: string | null;
  xp_awarded?: number;
  loot_item_id?: string | null;
  loot_item_name?: string | null;
  reason?: string | null;
}

export interface MythicDmResponseMeta {
  turn_id?: string | null;
  turn_index?: number | null;
  turn_seed?: string | null;
  world_time?: string | null;
  heat?: number | null;
  dm_validation_attempts?: number;
  dm_recovery_used?: boolean;
  dm_recovery_reason?: string | null;
  reward_summary?: MythicStoryRewardSummary;
  [key: string]: unknown;
}

export interface MythicDmContextBoardPayload {
  campaign_id: string | null;
  board_id: string | null;
  board_type: MythicBoardType | string | null;
  status: string | null;
  state_summary: Record<string, unknown> | null;
  ui_hints_json: Record<string, unknown> | null;
  active_scene_id: string | null;
  combat_session_id: string | null;
  updated_at: string | null;
  recent_transitions: Array<Record<string, unknown>> | null;
  [key: string]: unknown;
}

export interface MythicDmContextCharacterPayload {
  character_id: string | null;
  campaign_id: string | null;
  player_id: string | null;
  name: string | null;
  level: number | null;
  updated_at: string | null;
  base_stats: Record<string, unknown> | null;
  resources: Record<string, unknown> | null;
  derived: Record<string, unknown> | null;
  class_json: Record<string, unknown> | null;
  skills: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface MythicDmContextCombatPayload {
  combat_session_id: string | null;
  campaign_id: string | null;
  status: string | null;
  seed: number | null;
  current_turn_index: number | null;
  scene_json: Record<string, unknown> | null;
  dm_payload: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface MythicDmContextResponse {
  ok: boolean;
  campaign_id: string;
  player_id: string | null;
  board: MythicDmContextBoardPayload | null;
  character: MythicDmContextCharacterPayload | null;
  combat: MythicDmContextCombatPayload | null;
  rules: Record<string, unknown> | null;
  script: Record<string, unknown> | null;
  dm_campaign_state: Record<string, unknown> | null;
  dm_world_tension: Record<string, unknown> | null;
  companions?: Array<Record<string, unknown>>;
  timings_ms?: {
    total?: number;
  };
  warnings: string[];
  requestId?: string;
  [key: string]: unknown;
}

export type MythicRarity = "common" | "magical" | "unique" | "legendary" | "mythic" | "unhinged";

export type MythicWeaponFamily =
  | "blades"
  | "axes"
  | "blunt"
  | "polearms"
  | "ranged"
  | "focus"
  | "body"
  | "absurd";

export type MythicSkillKind = "active" | "passive" | "ultimate" | "crafting" | "life";
export type MythicSkillTargeting = "self" | "single" | "tile" | "area";

export interface MythicBaseStats {
  offense: number;
  defense: number;
  control: number;
  support: number;
  mobility: number;
  utility: number;
}

export interface MythicTargetingJson {
  shape?: "self" | "single" | "tile" | "area" | "cone" | "line";
  metric?: "manhattan" | "chebyshev" | "euclidean";
  radius?: number;
  length?: number;
  width?: number;
  friendly_fire?: boolean;
  requires_los?: boolean;
  blocks_on_walls?: boolean;
  [k: string]: unknown;
}

export interface MythicSkill {
  id?: string;
  kind: MythicSkillKind;
  targeting: MythicSkillTargeting;
  targeting_json: MythicTargetingJson;
  name: string;
  description: string;
  range_tiles: number;
  cooldown_turns: number;
  cost_json: Record<string, unknown>;
  effects_json: Record<string, unknown>;
  scaling_json: Record<string, unknown>;
  counterplay: Record<string, unknown>;
  narration_style: string;
}

export interface MythicCharacterRow {
  id: string;
  campaign_id: string;
  player_id: string | null;
  name: string;
  level: number;
  xp: number;
  xp_to_next: number;
  unspent_points: number;
  offense: number;
  defense: number;
  control: number;
  support: number;
  mobility: number;
  utility: number;
  class_json: Record<string, unknown>;
  derived_json: Record<string, unknown>;
  progression_json: Record<string, unknown>;
  resources: Record<string, unknown>;
  last_level_up_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MythicCharacterProfile {
  callsign?: string;
  pronouns?: string;
  origin_note?: string;
}

export interface MythicVoicePreference {
  dm_voice: "alloy" | "verse" | "nova" | "aria";
}

export interface MythicCharacterClassJson extends Record<string, unknown> {
  class_name?: string;
  role?: string;
  profile?: MythicCharacterProfile;
}

export interface MythicProgressionEventRow {
  id: string;
  campaign_id: string;
  character_id: string;
  event_type: "xp_applied" | "level_up" | "points_spent" | "gear_progression" | string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MythicQuestThreadRow {
  id: string;
  source: "dm_memory" | "runtime_transition" | "board_transition" | "progression" | "loot_drop" | "reputation";
  event_type: string;
  title: string;
  detail: string;
  severity: number;
  created_at: string;
}

export interface MythicCharacterBundle {
  character: MythicCharacterRow;
  skills: MythicSkill[];
  items: Array<Record<string, unknown>>;
  progressionEvents: MythicProgressionEventRow[];
  questThreads: MythicQuestThreadRow[];
}

export interface MythicCreateCharacterRequest {
  campaignId: string;
  characterName: string;
  classDescription: string;
  seed?: number;
}

export interface MythicCreateCharacterResponse {
  character_id: string;
  seed: number;
  class: {
    class_name: string;
    class_description: string;
    role: "tank" | "dps" | "support" | "controller" | "skirmisher" | "hybrid";
    weapon_identity: { family: MythicWeaponFamily; notes?: string };
    weakness: { id: string; description: string; counterplay: string };
    base_stats: MythicBaseStats;
    resources: Record<string, unknown>;
  };
  skills: MythicSkill[];
  skill_ids: string[];
  timings_ms?: {
    total: number;
    refinement: number;
    db_write: number;
  };
  refinement_mode?: "llm" | "deterministic_fallback";
  refinement_reason?: "llm" | "timeout" | "invalid_json" | "schema_invalid" | "provider_error" | "deterministic_fallback";
  concept_compaction?: {
    raw_chars: number;
    used_chars: number;
    mode: "none" | "auto_condensed";
  };
}

export interface MythicBootstrapRequest {
  campaignId: string;
}

export interface MythicBootstrapResponse {
  ok: boolean;
}
