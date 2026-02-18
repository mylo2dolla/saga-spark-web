import type { Json, Tables } from "@/integrations/supabase/types";

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

export type MythicCharacterRow = Tables<{ schema: "mythic" }, "characters">;
export type MythicItemRow = Tables<{ schema: "mythic" }, "items">;
export type MythicSkillRow = Tables<{ schema: "mythic" }, "skills">;
export type MythicInventoryRow = Pick<
  Tables<{ schema: "mythic" }, "inventory">,
  "id" | "container" | "equip_slot" | "quantity" | "equipped_at"
> & {
  item: MythicItemRow | null;
};

export interface MythicCharacterBundle {
  character: MythicCharacterRow;
  skills: MythicSkillRow[];
  items: MythicInventoryRow[];
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

export interface MythicQuestThreadRow {
  id: string;
  title: string;
  detail?: string | null;
}
