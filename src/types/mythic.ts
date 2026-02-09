export type MythicBoardType = "town" | "dungeon" | "travel" | "combat";

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
  offense: number;
  defense: number;
  control: number;
  support: number;
  mobility: number;
  utility: number;
  class_json: Record<string, unknown>;
  derived_json: Record<string, unknown>;
  resources: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface MythicCharacterBundle {
  character: MythicCharacterRow;
  skills: MythicSkill[];
  items: Array<Record<string, unknown>>;
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
}

export interface MythicBootstrapRequest {
  campaignId: string;
}

export interface MythicBootstrapResponse {
  ok: boolean;
}
