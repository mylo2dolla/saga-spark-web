import type { MythicBoardRow, MythicBoardTransitionRow } from "@/hooks/useMythicBoard";
import type { MythicCharacterBundle, MythicCharacterRow, MythicInventoryRow, MythicItemRow, MythicSkillRow } from "@/types/mythic";
import type { Json } from "@/integrations/supabase/types";
import type {
  MythicDmContextPayload,
  MythicDmTurnResponse,
  MythicQuestArc,
  MythicQuestObjective,
  MythicStoryBeat,
} from "@/types/mythicDm";

type E2EMood = "taunting" | "predatory" | "merciful" | "chaotic-patron";

type E2ECombatTarget =
  | { kind: "self" }
  | { kind: "combatant"; combatant_id: string }
  | { kind: "tile"; x: number; y: number };

export interface MythicE2ECombatSessionRow {
  id: string;
  campaign_id: string;
  seed: number;
  status: "active" | "ended";
  current_turn_index: number;
  scene_json: Record<string, unknown>;
  updated_at: string;
}

export interface MythicE2ECombatantRow {
  id: string;
  combat_session_id: string;
  entity_type: "player" | "npc" | "summon";
  player_id: string | null;
  character_id: string | null;
  name: string;
  x: number;
  y: number;
  hp: number;
  hp_max: number;
  power: number;
  power_max: number;
  armor: number;
  resist: number;
  mobility: number;
  initiative: number;
  statuses: unknown;
  is_alive: boolean;
  updated_at: string;
}

export interface MythicE2ETurnOrderRow {
  combat_session_id: string;
  turn_index: number;
  combatant_id: string;
}

