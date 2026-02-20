import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import type {
  MythicActionEventRow,
  MythicCombatantRow,
  MythicCombatSessionRow,
} from "@/hooks/useMythicCombatState";
import type { SkillAvailabilityEntry } from "@/lib/mythic/skillAvailability";
import type { MythicBoardState, MythicBoardType, MythicDmContextResponse } from "@/types/mythic";

export type NarrativeBoardMode = MythicBoardType;

export type NarrativeHotspotKind =
  | "vendor"
  | "notice_board"
  | "gate"
  | "route_segment"
  | "encounter"
  | "dungeon_entry"
  | "return_town"
  | "room"
  | "door"
  | "trap"
  | "chest"
  | "altar"
  | "puzzle"
  | "combatant"
  | "battlefield"
  | "hotspot";

export interface NarrativeCellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface NarrativeHotspotVisual {
  tier?: "primary" | "secondary" | "tertiary";
  icon?: string;
  emphasis?: "normal" | "pulse" | "muted";
  linkToHotspotId?: string;
}

export interface NarrativeHotspot {
  id: string;
  kind: NarrativeHotspotKind;
  title: string;
  subtitle?: string;
  description?: string;
  rect: NarrativeCellRect;
  actions: MythicUiAction[];
  meta?: Record<string, unknown>;
  visual?: NarrativeHotspotVisual;
}

export interface NarrativeInspectInteraction {
  source: "hotspot" | "miss_click";
  x: number;
  y: number;
}

export interface NarrativeInspectTarget {
  id: string;
  kind: NarrativeHotspotKind | "miss_click";
  title: string;
  subtitle?: string;
  description?: string;
  actions: MythicUiAction[];
  meta?: Record<string, unknown>;
  interaction: NarrativeInspectInteraction;
}

export interface NarrativeSceneMetric {
  id: string;
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn" | "danger";
}

export interface NarrativeSceneLegendItem {
  id: string;
  label: string;
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "danger";
}

export interface TownSceneData {
  vendors: Array<{ id: string; name: string; services: string[] }>;
  services: string[];
  jobPostings: Array<{ id: string; title: string; summary: string | null; status: string }>;
  rumors: string[];
  factionsPresent: string[];
}

export interface TravelSceneData {
  routeSegments: Array<{ id: string; name: string; terrain: string; danger: number }>;
  travelGoal: string;
  searchTarget: string | null;
  discoveryFlags: Record<string, unknown>;
  encounterTriggered: boolean;
  dungeonTracesFound: boolean;
}

export interface DungeonSceneData {
  rooms: Array<{ id: string; name: string; tags: string[]; danger: number }>;
  edges: Array<{ from: string; to: string }>;
  roomState: Record<string, unknown>;
  trapSignals: number;
  lootNodes: number;
  factionPresence: string[];
}

export interface NarrativeCombatQuickCast {
  skillId: string;
  name: string;
  targeting: string;
  usableNow: boolean;
  reason: string | null;
}

export interface NarrativeCombatCoreAction {
  id: "basic_attack" | "basic_defend" | "basic_recover_mp";
  label: string;
  targeting: "single" | "self";
  usableNow: boolean;
  reason: string | null;
}

export interface NarrativeCombatHudEntity {
  id: string;
  name: string;
  entityType: MythicCombatantRow["entity_type"];
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  armor: number;
  isAlive: boolean;
  isFocused: boolean;
  isActiveTurn: boolean;
}

export interface NarrativeCombatDelta {
  id: string;
  eventType: "damage" | "healed" | "power_gain" | "power_drain" | "status_applied";
  targetCombatantId: string | null;
  amount: number | null;
  turnIndex: number;
  createdAt: string;
  label: string;
}

export interface CombatSceneData {
  session: MythicCombatSessionRow | null;
  status: string;
  combatants: MythicCombatantRow[];
  allies: MythicCombatantRow[];
  enemies: MythicCombatantRow[];
  recentEvents: MythicActionEventRow[];
  recentDeltas: NarrativeCombatDelta[];
  activeTurnCombatantId: string | null;
  playerCombatantId: string | null;
  focusedCombatantId: string | null;
  blockedTiles: Array<{ x: number; y: number }>;
  playerHud: NarrativeCombatHudEntity | null;
  focusedHud: NarrativeCombatHudEntity | null;
  coreActions: NarrativeCombatCoreAction[];
  quickCast: NarrativeCombatQuickCast[];
}

export type NarrativeSceneDetails = TownSceneData | TravelSceneData | DungeonSceneData | CombatSceneData;

export interface NarrativeBoardSceneModel {
  mode: NarrativeBoardMode;
  title: string;
  subtitle: string;
  contextSource: "runtime_only" | "runtime_and_dm_context";
  warnings: string[];
  metrics: NarrativeSceneMetric[];
  legend: NarrativeSceneLegendItem[];
  hotspots: NarrativeHotspot[];
  fallbackActions: MythicUiAction[];
  layout: {
    version: number;
    seed: string;
  };
  grid: {
    cols: number;
    rows: number;
    blockedTiles: Array<{ x: number; y: number }>;
  };
  details: NarrativeSceneDetails;
}

export interface NarrativeBoardCombatInput {
  session: MythicCombatSessionRow | null;
  combatants: MythicCombatantRow[];
  events: MythicActionEventRow[];
  activeTurnCombatantId: string | null;
  playerCombatantId: string | null;
  focusedCombatantId: string | null;
  quickCastAvailability: SkillAvailabilityEntry[];
}

export interface NarrativeBoardAdapterInput {
  mode: NarrativeBoardMode;
  boardState: MythicBoardState;
  dmContext: MythicDmContextResponse | null;
  combat: NarrativeBoardCombatInput;
}
