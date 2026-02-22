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

export type NarrativeTone = "neutral" | "good" | "warn" | "danger";

export interface NarrativeSceneMetric {
  id: string;
  label: string;
  value: string;
  tone?: NarrativeTone;
}

export interface NarrativeSceneLegendItem {
  id: string;
  label: string;
  detail?: string;
  tone?: NarrativeTone;
}

export interface NarrativeHeroChip {
  id: string;
  label: string;
  value: string;
  tone?: NarrativeTone;
}

export interface NarrativeHeroModel {
  modeLabel: string;
  statusLabel: string;
  objective: string;
  syncLabel: string;
  contextSourceLabel: string;
  chips: NarrativeHeroChip[];
}

export interface NarrativeModeStripModel {
  modeLabel: string;
  syncLabel: string;
  turnOwnerLabel?: string;
  paceLabel?: string | null;
  moveStateLabel?: string | null;
}

export interface NarrativeFeedItem {
  id: string;
  label: string;
  detail?: string;
  tone?: NarrativeTone;
  createdAt?: string | null;
  turnIndex?: number | null;
}

export interface NarrativeDockCardModel {
  id: string;
  title: string;
  badge?: string;
  tone?: NarrativeTone;
  previewLines: string[];
  detailLines?: string[];
  devDetailLines?: string[];
}

export interface NarrativeBoardPopupModel {
  title: string;
  inspectHint: string;
  emptyProbeHint: string;
}

export interface NarrativeBoardCombatRailModel {
  enabled: boolean;
  title: string;
  skillsLabel: string;
}

export interface TownSceneData {
  vendors: Array<{ id: string; name: string; services: string[] }>;
  services: string[];
  jobPostings: Array<{ id: string; title: string; summary: string | null; status: string }>;
  rumors: string[];
  factionsPresent: string[];
  npcs: Array<{
    id: string;
    name: string;
    role: string;
    faction: string;
    mood: string;
    relationship: number;
    grudge: number;
    locationTile: { x: number; y: number };
    scheduleState: string;
  }>;
  relationshipPressure: number;
  grudgePressure: number;
  activityLog: string[];
  layoutHints?: {
    displayDensity?: "clean_sparse" | "balanced" | "dense";
    reservedTiles?: Array<{ x: number; y: number }>;
    npcPlacements?: Record<string, { x: number; y: number }>;
  };
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
  id: "basic_attack" | "basic_defend" | "basic_recover_mp" | "basic_move";
  label: string;
  targeting: "single" | "self" | "tile";
  usableNow: boolean;
  reason: string | null;
}

export interface NarrativeCombatHudEntity {
  id: string;
  displayLabel: string;
  fullName: string;
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
  eventType:
    | "damage"
    | "miss"
    | "healed"
    | "power_gain"
    | "power_drain"
    | "status_applied"
    | "status_tick"
    | "status_expired"
    | "armor_shred"
    | "death"
    | "moved";
  targetCombatantId: string | null;
  amount: number | null;
  turnIndex: number;
  createdAt: string;
  label: string;
  from?: { x: number; y: number } | null;
  to?: { x: number; y: number } | null;
}

export interface CombatStepResolutionModel {
  id: string;
  actor: string;
  target: string | null;
  eventType: string;
  amount: number | null;
  status: string | null;
  movedTo: { x: number; y: number } | null;
}

export interface CombatPaceStateModel {
  phase: "idle" | "step_committed" | "narrating" | "waiting_voice_end" | "next_step_ready";
  waitingOnVoice: boolean;
  waitingOnTick: boolean;
  stepIndex: number;
}

export interface CombatRewardSummaryModel {
  xpGained: number;
  loot: string[];
  endedAt: string;
  victory: boolean;
}

export interface CombatResolutionPendingModel {
  pending: boolean;
  combatSessionId: string | null;
  returnMode: "town" | "travel" | "dungeon";
  won: boolean;
  xpGained: number;
  loot: string[];
  endedAt: string | null;
}

export interface CombatSceneData {
  session: MythicCombatSessionRow | null;
  status: string;
  combatants: MythicCombatantRow[];
  allies: MythicCombatantRow[];
  enemies: MythicCombatantRow[];
  recentEvents: MythicActionEventRow[];
  recentDeltas: NarrativeCombatDelta[];
  statusFamiliesByCombatant: Record<string, string[]>;
  activeTurnCombatantId: string | null;
  playerCombatantId: string | null;
  focusedCombatantId: string | null;
  blockedTiles: Array<{ x: number; y: number }>;
  playerHud: NarrativeCombatHudEntity | null;
  focusedHud: NarrativeCombatHudEntity | null;
  displayNames: Record<string, { displayLabel: string; fullName: string }>;
  stepResolutions: CombatStepResolutionModel[];
  paceState: CombatPaceStateModel | null;
  rewardSummary: CombatRewardSummaryModel | null;
  resolutionPending: CombatResolutionPendingModel | null;
  moveBudget: number;
  moveUsedThisTurn: boolean;
  distanceToFocusedTarget: number | null;
  movementTiles: Array<{ x: number; y: number }>;
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
  hero: NarrativeHeroModel;
  modeStrip: NarrativeModeStripModel;
  cards: NarrativeDockCardModel[];
  feed: NarrativeFeedItem[];
  hotspots: NarrativeHotspot[];
  fallbackActions: MythicUiAction[];
  layout: {
    version: number;
    seed: string;
  };
  dock: {
    inspectTitle: string;
    actionsTitle: string;
    compact: boolean;
  };
  popup: NarrativeBoardPopupModel;
  combatRail: NarrativeBoardCombatRailModel;
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
  paceState?: CombatPaceStateModel | null;
  rewardSummary?: CombatRewardSummaryModel | null;
  resolutionPending?: CombatResolutionPendingModel | null;
}

export interface NarrativeBoardAdapterInput {
  mode: NarrativeBoardMode;
  boardState: MythicBoardState;
  dmContext: MythicDmContextResponse | null;
  combat: NarrativeBoardCombatInput;
}