export interface MythicE2EActionEventRow {
  id: string;
  combat_session_id: string;
  turn_index: number;
  actor_combatant_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface MythicE2ECombatRewardSummary {
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

interface MythicE2ECombatState {
  session: MythicE2ECombatSessionRow;
  combatants: MythicE2ECombatantRow[];
  turnOrder: MythicE2ETurnOrderRow[];
  events: MythicE2EActionEventRow[];
  previousBoard: MythicBoardRow;
  rewardsClaimed: boolean;
  rewardsSummary: MythicE2ECombatRewardSummary | null;
}

interface MythicE2ECampaignState {
  board: MythicBoardRow;
  transitions: MythicBoardTransitionRow[];
  characterBundle: MythicCharacterBundle;
  questArcs: MythicQuestArc[];
  storyBeats: MythicStoryBeat[];
  mood: E2EMood;
  turnCounter: number;
  combat: MythicE2ECombatState | null;
}

declare global {
  var __MYTHIC_E2E_STATE__: Record<string, MythicE2ECampaignState> | undefined;
}

const nowIso = () => new Date().toISOString();

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function movementBudget(mobility: number): number {
  const base = Math.floor(mobility / 20) + 2;
  return Math.max(2, Math.min(8, base));
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function xpToNextLevel(level: number): number {
  return 140 + level * 110;
}

function parseItemEffectAmount(item: MythicInventoryRow["item"], key: string, fallback = 0): number {
  const effects = asObject(item?.effects_json);
  const entry = effects[key];
  if (typeof entry === "number") return Math.max(0, Math.floor(entry));
  const nested = asObject(entry);
  const amount = asNumber(nested.amount, fallback);
  return Math.max(0, Math.floor(amount));
}

function parseSkillEffectAmount(skill: MythicSkillRow, key: string, fallback = 0): number {
  const effects = asObject(skill.effects_json);
  const entry = effects[key];
  if (typeof entry === "number") return Math.max(0, Math.floor(entry));
  const nested = asObject(entry);
  const amount = asNumber(nested.amount, fallback);
  return Math.max(0, Math.floor(amount));
}

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
    effects_json: { damage: { amount: 120 } },
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
    effects_json: { heal: { amount: 18 } },
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
  {
    id: "e2e-inv-2",
    container: "backpack",
    equip_slot: null,
    quantity: 2,
    equipped_at: null,
    item: {
      id: "e2e-item-2",
      affixes: {},
      bind_policy: "character",
      campaign_id: campaignId,
      created_at: nowIso(),
      drawback_json: {},
      drop_tier: "common",
      durability_json: {},
      effects_json: { heal: { amount: 30 }, power_gain: { amount: 8 } },
      item_power: 5,
      item_type: "consumable",
      name: "Minor Tonic",
      narrative_hook: null,
      owner_character_id: null,
      rarity: "common",
      required_level: 1,
      set_tag: null,
      slot: "consumable",
      stat_mods: {},
      updated_at: nowIso(),
      weapon_family: null,
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
    combat: null,
  };
};

function appendTransition(
  state: MythicE2ECampaignState,
  fromBoardType: MythicBoardTransitionRow["from_board_type"],
  toBoardType: MythicBoardTransitionRow["to_board_type"],
  reason: string,
  payloadJson: Json,
) {
  state.transitions.unshift({
    id: crypto.randomUUID(),
    campaign_id: state.board.campaign_id,
    from_board_type: fromBoardType,
    to_board_type: toBoardType,
    reason,
    animation: "page_turn",
    payload_json: payloadJson,
    created_at: nowIso(),
  });
}

function appendCombatEvent(
  combat: MythicE2ECombatState,
  turnIndex: number,
  actorId: string | null,
  eventType: string,
  payload: Record<string, unknown>,
) {
  combat.events.push({
    id: crypto.randomUUID(),
    combat_session_id: combat.session.id,
    turn_index: turnIndex,
    actor_combatant_id: actorId,
    event_type: eventType,
    payload,
    created_at: nowIso(),
  });
}

function activeCombatantId(combat: MythicE2ECombatState): string | null {
  const row = combat.turnOrder.find((entry) => entry.turn_index === combat.session.current_turn_index);
  return row?.combatant_id ?? null;
}

function resolveCombatTarget(
  combat: MythicE2ECombatState,
  actor: MythicE2ECombatantRow,
  target: E2ECombatTarget,
): MythicE2ECombatantRow | null {
  if (target.kind === "self") return actor;
  if (target.kind === "combatant") {
    return combat.combatants.find((combatant) => combatant.id === target.combatant_id) ?? null;
  }
  return combat.combatants.find((combatant) => combatant.x === target.x && combatant.y === target.y) ?? null;
}

function combatOutcome(combat: MythicE2ECombatState) {
  const alivePlayers = combat.combatants.filter((combatant) => combatant.entity_type === "player" && combatant.is_alive).length;
  const aliveNpcs = combat.combatants.filter((combatant) => combatant.entity_type === "npc" && combatant.is_alive).length;
  const defeatedNpcs = combat.combatants.filter((combatant) => combatant.entity_type === "npc" && !combatant.is_alive).length;
  return {
    alive_players: alivePlayers,
    alive_npcs: aliveNpcs,
    defeated_npcs: defeatedNpcs,
  };
}

function endCombatAndRestoreBoard(state: MythicE2ECampaignState, combat: MythicE2ECombatState) {
  if (combat.session.status === "ended") return;

  const outcome = combatOutcome(combat);
  combat.session.status = "ended";
  combat.session.updated_at = nowIso();

  appendCombatEvent(combat, combat.session.current_turn_index, null, "combat_end", {
    outcome,
    animation_hint: {
      kind: "combat_end_page_flip",
      duration_ms: 420,
    },
  });

  const fromBoardType = state.board.board_type;
  state.board = {
    ...deepClone(combat.previousBoard),
    status: "active",
    combat_session_id: null,
    updated_at: nowIso(),
  };

  appendTransition(
    state,
    fromBoardType,
    state.board.board_type,
    "combat_end",
    {
      combat_session_id: combat.session.id,
      outcome,
    },
  );
}

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
    board: deepClone(state.board),
    transitions: state.transitions.map((transition) => ({ ...transition })),
  };
}

export function getMythicE2ECharacterBundle(campaignId: string): MythicCharacterBundle {
  return deepClone(getMythicE2EState(campaignId).characterBundle);
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

export function getMythicE2ECombatState(campaignId: string, combatSessionId?: string | null) {
  const state = getMythicE2EState(campaignId);
  if (!state.combat) return null;
  if (combatSessionId && state.combat.session.id !== combatSessionId) return null;
  return {
    session: { ...state.combat.session },
    combatants: state.combat.combatants.map((combatant) => ({ ...combatant })),
    turnOrder: state.combat.turnOrder.map((row) => ({ ...row })),
    events: state.combat.events.map((event) => ({ ...event })),
  };
}

export function startMythicE2ECombat(campaignId: string) {
  const state = getMythicE2EState(campaignId);

  if (state.combat?.session.status === "active") {
    return { ok: true, combat_session_id: state.combat.session.id };
  }

  const combatSessionId = crypto.randomUUID();
  const previousBoard = deepClone(state.board);
  const playerId = crypto.randomUUID();
  const enemyId = crypto.randomUUID();

  const playerCombatant: MythicE2ECombatantRow = {
    id: playerId,
    combat_session_id: combatSessionId,
    entity_type: "player",
    player_id: "e2e-user",
    character_id: state.characterBundle.character.id,
    name: state.characterBundle.character.name,
    x: 1,
    y: 1,
    hp: 120,
    hp_max: 120,
    power: 60,
    power_max: 60,
    armor: 0,
    resist: 0,
    mobility: Math.max(10, state.characterBundle.character.mobility),
    initiative: 90,
    statuses: [],
    is_alive: true,
    updated_at: nowIso(),
  };

  const enemyCombatant: MythicE2ECombatantRow = {
    id: enemyId,
    combat_session_id: combatSessionId,
    entity_type: "npc",
    player_id: null,
    character_id: null,
    name: "Ink Ghoul",
    x: 5,
    y: 2,
    hp: 100,
    hp_max: 100,
    power: 0,
    power_max: 0,
    armor: 0,
    resist: 0,
    mobility: 8,
    initiative: 65,
    statuses: [],
    is_alive: true,
    updated_at: nowIso(),
  };

  const combat: MythicE2ECombatState = {
    session: {
      id: combatSessionId,
      campaign_id: campaignId,
      seed: 4242,
      status: "active",
      current_turn_index: 0,
      scene_json: {
        kind: "e2e",
        started_from: previousBoard.board_type,
      },
      updated_at: nowIso(),
    },
    combatants: [playerCombatant, enemyCombatant],
    turnOrder: [
      {
        combat_session_id: combatSessionId,
        turn_index: 0,
        combatant_id: playerId,
      },
    ],
    events: [],
    previousBoard,
    rewardsClaimed: false,
    rewardsSummary: null,
  };

  appendCombatEvent(combat, 0, null, "combat_start", {
    reason: "e2e",
  });
  appendCombatEvent(combat, 0, playerId, "turn_start", {
    actor_combatant_id: playerId,
  });

  const fromBoardType = state.board.board_type;
  state.board = {
    ...state.board,
    id: crypto.randomUUID(),
    board_type: "combat",
    status: "active",
    combat_session_id: combatSessionId,
    state_json: {
      combat_session_id: combatSessionId,
      grid: {
        width: 8,
        height: 6,
      },
      blocked_tiles: [{ x: 3, y: 2 }, { x: 3, y: 3 }],
      seed: 4242,
    },
    updated_at: nowIso(),
  };

  appendTransition(
    state,
    fromBoardType,
    "combat",
    "encounter",
    {
      combat_session_id: combatSessionId,
    },
  );

  state.combat = combat;

  return { ok: true, combat_session_id: combatSessionId };
}

export function moveMythicE2ECombat(args: {
  campaignId: string;
  combatSessionId: string;
  actorCombatantId: string;
  to?: { x: number; y: number };
  wait?: boolean;
}) {
  const state = getMythicE2EState(args.campaignId);
  const combat = state.combat;
  if (!combat || combat.session.id !== args.combatSessionId) {
    return { ok: false as const, error: "Combat session not found" };
  }
  if (combat.session.status !== "active") {
    return { ok: false as const, error: "Combat is not active" };
  }

  const actor = combat.combatants.find((combatant) => combatant.id === args.actorCombatantId) ?? null;
  if (!actor || !actor.is_alive) {
    return { ok: false as const, error: "Actor is not alive" };
  }

  const expectedActorId = activeCombatantId(combat);
  if (expectedActorId !== actor.id) {
    return { ok: false as const, error: "Not your turn" };
  }

  const wait = Boolean(args.wait);
  const grid = asObject(state.board.state_json).grid as { width?: number; height?: number };
  const width = Math.max(4, Math.floor(asNumber(grid?.width, 8)));
  const height = Math.max(4, Math.floor(asNumber(grid?.height, 6)));
  const blockedTiles = (asObject(state.board.state_json).blocked_tiles as Array<{ x: number; y: number }> | undefined) ?? [];
  const blockedSet = new Set(blockedTiles.map((tile) => `${tile.x},${tile.y}`));

  const occupiedSet = new Set(
    combat.combatants
      .filter((combatant) => combatant.is_alive && combatant.id !== actor.id)
      .map((combatant) => `${combatant.x},${combatant.y}`),
  );

  const budget = movementBudget(actor.mobility);

  let destination = { x: actor.x, y: actor.y };
  let stepsUsed = 0;
  let path = [{ x: actor.x, y: actor.y }];

  if (!wait) {
    if (!args.to) {
      return { ok: false as const, error: "Destination is required" };
    }
    destination = {
      x: Math.floor(args.to.x),
      y: Math.floor(args.to.y),
    };

    if (destination.x < 0 || destination.y < 0 || destination.x >= width || destination.y >= height) {
      return { ok: false as const, error: "Destination is outside the combat grid" };
    }

    if (blockedSet.has(`${destination.x},${destination.y}`)) {
      return { ok: false as const, error: "Destination tile is blocked" };
    }

    if (occupiedSet.has(`${destination.x},${destination.y}`)) {
      return { ok: false as const, error: "Destination tile is occupied" };
    }

    stepsUsed = manhattan(actor.x, actor.y, destination.x, destination.y);
    if (stepsUsed > budget) {
      return { ok: false as const, error: `Move exceeds budget (${stepsUsed}/${budget})` };
    }

    const nextPath: Array<{ x: number; y: number }> = [{ x: actor.x, y: actor.y }];
    let cx = actor.x;
    let cy = actor.y;
    while (cx !== destination.x) {
      cx += destination.x > cx ? 1 : -1;
      nextPath.push({ x: cx, y: cy });
    }
    while (cy !== destination.y) {
      cy += destination.y > cy ? 1 : -1;
      nextPath.push({ x: cx, y: cy });
    }
    path = nextPath;

    actor.x = destination.x;
    actor.y = destination.y;
    actor.updated_at = nowIso();

    appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "moved", {
      from: path[0],
      to: destination,
      path,
      movement_budget: budget,
      steps_used: stepsUsed,
      animation_hint: {
        kind: "move",
        duration_ms: 160 + stepsUsed * 55,
      },
    });
  } else {
    appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "wait", {
      actor_combatant_id: actor.id,
      animation_hint: {
        kind: "idle",
        duration_ms: 240,
      },
    });
  }

  appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "turn_end", {
    actor_combatant_id: actor.id,
    action: wait ? "wait" : "move",
  });
  appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "turn_start", {
    actor_combatant_id: actor.id,
    animation_hint: {
      kind: "focus",
      duration_ms: 220,
    },
  });

  combat.session.updated_at = nowIso();

  return {
    ok: true as const,
    moved: !wait,
    waited: wait,
    movement_budget: budget,
    steps_used: stepsUsed,
    path,
    to: destination,
    next_turn_index: combat.session.current_turn_index,
    next_actor_combatant_id: actor.id,
  };
}

export function executeSkillMythicE2E(args: {
  campaignId: string;
  combatSessionId: string;
  actorCombatantId: string;
  skillId: string;
  target: E2ECombatTarget;
}) {
  const state = getMythicE2EState(args.campaignId);
  const combat = state.combat;
  if (!combat || combat.session.id !== args.combatSessionId) {
    return { ok: false as const, ended: false, error: "Combat session not found" };
  }
  if (combat.session.status !== "active") {
    return { ok: false as const, ended: false, error: "Combat is not active" };
  }

  const actor = combat.combatants.find((combatant) => combatant.id === args.actorCombatantId) ?? null;
  if (!actor || !actor.is_alive) {
    return { ok: false as const, ended: false, error: "Actor is not alive" };
  }

  if (activeCombatantId(combat) !== actor.id) {
    return { ok: false as const, ended: false, error: "Not your turn" };
  }

  const skill = state.characterBundle.skills.find((entry) => entry.id === args.skillId) ?? null;
  if (!skill) {
    return { ok: false as const, ended: false, error: "Skill not found" };
  }

  const target = resolveCombatTarget(combat, actor, args.target);
  if (!target || !target.is_alive) {
    return { ok: false as const, ended: false, error: "Target not found" };
  }

  appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "skill_used", {
    skill_id: skill.id,
    skill_name: skill.name,
    target_combatant_id: target.id,
    animation_hint: {
      kind: "cast",
      duration_ms: 320,
    },
  });

  const effectDamage = parseSkillEffectAmount(skill, "damage", 0);
  const fallbackDamage = 120;
  const damage = effectDamage > 0 ? effectDamage : fallbackDamage;

  if (target.id !== actor.id) {
    const hpAfter = Math.max(0, target.hp - damage);
    target.hp = hpAfter;
    target.is_alive = hpAfter > 0;
    target.updated_at = nowIso();

    appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "damage", {
      source_combatant_id: actor.id,
      target_combatant_id: target.id,
      damage_to_hp: damage,
      hp_after: hpAfter,
      animation_hint: {
        kind: hpAfter <= 0 ? "critical_hit" : "hit",
        duration_ms: hpAfter <= 0 ? 320 : 220,
      },
    });

    if (!target.is_alive) {
      appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "death", {
        target_combatant_id: target.id,
        by: {
          combatant_id: actor.id,
          skill_id: skill.id,
        },
      });
    }
  } else {
    const heal = 18;
    actor.hp = Math.min(actor.hp_max, actor.hp + heal);
    actor.updated_at = nowIso();
    appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "healed", {
      target_combatant_id: actor.id,
      amount: heal,
      hp_after: actor.hp,
      animation_hint: {
        kind: "heal",
        duration_ms: 220,
      },
    });
  }

  const outcome = combatOutcome(combat);
  if (outcome.alive_npcs === 0 || outcome.alive_players === 0) {
    endCombatAndRestoreBoard(state, combat);
    return {
      ok: true as const,
      ended: true,
      rewards_ready: true,
      outcome: {
        alive_players: outcome.alive_players,
        alive_npcs: outcome.alive_npcs,
      },
      animation_hint: {
        kind: "combat_end_page_flip",
        duration_ms: 420,
      },
    };
  }

  appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "turn_end", {
    actor_combatant_id: actor.id,
    action: "skill",
  });
  appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "turn_start", {
    actor_combatant_id: actor.id,
    animation_hint: {
      kind: "turn_advance",
      duration_ms: 220,
    },
  });

  combat.session.updated_at = nowIso();

  return {
    ok: true as const,
    ended: false,
    next_turn_index: combat.session.current_turn_index,
    next_actor_combatant_id: actor.id,
    animation_hint: {
      kind: "turn_advance",
      duration_ms: 220,
    },
  };
}

export function executeItemMythicE2E(args: {
  campaignId: string;
  combatSessionId: string;
  actorCombatantId: string;
  inventoryItemId: string;
  target?: E2ECombatTarget;
}) {
  const state = getMythicE2EState(args.campaignId);
  const combat = state.combat;
  if (!combat || combat.session.id !== args.combatSessionId) {
    return { ok: false as const, ended: false, error: "Combat session not found" };
  }
  if (combat.session.status !== "active") {
    return { ok: false as const, ended: false, error: "Combat is not active" };
  }

  const actor = combat.combatants.find((combatant) => combatant.id === args.actorCombatantId) ?? null;
  if (!actor || !actor.is_alive) {
    return { ok: false as const, ended: false, error: "Actor is not alive" };
  }

  if (activeCombatantId(combat) !== actor.id) {
    return { ok: false as const, ended: false, error: "Not your turn" };
  }

  const inventoryRow = state.characterBundle.items.find((entry) => entry.id === args.inventoryItemId) ?? null;
  if (!inventoryRow || !inventoryRow.item || inventoryRow.quantity <= 0) {
    return { ok: false as const, ended: false, error: "Item is not available" };
  }

  const target = resolveCombatTarget(combat, actor, args.target ?? { kind: "self" });
  if (!target || !target.is_alive) {
    return { ok: false as const, ended: false, error: "Target not found" };
  }

  appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "item_used", {
    inventory_item_id: inventoryRow.id,
    item_id: inventoryRow.item.id,
    item_name: inventoryRow.item.name,
    target_combatant_id: target.id,
    animation_hint: {
      kind: "item_use",
      duration_ms: 280,
    },
  });

  const healAmount = parseItemEffectAmount(inventoryRow.item, "heal", inventoryRow.item.slot === "consumable" ? 30 : 0);
  const powerAmount = parseItemEffectAmount(inventoryRow.item, "power_gain", 0);
  const damageAmount = parseItemEffectAmount(inventoryRow.item, "damage", 0);

  if (healAmount > 0) {
    target.hp = Math.min(target.hp_max, target.hp + healAmount);
    target.updated_at = nowIso();
    appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "healed", {
      target_combatant_id: target.id,
      amount: healAmount,
      hp_after: target.hp,
      animation_hint: {
        kind: "heal",
        duration_ms: 220,
      },
    });
  }

  if (powerAmount > 0) {
    actor.power = Math.min(actor.power_max, actor.power + powerAmount);
    actor.updated_at = nowIso();
    appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "power_gain", {
      target_combatant_id: actor.id,
      amount: powerAmount,
      power_after: actor.power,
      animation_hint: {
        kind: "resource_gain",
        duration_ms: 200,
      },
    });
  }

  if (damageAmount > 0) {
    target.hp = Math.max(0, target.hp - damageAmount);
    target.is_alive = target.hp > 0;
    target.updated_at = nowIso();
    appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "damage", {
      source_combatant_id: actor.id,
      target_combatant_id: target.id,
      damage_to_hp: damageAmount,
      hp_after: target.hp,
      animation_hint: {
        kind: target.hp > 0 ? "hit" : "critical_hit",
        duration_ms: target.hp > 0 ? 220 : 320,
      },
    });
    if (!target.is_alive) {
      appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "death", {
        target_combatant_id: target.id,
        by: {
          combatant_id: actor.id,
          item_id: inventoryRow.item.id,
        },
      });
    }
  }

  if (inventoryRow.quantity > 1) {
    inventoryRow.quantity -= 1;
  } else {
    state.characterBundle.items = state.characterBundle.items.filter((entry) => entry.id !== inventoryRow.id);
  }

  const outcome = combatOutcome(combat);
  if (outcome.alive_npcs === 0 || outcome.alive_players === 0) {
    endCombatAndRestoreBoard(state, combat);
    return {
      ok: true as const,
      ended: true,
      rewards_ready: true,
      outcome: {
        alive_players: outcome.alive_players,
        alive_npcs: outcome.alive_npcs,
      },
      animation_hint: {
        kind: "combat_end_page_flip",
        duration_ms: 420,
      },
    };
  }

  appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "turn_end", {
    actor_combatant_id: actor.id,
    action: "item",
  });
  appendCombatEvent(combat, combat.session.current_turn_index, actor.id, "turn_start", {
    actor_combatant_id: actor.id,
    animation_hint: {
      kind: "turn_advance",
      duration_ms: 220,
    },
  });

  combat.session.updated_at = nowIso();

  return {
    ok: true as const,
    ended: false,
    next_turn_index: combat.session.current_turn_index,
    next_actor_combatant_id: actor.id,
    animation_hint: {
      kind: "turn_advance",
      duration_ms: 220,
    },
  };
}

export function claimMythicE2ECombatRewards(args: {
  campaignId: string;
  combatSessionId: string;
}) {
  const state = getMythicE2EState(args.campaignId);
  const combat = state.combat;
  if (!combat || combat.session.id !== args.combatSessionId) {
    return { ok: false as const, already_granted: false, error: "Combat session not found" };
  }

  if (combat.session.status !== "ended") {
    return { ok: false as const, already_granted: false, error: "Combat rewards can only be claimed after combat ends" };
  }

  if (combat.rewardsClaimed && combat.rewardsSummary) {
    return {
      ok: true as const,
      already_granted: true,
      rewards: deepClone(combat.rewardsSummary),
    };
  }

  const outcome = combatOutcome(combat);
  const character = state.characterBundle.character;

  const xpGain = Math.max(18, 58 + outcome.defeated_npcs * 34 + (outcome.alive_npcs === 0 ? 20 : 0));
  const levelBefore = Math.max(1, Math.floor(character.level));
  let xpPool = Math.max(0, Math.floor(character.xp)) + xpGain;
  let levelAfter = levelBefore;
  let xpToNext = Math.max(100, Math.floor(character.xp_to_next));

  while (xpPool >= xpToNext && levelAfter < 99) {
    xpPool -= xpToNext;
    levelAfter += 1;
    xpToNext = xpToNextLevel(levelAfter);
  }

  const levelUps = levelAfter - levelBefore;

  character.level = levelAfter;
  character.xp = xpPool;
  character.xp_to_next = xpToNext;
  character.updated_at = nowIso();
  if (levelUps > 0) {
    character.offense = Math.min(100, character.offense + levelUps);
    character.defense = Math.min(100, character.defense + levelUps);
    character.mobility = Math.min(100, character.mobility + levelUps);
    character.utility = Math.min(100, character.utility + levelUps);
    character.last_level_up_at = nowIso();
  }

  const lootId = crypto.randomUUID();
  const lootName = levelUps > 0 ? "Levelbreaker Sigil" : "Ghoul Trophy";
  const lootRarity: MythicItemRow["rarity"] = levelUps > 0 ? "unique" : "common";
  const lootPower = 6 + levelAfter * 2;

  state.characterBundle.items.push({
    id: crypto.randomUUID(),
    container: "backpack",
    equip_slot: null,
    quantity: 1,
    equipped_at: null,
    item: {
      id: lootId,
      affixes: {},
      bind_policy: "character",
      campaign_id: args.campaignId,
      created_at: nowIso(),
      drawback_json: {},
      drop_tier: lootRarity,
      durability_json: {},
      effects_json: {},
      item_power: lootPower,
      item_type: "gear",
      name: lootName,
      narrative_hook: null,
      owner_character_id: character.id,
      rarity: lootRarity,
      required_level: Math.max(1, levelBefore - 1),
      set_tag: null,
      slot: "trinket",
      stat_mods: { utility: 2 },
      updated_at: nowIso(),
      weapon_family: null,
      weapon_profile: {},
    },
  });

  const summary: MythicE2ECombatRewardSummary = {
    xp_gained: xpGain,
    level_before: levelBefore,
    level_after: levelAfter,
    level_ups: levelUps,
    xp_after: xpPool,
    xp_to_next: xpToNext,
    loot: [
      {
        item_id: lootId,
        name: lootName,
        rarity: lootRarity,
        slot: "trinket",
        item_power: lootPower,
      },
    ],
    outcome: {
      defeated_npcs: outcome.defeated_npcs,
      surviving_players: outcome.alive_players,
      surviving_npcs: outcome.alive_npcs,
      player_alive: outcome.alive_players > 0,
    },
  };

  combat.rewardsClaimed = true;
  combat.rewardsSummary = summary;

  appendCombatEvent(combat, combat.session.current_turn_index, null, "reward_granted", {
    player_id: "e2e-user",
    character_id: character.id,
    rewards: summary,
    animation_hint: {
      kind: "rewards_page_flip",
      duration_ms: 420,
    },
  });

  return {
    ok: true as const,
    already_granted: false,
    rewards: deepClone(summary),
  };
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
      objective.current_count = Math.min(objective.target_count, Math.max(0, objective.current_count + (op.objective_delta ?? 1)));
      if (objective.current_count >= objective.target_count) {
        objective.state = "completed";
      }
      objective.updated_at = nowIso();
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
