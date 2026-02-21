import {
  buildCombatantActions,
  buildDungeonDoorActions,
  buildDungeonFeatureActions,
  buildDungeonRoomActions,
  buildModeFallbackActions,
  buildTownGateActions,
  buildTownNpcActions,
  buildTownNoticeBoardActions,
  buildTownVendorActions,
  buildTravelDungeonEntryActions,
  buildTravelReturnTownActions,
  buildTravelSegmentActions,
} from "@/ui/components/mythic/board2/actionBuilders";
import type {
  CombatSceneData,
  DungeonSceneData,
  NarrativeBoardAdapterInput,
  NarrativeBoardSceneModel,
  NarrativeDockCardModel,
  NarrativeFeedItem,
  NarrativeHeroModel,
  NarrativeHotspot,
  NarrativeSceneLegendItem,
  NarrativeSceneMetric,
  NarrativeTone,
  TownSceneData,
  TravelSceneData,
} from "@/ui/components/mythic/board2/types";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function parseGridPoint(value: unknown): { x: number; y: number } | null {
  const row = asRecord(value);
  if (!row) return null;
  const x = Math.floor(asNumber(row.x, Number.NaN));
  const y = Math.floor(asNumber(row.y, Number.NaN));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function buildLayoutSeed(mode: string, tokens: Array<string | number | null | undefined>): string {
  const compact = tokens
    .map((entry) => {
      if (typeof entry === "number") return String(Math.floor(entry));
      if (typeof entry === "string") return entry.trim();
      return "";
    })
    .filter((entry) => entry.length > 0)
    .slice(0, 32)
    .join("|");
  return `${mode}:${compact || "default"}`;
}

function normalizeTextList(value: unknown): string[] {
  return asArray(value)
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        return asString(record.title) || asString(record.name) || asString(record.detail) || asString(record.line);
      }
      return "";
    })
    .filter((entry) => entry.length > 0);
}

function summarySamples(summary: Record<string, unknown>, key: string): string[] {
  return normalizeTextList(summary[key]);
}

function parseTownData(args: {
  boardState: Record<string, unknown>;
  summary: Record<string, unknown>;
}): TownSceneData {
  const vendors = asArray(args.boardState.vendors)
    .map((entry, index) => {
      const row = asRecord(entry);
      const id = asString(row.id, `vendor_${index + 1}`);
      const name = asString(row.name, `Vendor ${index + 1}`);
      const services = asArray(row.services)
        .map((service) => asString(service).toLowerCase())
        .filter((service) => service.length > 0);
      return { id, name, services };
    })
    .filter((entry) => entry.name.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 6);

  const services = normalizeTextList(args.boardState.services);
  const jobs = asArray(args.boardState.job_postings)
    .map((entry, index) => {
      const row = asRecord(entry);
      const id = asString(row.id, `job_${index + 1}`);
      const title = asString(row.title, asString(row.summary, `Posting ${index + 1}`));
      const summary = asString(row.summary) || null;
      const status = asString(row.status, "open").toLowerCase();
      return {
        id,
        title,
        summary,
        status: status === "completed" || status === "accepted" ? status : "open",
      };
    })
    .filter((entry) => entry.title.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 8);

  const rumors = normalizeTextList(args.boardState.rumors);
  const fallbackRumors = summarySamples(args.summary, "rumor_samples");
  const factions = normalizeTextList(args.boardState.factions_present);
  const relationships = asRecord(args.boardState.town_relationships);
  const grudges = asRecord(args.boardState.town_grudges);
  const npcs = asArray(args.boardState.town_npcs)
    .map((entry, index) => {
      const row = asRecord(entry);
      const id = asString(row.id, `npc_${index + 1}`);
      const relationshipRaw = asNumber(
        row.relationship,
        asNumber(relationships[id], 0),
      );
      const grudgeRaw = asNumber(
        row.grudge,
        asNumber(grudges[id], 0),
      );
      const locationPayload = asRecord(row.location_tile);
      const x = Math.max(0, Math.min(11, Math.floor(asNumber(locationPayload.x, index % 4))));
      const y = Math.max(0, Math.min(7, Math.floor(asNumber(locationPayload.y, 5 + Math.floor(index / 4)))));
      return {
        id,
        name: asString(row.name, `Town NPC ${index + 1}`),
        role: asString(row.role, "local"),
        faction: asString(row.faction, "independent"),
        mood: asString(row.mood, "steady"),
        relationship: Math.max(-100, Math.min(100, Math.round(relationshipRaw))),
        grudge: Math.max(0, Math.min(100, Math.round(grudgeRaw))),
        locationTile: { x, y },
        scheduleState: asString(row.schedule_state, "idle"),
      };
    })
    .slice(0, 12);
  const activityLog = asArray(args.boardState.town_activity_log)
    .map((entry) => {
      if (typeof entry === "string") return entry.trim();
      if (!entry || typeof entry !== "object") return "";
      const row = entry as Record<string, unknown>;
      const actor = asString(row.npc_name) || asString(row.npc_id) || "Someone";
      const action = asString(row.action) || asString(row.kind) || "moves";
      const detail = asString(row.detail);
      return `${actor} ${action}${detail ? ` · ${detail}` : ""}`;
    })
    .filter((entry) => entry.length > 0)
    .slice(-12);
  const relationshipPressure = npcs
    .slice(0, 8)
    .reduce((acc, entry) => acc + Math.abs(entry.relationship), 0);
  const grudgePressure = npcs
    .slice(0, 8)
    .reduce((acc, entry) => acc + entry.grudge, 0);

  return {
    vendors,
    services,
    jobPostings: jobs,
    rumors: rumors.length > 0 ? rumors : fallbackRumors,
    factionsPresent: factions,
    npcs,
    relationshipPressure,
    grudgePressure,
    activityLog,
  };
}

function parseTravelData(args: {
  boardState: Record<string, unknown>;
  summary: Record<string, unknown>;
}): TravelSceneData {
  const routeSegments = asArray(args.boardState.route_segments)
    .map((entry, index) => {
      const row = asRecord(entry);
      const id = asString(row.id, `segment_${index + 1}`);
      const name = asString(row.name, `Segment ${index + 1}`);
      const terrain = asString(row.terrain, "wilds");
      const danger = Math.max(0, Math.min(10, Math.floor(asNumber(row.danger, 0))));
      return { id, name, terrain, danger };
    })
    .filter((entry) => entry.id.length > 0)
    .slice(0, 10);

  const fallbackSegments = asArray(args.summary.segment_samples)
    .map((entry, index) => {
      const row = asRecord(entry);
      return {
        id: asString(row.id, `segment_${index + 1}`),
        name: asString(row.name, `Segment ${index + 1}`),
        terrain: asString(row.terrain, "wilds"),
        danger: Math.max(0, Math.min(10, Math.floor(asNumber(row.danger, 0)))),
      };
    })
    .filter((entry) => entry.id.length > 0)
    .slice(0, 6);

  const discoveryFlags = asRecord(args.boardState.discovery_flags);
  return {
    routeSegments: routeSegments.length > 0 ? routeSegments : fallbackSegments,
    travelGoal: asString(args.boardState.travel_goal, "explore_wilds"),
    searchTarget: asString(args.boardState.search_target) || null,
    discoveryFlags,
    encounterTriggered: asBoolean(args.boardState.encounter_triggered) || asBoolean(discoveryFlags.encounter_triggered),
    dungeonTracesFound: asBoolean(args.boardState.dungeon_traces_found) || asBoolean(discoveryFlags.dungeon_traces_found),
  };
}

function parseDungeonData(args: {
  boardState: Record<string, unknown>;
  summary: Record<string, unknown>;
}): DungeonSceneData {
  const roomGraph = asRecord(args.boardState.room_graph);
  const rooms = asArray(roomGraph.rooms)
    .map((entry, index) => {
      const row = asRecord(entry);
      return {
        id: asString(row.id, `room_${index + 1}`),
        name: asString(row.name, `Room ${index + 1}`),
        tags: asArray(row.tags).map((tag) => asString(tag)).filter((tag) => tag.length > 0),
        danger: Math.max(0, Math.min(10, Math.floor(asNumber(row.danger, 0)))),
      };
    })
    .filter((entry) => entry.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  const fallbackRooms = asArray(args.summary.room_samples)
    .map((entry, index) => {
      const row = asRecord(entry);
      return {
        id: asString(row.id, `room_${index + 1}`),
        name: asString(row.name, `Room ${index + 1}`),
        tags: asArray(row.tags).map((tag) => asString(tag)).filter((tag) => tag.length > 0),
        danger: Math.max(0, Math.min(10, Math.floor(asNumber(row.danger, 0)))),
      };
    })
    .filter((entry) => entry.id.length > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, 8);

  const edges = asArray(roomGraph.edges)
    .map((entry) => {
      const row = asRecord(entry);
      const from = asString(row.from);
      const to = asString(row.to);
      if (!from || !to) return null;
      return { from, to };
    })
    .filter((entry): entry is { from: string; to: string } => Boolean(entry));

  const roomState = asRecord(args.boardState.room_state);
  const factionPresence = normalizeTextList(args.boardState.faction_presence);

  return {
    rooms: rooms.length > 0 ? rooms : fallbackRooms,
    edges,
    roomState,
    trapSignals: Math.max(0, Math.floor(asNumber(args.boardState.trap_signals, asNumber(args.summary.trap_signals, 0)))),
    lootNodes: Math.max(0, Math.floor(asNumber(args.boardState.loot_nodes, asNumber(args.summary.loot_nodes, 0)))),
    factionPresence,
  };
}

function parseBlockedTiles(boardState: Record<string, unknown>): Array<{ x: number; y: number }> {
  return asArray(boardState.blocked_tiles)
    .map((entry) => {
      const row = asRecord(entry);
      const x = Math.floor(asNumber(row.x, Number.NaN));
      const y = Math.floor(asNumber(row.y, Number.NaN));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    })
    .filter((entry): entry is { x: number; y: number } => Boolean(entry))
    .slice(0, 180);
}

function isAllyCombatant(entry: { player_id: string | null }): boolean {
  return typeof entry.player_id === "string" && entry.player_id.trim().length > 0;
}

function toHudEntity(args: {
  combatant: CombatSceneData["combatants"][number];
  focusedId: string | null;
  activeTurnId: string | null;
  displayLabel: string;
  fullName: string;
}): CombatSceneData["playerHud"] {
  return {
    id: args.combatant.id,
    displayLabel: args.displayLabel,
    fullName: args.fullName,
    name: args.combatant.name,
    entityType: args.combatant.entity_type,
    hp: Math.max(0, Math.floor(args.combatant.hp)),
    hpMax: Math.max(1, Math.floor(args.combatant.hp_max)),
    mp: Math.max(0, Math.floor(args.combatant.power)),
    mpMax: Math.max(0, Math.floor(args.combatant.power_max)),
    armor: Math.max(0, Math.floor(args.combatant.armor)),
    isAlive: Boolean(args.combatant.is_alive),
    isFocused: args.focusedId === args.combatant.id,
    isActiveTurn: args.activeTurnId === args.combatant.id,
  };
}

function moveBudgetFromMobility(mobility: number): number {
  return Math.max(2, Math.min(6, Math.floor(Number(mobility) / 20) + 2));
}

function tileDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(Math.floor(a.x) - Math.floor(b.x)) + Math.abs(Math.floor(a.y) - Math.floor(b.y));
}

function compactCombatantName(name: string, max = 8): string {
  const clean = name.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(3, max - 1))}…`;
}

function buildCombatDisplayNames(combatants: CombatSceneData["combatants"]): Record<string, { displayLabel: string; fullName: string }> {
  const baseCounts = new Map<string, number>();
  combatants.forEach((combatant) => {
    const base = compactCombatantName(combatant.name, 8);
    baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1);
  });
  const out: Record<string, { displayLabel: string; fullName: string }> = {};
  combatants.forEach((combatant) => {
    const fullName = combatant.name.trim() || "Unit";
    const base = compactCombatantName(fullName, 8);
    const displayLabel = (baseCounts.get(base) ?? 0) <= 1
      ? base
      : `${compactCombatantName(fullName, 6)} ${combatant.id.replace(/[^a-z0-9]/gi, "").slice(-2).toUpperCase() || "X"}`;
    out[combatant.id] = { displayLabel, fullName };
  });
  return out;
}

function buildRecentStepResolutions(args: {
  events: NarrativeBoardAdapterInput["combat"]["events"];
  displayNames: Record<string, { displayLabel: string; fullName: string }>;
}): CombatSceneData["stepResolutions"] {
  return args.events
    .slice(-18)
    .map((event) => {
      const payload = asRecord(event.payload);
      const actorId = asString(payload.source_combatant_id)
        || asString(payload.actor_combatant_id)
        || asString(event.actor_combatant_id)
        || null;
      const targetId = asString(payload.target_combatant_id) || null;
      const actor = actorId ? (args.displayNames[actorId]?.fullName ?? actorId) : "Unknown";
      const target = targetId ? (args.displayNames[targetId]?.fullName ?? targetId) : null;
      const damageToHp = asNumber(payload.damage_to_hp, Number.NaN);
      const finalDamage = asNumber(payload.final_damage, Number.NaN);
      const genericAmount = asNumber(payload.amount, Number.NaN);
      const amountRaw = Number.isFinite(damageToHp)
        ? damageToHp
        : Number.isFinite(finalDamage)
          ? finalDamage
          : Number.isFinite(genericAmount)
            ? genericAmount
            : 0;
      const amount = Math.max(0, Math.round(amountRaw));
      const statusPayload = asRecord(payload.status);
      const status = asString(statusPayload.id) || asString(payload.status_id) || null;
      const movedTo = parseGridPoint(payload.to);
      return {
        id: event.id,
        actor,
        target,
        eventType: event.event_type,
        amount: Number.isFinite(amount) && amount > 0 ? amount : null,
        status,
        movedTo,
      };
    })
    .filter((entry) => entry.eventType !== "skill_used" && entry.eventType !== "turn_start" && entry.eventType !== "turn_end")
    .slice(-8);
}

function reachableMovementTiles(args: {
  origin: { x: number; y: number };
  budget: number;
  cols: number;
  rows: number;
  blockedTiles: Array<{ x: number; y: number }>;
  occupiedTiles: Array<{ x: number; y: number }>;
}): Array<{ x: number; y: number }> {
  const budget = Math.max(0, Math.floor(args.budget));
  if (budget <= 0) return [];

  const blocked = new Set(args.blockedTiles.map((tile) => `${tile.x},${tile.y}`));
  const occupied = new Set(args.occupiedTiles.map((tile) => `${tile.x},${tile.y}`));
  occupied.delete(`${Math.floor(args.origin.x)},${Math.floor(args.origin.y)}`);
  const seen = new Set<string>();
  const queue: Array<{ x: number; y: number; depth: number }> = [{ x: args.origin.x, y: args.origin.y, depth: 0 }];
  const out: Array<{ x: number; y: number }> = [];

  const push = (x: number, y: number, depth: number) => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    if (x < 0 || y < 0 || x >= args.cols || y >= args.rows) return;
    if (blocked.has(key) || occupied.has(key)) return;
    seen.add(key);
    queue.push({ x, y, depth });
    out.push({ x, y });
  };

  seen.add(`${Math.floor(args.origin.x)},${Math.floor(args.origin.y)}`);
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.depth >= budget) continue;
    const nextDepth = current.depth + 1;
    push(current.x + 1, current.y, nextDepth);
    push(current.x - 1, current.y, nextDepth);
    push(current.x, current.y + 1, nextDepth);
    push(current.x, current.y - 1, nextDepth);
  }
  return out;
}

function parseCombatDelta(event: NarrativeBoardAdapterInput["combat"]["events"][number]) {
  const payload = asRecord(event.payload);
  const targetCombatantId = asString(payload.target_combatant_id) || null;
  if (event.event_type === "miss") {
    const roll = asNumber(payload.roll_d20, Number.NaN);
    const required = asNumber(payload.required_roll, Number.NaN);
    return {
      id: event.id,
      eventType: "miss" as const,
      targetCombatantId,
      amount: null,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: Number.isFinite(roll) && Number.isFinite(required)
        ? `Miss ${Math.floor(roll)}/${Math.floor(required)}`
        : "Miss",
    };
  }
  if (event.event_type === "damage") {
    const damageToHp = asNumber(payload.damage_to_hp, Number.NaN);
    const finalDamage = asNumber(payload.final_damage, 0);
    const amount = Math.max(
      0,
      Math.round(Number.isFinite(damageToHp) ? damageToHp : finalDamage),
    );
    return {
      id: event.id,
      eventType: "damage" as const,
      targetCombatantId,
      amount,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: amount > 0 ? `-${amount}` : "blocked",
    };
  }
  if (event.event_type === "healed") {
    const amount = Math.max(0, Math.round(asNumber(payload.amount, 0)));
    return {
      id: event.id,
      eventType: "healed" as const,
      targetCombatantId,
      amount,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: amount > 0 ? `+${amount}` : "+0",
    };
  }
  if (event.event_type === "power_gain") {
    const amount = Math.max(0, Math.round(asNumber(payload.amount, 0)));
    return {
      id: event.id,
      eventType: "power_gain" as const,
      targetCombatantId,
      amount,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: amount > 0 ? `+${amount} MP` : "+0 MP",
    };
  }
  if (event.event_type === "power_drain") {
    const amount = Math.max(0, Math.round(asNumber(payload.amount, 0)));
    return {
      id: event.id,
      eventType: "power_drain" as const,
      targetCombatantId,
      amount,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: amount > 0 ? `-${amount} MP` : "-0 MP",
    };
  }
  if (event.event_type === "status_applied") {
    const status = asRecord(payload.status);
    const statusId = asString(status.id, "status");
    return {
      id: event.id,
      eventType: "status_applied" as const,
      targetCombatantId,
      amount: null,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: statusId.replace(/_/g, " "),
    };
  }
  if (event.event_type === "status_tick") {
    const statusId = asString(payload.status_id, "status");
    const amount = Math.max(0, Math.round(asNumber(payload.amount, asNumber(payload.damage_to_hp, 0))));
    return {
      id: event.id,
      eventType: "status_tick" as const,
      targetCombatantId,
      amount: amount > 0 ? amount : null,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: amount > 0 ? `${statusId.replace(/_/g, " ")} ${amount}` : `${statusId.replace(/_/g, " ")} tick`,
    };
  }
  if (event.event_type === "status_expired") {
    const statusId = asString(payload.status_id, "status");
    return {
      id: event.id,
      eventType: "status_expired" as const,
      targetCombatantId,
      amount: null,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: `${statusId.replace(/_/g, " ")} faded`,
    };
  }
  if (event.event_type === "armor_shred") {
    const amount = Math.max(0, Math.round(asNumber(payload.amount, 0)));
    return {
      id: event.id,
      eventType: "armor_shred" as const,
      targetCombatantId,
      amount: amount > 0 ? amount : null,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: amount > 0 ? `Armor -${amount}` : "Armor shredded",
    };
  }
  if (event.event_type === "death") {
    return {
      id: event.id,
      eventType: "death" as const,
      targetCombatantId: targetCombatantId || asString(payload.combatant_id) || null,
      amount: null,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: "Defeated",
    };
  }
  if (event.event_type === "moved") {
    const from = parseGridPoint(payload.from);
    const to = parseGridPoint(payload.to);
    const tilesUsed = Math.max(0, Math.floor(asNumber(payload.tiles_used, 0)));
    return {
      id: event.id,
      eventType: "moved" as const,
      targetCombatantId: targetCombatantId ?? event.actor_combatant_id ?? null,
      amount: tilesUsed > 0 ? tilesUsed : null,
      turnIndex: Math.floor(event.turn_index),
      createdAt: event.created_at,
      label: tilesUsed > 0 ? `Move ${tilesUsed}` : "Reposition",
      from,
      to,
    };
  }
  return null;
}

function statusFamily(statusIdRaw: string): string {
  const id = statusIdRaw.trim().toLowerCase();
  if (!id) return "";
  if (id.includes("bleed") || id.includes("blood")) return "bleed";
  if (id.includes("poison") || id.includes("venom") || id.includes("toxin")) return "poison";
  if (id.includes("burn") || id.includes("ignite") || id.includes("scorch")) return "burn";
  if (id.includes("guard") || id.includes("parry")) return "guard";
  if (id.includes("barrier") || id.includes("shield") || id.includes("ward")) return "barrier";
  if (id.includes("vulnerable") || id.includes("exposed")) return "vulnerable";
  if (id.includes("stun") || id.includes("stagger") || id.includes("daze")) return "stunned";
  return id;
}

function buildStatusFamiliesByCombatant(
  combatants: NarrativeBoardAdapterInput["combat"]["combatants"],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  combatants.forEach((combatant) => {
    const statuses = Array.isArray(combatant.statuses) ? combatant.statuses : [];
    const families = statuses
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => statusFamily(asString(entry.id)))
      .filter((entry) => entry.length > 0);
    if (families.length > 0) {
      const uniqueFamilies = [...new Set<string>(families)].slice(0, 4);
      out[combatant.id] = uniqueFamilies;
    }
  });
  return out;
}

function parseCombatData(args: {
  boardState: Record<string, unknown>;
  combatInput: NarrativeBoardAdapterInput["combat"];
}): CombatSceneData {
  const allCombatants = args.combatInput.combatants;
  const combatants = allCombatants.filter((entry) => entry.is_alive && Number(entry.hp) > 0);
  const statusFamiliesByCombatant = buildStatusFamiliesByCombatant(allCombatants);
  const allies = combatants.filter((entry) => isAllyCombatant(entry));
  const enemies = combatants.filter((entry) => !isAllyCombatant(entry));
  const playerCombatant = args.combatInput.playerCombatantId
    ? allCombatants.find((entry) => entry.id === args.combatInput.playerCombatantId) ?? null
    : null;
  const focusedCombatant = args.combatInput.focusedCombatantId
    ? allCombatants.find((entry) => entry.id === args.combatInput.focusedCombatantId) ?? null
    : null;
  const fallbackEnemy = enemies.find((entry) => entry.is_alive) ?? null;
  const focusedHudCombatant = focusedCombatant ?? fallbackEnemy ?? null;
  const displayNames = buildCombatDisplayNames(allCombatants);
  const isPlayersTurn = Boolean(
    playerCombatant
    && args.combatInput.activeTurnCombatantId
    && playerCombatant.id === args.combatInput.activeTurnCombatantId,
  );
  const currentTurnIndex = Math.max(0, Math.floor(Number(args.combatInput.session?.current_turn_index ?? 0)));
  const sessionId = typeof args.combatInput.session?.id === "string" ? args.combatInput.session.id : "";
  const moveTurnMarker = `${sessionId}:${currentTurnIndex}`;
  const playerStatuses = Array.isArray(playerCombatant?.statuses) ? playerCombatant.statuses : [];
  const moveAlreadySpent = playerStatuses.some((entry) => {
    const row = asRecord(entry);
    if (!row) return false;
    if (asString(row.id) !== "move_spent") return false;
    const data = asRecord(row.data);
    return asString(data?.turn_marker) === moveTurnMarker;
  });
  const coreReason = !playerCombatant
    ? "No player combatant."
    : !playerCombatant.is_alive
      ? "You are down."
    : !isPlayersTurn
        ? "Not your turn."
        : null;
  const moveReason = coreReason ?? (moveAlreadySpent ? "Move already used this turn." : null);
  const hasLiveEnemy = enemies.some((entry) => entry.is_alive);
  const moveBudget = moveBudgetFromMobility(playerCombatant?.mobility ?? 0);
  const inRangeEnemy = playerCombatant
    ? enemies.some((entry) => entry.is_alive && tileDistance(playerCombatant, entry) <= moveBudget)
    : false;
  const attackReason = coreReason
    ?? (!hasLiveEnemy
      ? "No enemies alive."
      : !inRangeEnemy
        ? "Target out of range. Move first."
        : null);
  const blockedTiles = parseBlockedTiles(args.boardState);
  const movementTiles = playerCombatant
    ? reachableMovementTiles({
        origin: { x: Math.floor(playerCombatant.x), y: Math.floor(playerCombatant.y) },
        budget: moveBudget,
        cols: 14,
        rows: 10,
        blockedTiles,
        occupiedTiles: combatants
          .filter((entry) => entry.is_alive)
          .map((entry) => ({ x: Math.floor(entry.x), y: Math.floor(entry.y) })),
      })
    : [];
  const distanceToFocusedTarget = playerCombatant && focusedHudCombatant
    ? tileDistance(playerCombatant, focusedHudCombatant)
    : null;
  const stepResolutions = buildRecentStepResolutions({
    events: args.combatInput.events,
    displayNames,
  });
  const paceState = args.combatInput.paceState ?? null;
  const rewardSummary = args.combatInput.rewardSummary ?? null;
  const resolutionPending = args.combatInput.resolutionPending ?? null;
  const status = resolutionPending?.pending ? "resolved" : asString(args.combatInput.session?.status, "idle");

  return {
    session: args.combatInput.session,
    status,
    combatants,
    allies,
    enemies,
    recentEvents: args.combatInput.events.slice(-24),
    recentDeltas: args.combatInput.events
      .slice(-30)
      .map((event) => parseCombatDelta(event))
      .filter((event): event is NonNullable<ReturnType<typeof parseCombatDelta>> => Boolean(event))
      .slice(-12),
    statusFamiliesByCombatant,
    activeTurnCombatantId: args.combatInput.activeTurnCombatantId,
    playerCombatantId: args.combatInput.playerCombatantId,
    focusedCombatantId: args.combatInput.focusedCombatantId,
    blockedTiles,
    playerHud: playerCombatant
      ? toHudEntity({
          combatant: playerCombatant,
          focusedId: args.combatInput.focusedCombatantId,
          activeTurnId: args.combatInput.activeTurnCombatantId,
          displayLabel: displayNames[playerCombatant.id]?.displayLabel ?? playerCombatant.name,
          fullName: displayNames[playerCombatant.id]?.fullName ?? playerCombatant.name,
        })
      : null,
    focusedHud: focusedHudCombatant
      ? toHudEntity({
          combatant: focusedHudCombatant,
          focusedId: args.combatInput.focusedCombatantId,
          activeTurnId: args.combatInput.activeTurnCombatantId,
          displayLabel: displayNames[focusedHudCombatant.id]?.displayLabel ?? focusedHudCombatant.name,
          fullName: displayNames[focusedHudCombatant.id]?.fullName ?? focusedHudCombatant.name,
        })
      : null,
    displayNames,
    stepResolutions,
    paceState,
    rewardSummary,
    resolutionPending,
    moveBudget,
    moveUsedThisTurn: moveAlreadySpent,
    distanceToFocusedTarget,
    movementTiles: isPlayersTurn ? movementTiles : [],
    coreActions: [
      {
        id: "basic_move",
        label: "Move",
        targeting: "tile",
        usableNow: moveReason === null,
        reason: moveReason,
      },
      {
        id: "basic_attack",
        label: "Attack",
        targeting: "single",
        usableNow: attackReason === null,
        reason: attackReason,
      },
      {
        id: "basic_defend",
        label: "Defend",
        targeting: "self",
        usableNow: coreReason === null,
        reason: coreReason,
      },
      {
        id: "basic_recover_mp",
        label: "Recover MP",
        targeting: "self",
        usableNow: coreReason === null,
        reason: coreReason,
      },
    ],
    quickCast: args.combatInput.quickCastAvailability.map((entry) => ({
      skillId: entry.skillId,
      name: entry.name,
      targeting: entry.targeting,
      usableNow: entry.usableNow,
      reason: entry.reason,
    })),
  };
}

function modeLabel(mode: NarrativeBoardSceneModel["mode"]): string {
  if (mode === "town") return "Town";
  if (mode === "travel") return "Travel";
  if (mode === "dungeon") return "Dungeon";
  return "Combat";
}

function heroObjective(mode: NarrativeBoardSceneModel["mode"], data: NarrativeBoardSceneModel["details"]): string {
  if (mode === "town") {
    const town = data as TownSceneData;
    if (town.jobPostings.length > 0) return `Review ${town.jobPostings.length} active town contracts.`;
    return "Stabilize faction pressure and pick your next route.";
  }
  if (mode === "travel") {
    const travel = data as TravelSceneData;
    const goal = travel.travelGoal.replace(/_/g, " ");
    return `Advance travel objective: ${goal}.`;
  }
  if (mode === "dungeon") {
    const dungeon = data as DungeonSceneData;
    return `Secure ${dungeon.rooms.length} mapped rooms and control hazards.`;
  }
  const combat = data as CombatSceneData;
  const liveEnemies = combat.enemies.filter((entry) => entry.is_alive).length;
  return liveEnemies > 0 ? `Break enemy pressure (${liveEnemies} hostile active).` : "Combat board stabilized.";
}

function heroStatus(mode: NarrativeBoardSceneModel["mode"], data: NarrativeBoardSceneModel["details"]): string {
  if (mode === "combat") {
    const combat = data as CombatSceneData;
    return combat.status;
  }
  if (mode === "travel") {
    const travel = data as TravelSceneData;
    return travel.encounterTriggered ? "encounter pressure" : "route clear";
  }
  if (mode === "dungeon") {
    const dungeon = data as DungeonSceneData;
    return dungeon.trapSignals > 0 ? "hazards active" : "stable";
  }
  const town = data as TownSceneData;
  return town.factionsPresent.length > 0 ? "faction pressure" : "stable square";
}

function contextSourceLabel(contextSource: NarrativeBoardSceneModel["contextSource"]): string {
  return contextSource === "runtime_and_dm_context" ? "Story Sync: Live" : "Story Sync: Runtime";
}

function activeTurnOwnerLabel(data: CombatSceneData): string {
  const active = data.combatants.find((entry) => entry.id === data.activeTurnCombatantId) ?? null;
  if (!active) return "Turn: Waiting";
  if (active.entity_type === "player") return "Turn: You";
  const isAlly = isAllyCombatant(active);
  const display = data.displayNames[active.id]?.displayLabel ?? compactCombatantName(active.name, 8);
  return isAlly ? `Turn: Ally ${display}` : `Turn: Enemy ${display}`;
}

function combatPaceStripLabel(data: CombatSceneData): string | null {
  const pace = data.paceState;
  if (!pace) return null;
  if (pace.phase === "waiting_voice_end") return "Pace: waiting on voice";
  if (pace.phase === "step_committed" || pace.phase === "narrating") return "Pace: narrating";
  if (pace.phase === "next_step_ready") return "Pace: next step ready";
  return "Pace: idle";
}

function buildHero(args: {
  mode: NarrativeBoardSceneModel["mode"];
  details: NarrativeBoardSceneModel["details"];
  metrics: NarrativeSceneMetric[];
  contextSource: NarrativeBoardSceneModel["contextSource"];
}): NarrativeHeroModel {
  return {
    modeLabel: modeLabel(args.mode),
    statusLabel: heroStatus(args.mode, args.details),
    objective: heroObjective(args.mode, args.details),
    syncLabel: "Ready",
    contextSourceLabel: contextSourceLabel(args.contextSource),
    chips: args.metrics.slice(0, 4).map((metric) => ({
      id: metric.id,
      label: metric.label,
      value: metric.value,
      tone: metric.tone,
    })),
  };
}

function buildModeStrip(args: {
  mode: NarrativeBoardSceneModel["mode"];
  details: NarrativeBoardSceneModel["details"];
  contextSource: NarrativeBoardSceneModel["contextSource"];
}): NarrativeBoardSceneModel["modeStrip"] {
  if (args.mode !== "combat") {
    return {
      modeLabel: modeLabel(args.mode),
      syncLabel: contextSourceLabel(args.contextSource),
    };
  }
  const combat = args.details as CombatSceneData;
  return {
    modeLabel: modeLabel(args.mode),
    syncLabel: contextSourceLabel(args.contextSource),
    turnOwnerLabel: activeTurnOwnerLabel(combat),
    paceLabel: combatPaceStripLabel(combat),
    moveStateLabel: `Move ${combat.moveUsedThisTurn ? "used" : "ready"} (${combat.moveBudget})`,
  };
}

function cardFromLines(args: {
  id: string;
  title: string;
  previewLines: string[];
  detailLines?: string[];
  devDetailLines?: string[];
  badge?: string;
  tone?: NarrativeTone;
}): NarrativeDockCardModel {
  return {
    id: args.id,
    title: args.title,
    badge: args.badge,
    tone: args.tone,
    previewLines: args.previewLines.filter((line) => line.trim().length > 0).slice(0, 3),
    detailLines: (args.detailLines ?? []).filter((line) => line.trim().length > 0),
    devDetailLines: (args.devDetailLines ?? []).filter((line) => line.trim().length > 0),
  };
}

function toneForCombatDelta(type: CombatSceneData["recentDeltas"][number]["eventType"]): NarrativeTone {
  if (type === "damage" || type === "power_drain") return "danger";
  if (type === "miss") return "warn";
  if (type === "healed" || type === "power_gain") return "good";
  if (type === "status_applied" || type === "status_tick" || type === "armor_shred") return "warn";
  if (type === "death") return "danger";
  return "neutral";
}

function buildCombatFeed(data: CombatSceneData): NarrativeFeedItem[] {
  return data.recentDeltas
    .slice()
    .reverse()
    .slice(0, 5)
    .map((delta) => ({
      id: delta.id,
      label: delta.label,
      detail: delta.eventType.replace(/_/g, " "),
      tone: toneForCombatDelta(delta.eventType),
      createdAt: delta.createdAt,
      turnIndex: delta.turnIndex,
    }));
}

function buildAmbientFeed(args: {
  mode: NarrativeBoardSceneModel["mode"];
  warnings: string[];
  metrics: NarrativeSceneMetric[];
}): NarrativeFeedItem[] {
  const warningFeed = args.warnings.slice(0, 3).map((warning, index) => ({
    id: `warning-${index + 1}`,
    label: warning,
    tone: "warn" as const,
  }));
  const metricFeed = args.metrics.slice(0, 4).map((metric) => ({
    id: `metric-${metric.id}`,
    label: `${metric.label}: ${metric.value}`,
    tone: metric.tone ?? "neutral",
  }));
  const modeLabelText = modeLabel(args.mode);
  const baseline: NarrativeFeedItem = {
    id: `mode-${args.mode}`,
    label: `${modeLabelText} board synchronized.`,
    tone: "neutral",
  };
  return [baseline, ...warningFeed, ...metricFeed].slice(0, 8);
}

function buildSceneSummaryCard(args: {
  mode: NarrativeBoardSceneModel["mode"];
  details: NarrativeBoardSceneModel["details"];
  metrics: NarrativeSceneMetric[];
}): NarrativeDockCardModel {
  if (args.mode === "town") {
    const town = args.details as TownSceneData;
    return cardFromLines({
      id: "scene",
      title: "Scene",
      previewLines: [
        `${town.vendors.length} vendors`,
        `${town.jobPostings.filter((entry) => entry.status === "open").length} open jobs`,
        `${town.npcs.length} locals active`,
      ],
      detailLines: [
        ...town.vendors.slice(0, 6).map((entry) => `Vendor: ${entry.name}`),
        ...town.npcs.slice(0, 6).map((entry) => `Local: ${entry.name} · rel ${entry.relationship} · grudge ${entry.grudge}`),
        ...town.rumors.slice(0, 4).map((entry) => `Rumor: ${entry}`),
        ...town.activityLog.slice(-4).map((entry) => `Activity: ${entry}`),
      ],
    });
  }
  if (args.mode === "travel") {
    const travel = args.details as TravelSceneData;
    return cardFromLines({
      id: "scene",
      title: "Scene",
      previewLines: [
        `Goal: ${travel.travelGoal.replace(/_/g, " ")}`,
        `Segments: ${travel.routeSegments.length}`,
        `Encounter: ${travel.encounterTriggered ? "triggered" : "clear"}`,
      ],
      detailLines: travel.routeSegments.slice(0, 8).map((entry) => (
        `${entry.name} · ${entry.terrain} · danger ${entry.danger}`
      )),
    });
  }
  if (args.mode === "dungeon") {
    const dungeon = args.details as DungeonSceneData;
    return cardFromLines({
      id: "scene",
      title: "Scene",
      previewLines: [
        `Rooms: ${dungeon.rooms.length}`,
        `Traps: ${dungeon.trapSignals}`,
        `Loot: ${dungeon.lootNodes}`,
      ],
      detailLines: [
        ...dungeon.rooms.slice(0, 8).map((entry) => `Room: ${entry.name} (danger ${entry.danger})`),
        ...dungeon.factionPresence.slice(0, 4).map((entry) => `Faction: ${entry}`),
      ],
    });
  }
  const combat = args.details as CombatSceneData;
  return cardFromLines({
    id: "scene",
    title: "Scene",
    previewLines: [
      `Session: ${combat.status}`,
      `Allies: ${combat.allies.filter((entry) => entry.is_alive).length}`,
      `Enemies: ${combat.enemies.filter((entry) => entry.is_alive).length}`,
    ],
    detailLines: combat.combatants.slice(0, 10).map((entry) => (
      `${entry.name} · HP ${Math.floor(entry.hp)}/${Math.floor(entry.hp_max)} · MP ${Math.floor(entry.power)}/${Math.floor(entry.power_max)}`
    )),
    badge: combat.activeTurnCombatantId ? "active turn" : undefined,
  });
}

function buildFeedCard(feed: NarrativeFeedItem[]): NarrativeDockCardModel {
  return cardFromLines({
    id: "feed",
    title: "Feed",
    previewLines: feed.slice(0, 3).map((entry) => entry.label),
    detailLines: feed.slice(0, 12).map((entry) => {
      const parts = [entry.label, entry.detail].filter((piece): piece is string => Boolean(piece));
      return parts.join(" · ");
    }),
    devDetailLines: feed.slice(0, 12).map((entry) => {
      const parts = [
        entry.label,
        entry.detail,
        typeof entry.turnIndex === "number" ? `t${entry.turnIndex}` : null,
        entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
      ].filter((piece): piece is string => Boolean(piece));
      return parts.join(" · ");
    }),
    badge: feed.length > 0 ? `${feed.length}` : undefined,
  });
}

function buildMoreCard(args: {
  metrics: NarrativeSceneMetric[];
  legend: NarrativeSceneLegendItem[];
  warnings: string[];
  contextSource: NarrativeBoardSceneModel["contextSource"];
}): NarrativeDockCardModel {
  return cardFromLines({
    id: "more",
    title: "More",
    previewLines: [
      "Board legend and scene status",
      `${args.legend.length} legend markers`,
      `${args.warnings.length} warnings`,
    ],
    detailLines: [
      ...args.legend.map((entry) => `${entry.label}${entry.detail ? ` · ${entry.detail}` : ""}`),
      ...args.warnings.map((warning) => `Warning: ${warning}`),
    ],
    devDetailLines: [
      `Context: ${contextSourceLabel(args.contextSource)}`,
      ...args.metrics.map((metric) => `${metric.label}: ${metric.value}`),
      ...args.legend.map((entry) => `${entry.label}${entry.detail ? ` · ${entry.detail}` : ""}`),
      ...args.warnings.map((warning) => `Warning: ${warning}`),
    ],
    badge: args.warnings.length > 0 ? "warn" : undefined,
    tone: args.warnings.length > 0 ? "warn" : "neutral",
  });
}

function buildTownScene(args: {
  boardState: Record<string, unknown>;
  summary: Record<string, unknown>;
  warnings: string[];
  contextSource: "runtime_only" | "runtime_and_dm_context";
}): NarrativeBoardSceneModel {
  const data = parseTownData({ boardState: args.boardState, summary: args.summary });
  const vendorSpots = [
    { x: 1, y: 1, w: 3, h: 2 },
    { x: 4, y: 1, w: 3, h: 2 },
    { x: 7, y: 1, w: 3, h: 2 },
    { x: 1, y: 3, w: 3, h: 2 },
  ];

  const hotspots: NarrativeHotspot[] = [];
  data.vendors.slice(0, vendorSpots.length).forEach((vendor, index) => {
    hotspots.push({
      id: `town-vendor-${vendor.id}`,
      kind: "vendor",
      title: vendor.name,
      subtitle: vendor.services.slice(0, 2).join(" • ") || "merchant",
      description: "Trade, rumor pressure, and contract leads.",
      rect: vendorSpots[index] ?? { x: 1, y: 1, w: 3, h: 2 },
      actions: buildTownVendorActions(vendor),
      meta: {
        vendor_id: vendor.id,
        services: vendor.services,
      },
      visual: {
        tier: "primary",
        icon: "V",
      },
    });
  });

  if (data.jobPostings.length > 0 || data.services.some((entry) => /board|notice|job|bounty|contract/.test(entry.toLowerCase()))) {
    hotspots.push({
      id: "town-notice-board",
      kind: "notice_board",
      title: "Notice Board",
      subtitle: `${data.jobPostings.length} tracked postings`,
      description: "Public contracts, bounty chatter, and leverage points.",
      rect: { x: 4, y: 4, w: 4, h: 2 },
      actions: buildTownNoticeBoardActions(data.jobPostings.map((row) => ({ id: row.id, title: row.title, status: row.status }))),
      meta: {
        open_jobs: data.jobPostings.filter((row) => row.status === "open").length,
      },
      visual: {
        tier: "secondary",
        icon: "N",
      },
    });
  }

  hotspots.push({
    id: "town-gate",
    kind: "gate",
    title: "Town Gate",
    subtitle: "Road control",
    description: "Leave the square and project force into the wilds.",
    rect: { x: 10, y: 3, w: 2, h: 3 },
    actions: buildTownGateActions(),
    visual: {
      tier: "primary",
      icon: "G",
    },
  });

  data.npcs.slice(0, 10).forEach((npc) => {
    hotspots.push({
      id: `town-npc-${npc.id}`,
      kind: "hotspot",
      title: npc.name,
      subtitle: `${npc.role} · ${npc.faction} · ${npc.mood}`,
      description: `Relationship ${npc.relationship} · Grudge ${npc.grudge}`,
      rect: {
        x: npc.locationTile.x,
        y: npc.locationTile.y,
        w: 1,
        h: 1,
      },
      actions: buildTownNpcActions({
        npcId: npc.id,
        npcName: npc.name,
        role: npc.role,
        faction: npc.faction,
        mood: npc.mood,
        relationship: npc.relationship,
        grudge: npc.grudge,
      }),
      meta: {
        npc_id: npc.id,
        npc_role: npc.role,
        npc_faction: npc.faction,
        npc_mood: npc.mood,
        relationship: npc.relationship,
        grudge: npc.grudge,
        schedule_state: npc.scheduleState,
      },
      visual: {
        tier: npc.grudge >= 35 ? "primary" : npc.relationship >= 30 ? "secondary" : "tertiary",
        icon: npc.grudge >= 35 ? "!" : "N",
        emphasis: npc.grudge >= 35 ? "pulse" : "normal",
      },
    });
  });

  const openJobs = data.jobPostings.filter((entry) => entry.status === "open").length;
  const metrics: NarrativeSceneMetric[] = [
    { id: "vendors", label: "Vendors", value: String(data.vendors.length) },
    { id: "jobs", label: "Open Jobs", value: String(openJobs), tone: openJobs > 0 ? "good" : "neutral" },
    { id: "factions", label: "Factions", value: String(data.factionsPresent.length) },
    { id: "rumors", label: "Rumors", value: String(data.rumors.length) },
    { id: "locals", label: "Locals", value: String(data.npcs.length) },
    {
      id: "pressure",
      label: "Grudge",
      value: String(data.grudgePressure),
      tone: data.grudgePressure >= 100 ? "warn" : "neutral",
    },
  ];
  const legend: NarrativeSceneLegendItem[] = [
    { id: "legend-town-vendor", label: "V Vendor", detail: "trade and intel", tone: "good" },
    { id: "legend-town-board", label: "N Notice", detail: "contracts and jobs", tone: "neutral" },
    { id: "legend-town-gate", label: "G Gate", detail: "travel transition", tone: "warn" },
    { id: "legend-town-npc", label: "N Local", detail: "relationships and grudges", tone: "neutral" },
  ];
  const feed = [
    ...data.activityLog.slice(-3).reverse().map((line, index) => ({
      id: `town-activity-${index + 1}`,
      label: line,
      tone: "neutral" as const,
    })),
    ...buildAmbientFeed({ mode: "town", warnings: args.warnings, metrics }),
  ].slice(0, 8);
  const cards: NarrativeDockCardModel[] = [
    buildSceneSummaryCard({ mode: "town", details: data, metrics }),
    buildFeedCard(feed),
    buildMoreCard({
      metrics,
      legend,
      warnings: args.warnings,
      contextSource: args.contextSource,
    }),
  ];

  const fallbackActions = buildModeFallbackActions({ mode: "town", town: data });
  const worldTitle = asString(asRecord(args.boardState.world_seed).title, "Town Square");
  const layoutSeed = buildLayoutSeed("town", [
    worldTitle,
    ...data.vendors.map((vendor) => vendor.id),
    ...data.jobPostings.map((job) => job.id),
  ]);
  return {
    mode: "town",
    title: worldTitle,
    subtitle: "Vendors, contracts, and faction pressure are live.",
    contextSource: args.contextSource,
    warnings: args.warnings,
    metrics,
    legend,
    hero: buildHero({ mode: "town", details: data, metrics, contextSource: args.contextSource }),
    modeStrip: buildModeStrip({ mode: "town", details: data, contextSource: args.contextSource }),
    cards,
    feed,
    hotspots,
    fallbackActions,
    layout: {
      version: 1,
      seed: layoutSeed,
    },
    dock: {
      inspectTitle: "Inspect",
      actionsTitle: "Town Actions",
      compact: true,
    },
    popup: {
      title: "Town Inspect",
      inspectHint: "Inspect building details first, then confirm an action.",
      emptyProbeHint: "Probe empty tiles for rumors or hidden opportunities.",
    },
    combatRail: {
      enabled: false,
      title: "Core Actions",
      skillsLabel: "Skills",
    },
    grid: {
      cols: 12,
      rows: 8,
      blockedTiles: [],
    },
    details: data,
  };
}

function buildTravelScene(args: {
  boardState: Record<string, unknown>;
  summary: Record<string, unknown>;
  warnings: string[];
  contextSource: "runtime_only" | "runtime_and_dm_context";
}): NarrativeBoardSceneModel {
  const data = parseTravelData({ boardState: args.boardState, summary: args.summary });
  const hotspots: NarrativeHotspot[] = [];

  const routeCols = 4;
  data.routeSegments.forEach((segment, index) => {
    const col = index % routeCols;
    const row = Math.floor(index / routeCols);
    const xIndex = row % 2 === 0 ? col : (routeCols - 1 - col);
    hotspots.push({
      id: `travel-segment-${segment.id}`,
      kind: "route_segment",
      title: segment.name,
      subtitle: `${segment.terrain} • danger ${segment.danger}`,
      description: "Probe this segment before committing movement.",
      rect: {
        x: 1 + xIndex * 2,
        y: 1 + row * 2,
        w: 2,
        h: 1,
      },
      actions: buildTravelSegmentActions({
        segmentId: segment.id,
        segmentName: segment.name,
        terrain: segment.terrain,
        travelGoal: data.travelGoal,
        searchTarget: data.searchTarget,
        dungeonTracesFound: data.dungeonTracesFound,
      }),
      meta: {
        segment_id: segment.id,
        terrain: segment.terrain,
        danger: segment.danger,
      },
      visual: {
        tier: segment.danger >= 7 ? "primary" : segment.danger >= 4 ? "secondary" : "tertiary",
        icon: segment.danger >= 7 ? "R!" : "R",
      },
    });
  });

  if (data.searchTarget === "dungeon" || data.dungeonTracesFound) {
    hotspots.push({
      id: "travel-dungeon-entry",
      kind: "dungeon_entry",
      title: "Dungeon Traces",
      subtitle: data.dungeonTracesFound ? "confirmed" : "pending confirmation",
      description: "Run a confirmation probe or force dungeon entry.",
      rect: { x: 9, y: 1, w: 2, h: 2 },
      actions: buildTravelDungeonEntryActions({
        travelGoal: data.travelGoal,
        searchTarget: data.searchTarget,
      }),
      meta: {
        search_target: data.searchTarget,
        traces_found: data.dungeonTracesFound,
      },
      visual: {
        tier: "primary",
        icon: "D",
        emphasis: "pulse",
      },
    });
  }

  hotspots.push({
    id: "travel-return-town",
    kind: "return_town",
    title: "Return Route",
    subtitle: "reset in town",
    description: "Return to town to recover, trade, and re-plan.",
    rect: { x: 9, y: 5, w: 2, h: 2 },
    actions: buildTravelReturnTownActions(),
    visual: {
      tier: "secondary",
      icon: "T",
    },
  });

  const metrics: NarrativeSceneMetric[] = [
    { id: "segments", label: "Segments", value: String(data.routeSegments.length) },
    {
      id: "encounter",
      label: "Encounter",
      value: data.encounterTriggered ? "Triggered" : "Clear",
      tone: data.encounterTriggered ? "warn" : "good",
    },
    {
      id: "dungeon",
      label: "Dungeon Traces",
      value: data.dungeonTracesFound ? "Found" : "None",
      tone: data.dungeonTracesFound ? "good" : "neutral",
    },
    { id: "goal", label: "Goal", value: data.travelGoal.replace(/_/g, " ") },
  ];
  const legend: NarrativeSceneLegendItem[] = [
    { id: "legend-travel-route", label: "R Route", detail: "probe each leg", tone: "neutral" },
    { id: "legend-travel-dungeon", label: "D Entry", detail: "dungeon traces", tone: "warn" },
    { id: "legend-travel-town", label: "T Return", detail: "reset and restock", tone: "good" },
  ];
  const feed = buildAmbientFeed({ mode: "travel", warnings: args.warnings, metrics });
  const cards: NarrativeDockCardModel[] = [
    buildSceneSummaryCard({ mode: "travel", details: data, metrics }),
    buildFeedCard(feed),
    buildMoreCard({
      metrics,
      legend,
      warnings: args.warnings,
      contextSource: args.contextSource,
    }),
  ];

  const fallbackActions = buildModeFallbackActions({ mode: "travel", travel: data });
  const worldTitle = asString(asRecord(args.boardState.world_seed).title, "Overland Route");
  const layoutSeed = buildLayoutSeed("travel", [
    worldTitle,
    data.travelGoal,
    ...data.routeSegments.map((segment) => segment.id),
    data.searchTarget ?? "",
  ]);

  return {
    mode: "travel",
    title: `${worldTitle} Frontier`,
    subtitle: "Route probes and encounter pressure from committed runtime state.",
    contextSource: args.contextSource,
    warnings: args.warnings,
    metrics,
    legend,
    hero: buildHero({ mode: "travel", details: data, metrics, contextSource: args.contextSource }),
    modeStrip: buildModeStrip({ mode: "travel", details: data, contextSource: args.contextSource }),
    cards,
    feed,
    hotspots,
    fallbackActions,
    layout: {
      version: 1,
      seed: layoutSeed,
    },
    dock: {
      inspectTitle: "Inspect",
      actionsTitle: "Route Actions",
      compact: true,
    },
    popup: {
      title: "Route Inspect",
      inspectHint: "Inspect route nodes before committing movement.",
      emptyProbeHint: "Probe empty tiles to scout danger and resources.",
    },
    combatRail: {
      enabled: false,
      title: "Core Actions",
      skillsLabel: "Skills",
    },
    grid: {
      cols: 12,
      rows: 8,
      blockedTiles: [],
    },
    details: data,
  };
}

function buildDungeonScene(args: {
  boardState: Record<string, unknown>;
  summary: Record<string, unknown>;
  warnings: string[];
  contextSource: "runtime_only" | "runtime_and_dm_context";
}): NarrativeBoardSceneModel {
  const data = parseDungeonData({ boardState: args.boardState, summary: args.summary });
  const hotspots: NarrativeHotspot[] = [];
  const roomPositions = new Map<string, { x: number; y: number }>();

  const cols = Math.max(2, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, data.rooms.length)))));
  data.rooms.forEach((room, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = 1 + col * 3;
    const y = 1 + row * 2;
    roomPositions.set(room.id, { x, y });
    const stateEntry = asRecord(data.roomState[room.id]);
    const status = asString(stateEntry.status) || null;
    hotspots.push({
      id: `dungeon-room-${room.id}`,
      kind: "room",
      title: room.name,
      subtitle: status ? `${status} • danger ${room.danger}` : `danger ${room.danger}`,
      description: "Inspect, search, or secure this room.",
      rect: { x, y, w: 2, h: 1 },
      actions: buildDungeonRoomActions({
        roomId: room.id,
        roomName: room.name,
        roomStatus: status,
      }),
      meta: {
        room_id: room.id,
        tags: room.tags,
        danger: room.danger,
        status,
      },
      visual: {
        tier: "primary",
        icon: "RM",
      },
    });
  });

  data.edges.forEach((edge, index) => {
    const from = roomPositions.get(edge.from);
    const to = roomPositions.get(edge.to);
    if (!from || !to) return;
    hotspots.push({
      id: `dungeon-door-${index + 1}`,
      kind: "door",
      title: `${edge.from} -> ${edge.to}`,
      subtitle: "transition",
      rect: {
        x: Math.max(0, Math.min(11, Math.floor((from.x + to.x) / 2))),
        y: Math.max(0, Math.min(7, Math.floor((from.y + to.y) / 2))),
        w: 1,
        h: 1,
      },
      actions: buildDungeonDoorActions({
        fromRoomId: edge.from,
        toRoomId: edge.to,
        toRoomName: data.rooms.find((entry) => entry.id === edge.to)?.name ?? edge.to,
      }),
      meta: {
        from_room_id: edge.from,
        to_room_id: edge.to,
      },
      visual: {
        tier: "secondary",
        icon: "DR",
      },
    });
  });

  if (data.trapSignals > 0) {
    hotspots.push({
      id: "dungeon-trap-cluster",
      kind: "trap",
      title: "Trap Signals",
      subtitle: `${data.trapSignals} detected`,
      rect: { x: 10, y: 1, w: 2, h: 2 },
      actions: buildDungeonFeatureActions({ roomId: data.rooms[0]?.id ?? null, feature: "trap" }),
      meta: {
        trap_signals: data.trapSignals,
      },
      visual: {
        tier: "secondary",
        icon: "TR",
      },
    });
  }

  if (data.lootNodes > 0) {
    hotspots.push({
      id: "dungeon-loot-node",
      kind: "chest",
      title: "Loot Nodes",
      subtitle: `${data.lootNodes} active`,
      rect: { x: 10, y: 4, w: 2, h: 2 },
      actions: buildDungeonFeatureActions({ roomId: data.rooms[0]?.id ?? null, feature: "chest" }),
      meta: {
        loot_nodes: data.lootNodes,
      },
      visual: {
        tier: "secondary",
        icon: "LT",
      },
    });
  }

  if (data.rooms.some((room) => room.tags.includes("altar"))) {
    hotspots.push({
      id: "dungeon-altar",
      kind: "altar",
      title: "Ancient Altar",
      subtitle: "volatile effect node",
      rect: { x: 8, y: 6, w: 2, h: 2 },
      actions: buildDungeonFeatureActions({ roomId: data.rooms[0]?.id ?? null, feature: "altar" }),
      visual: {
        tier: "tertiary",
        icon: "AL",
      },
    });
  }

  if (data.rooms.some((room) => room.tags.includes("puzzle"))) {
    hotspots.push({
      id: "dungeon-puzzle",
      kind: "puzzle",
      title: "Puzzle Lock",
      subtitle: "progress gate",
      rect: { x: 6, y: 6, w: 2, h: 2 },
      actions: buildDungeonFeatureActions({ roomId: data.rooms[0]?.id ?? null, feature: "puzzle" }),
      visual: {
        tier: "tertiary",
        icon: "PZ",
      },
    });
  }

  const metrics: NarrativeSceneMetric[] = [
    { id: "rooms", label: "Rooms", value: String(data.rooms.length) },
    { id: "traps", label: "Trap Signals", value: String(data.trapSignals), tone: data.trapSignals > 0 ? "warn" : "good" },
    { id: "loot", label: "Loot Nodes", value: String(data.lootNodes), tone: data.lootNodes > 0 ? "good" : "neutral" },
    { id: "factions", label: "Factions", value: String(data.factionPresence.length) },
  ];
  const legend: NarrativeSceneLegendItem[] = [
    { id: "legend-dungeon-room", label: "RM Room", detail: "core node", tone: "neutral" },
    { id: "legend-dungeon-door", label: "DR Door", detail: "transition link", tone: "warn" },
    { id: "legend-dungeon-trap", label: "TR Trap", detail: "hazard pressure", tone: data.trapSignals > 0 ? "warn" : "good" },
    { id: "legend-dungeon-loot", label: "LT Loot", detail: "resource node", tone: data.lootNodes > 0 ? "good" : "neutral" },
  ];
  const feed = buildAmbientFeed({ mode: "dungeon", warnings: args.warnings, metrics });
  const cards: NarrativeDockCardModel[] = [
    buildSceneSummaryCard({ mode: "dungeon", details: data, metrics }),
    buildFeedCard(feed),
    buildMoreCard({
      metrics,
      legend,
      warnings: args.warnings,
      contextSource: args.contextSource,
    }),
  ];

  const fallbackActions = buildModeFallbackActions({ mode: "dungeon", dungeon: data });
  const layoutSeed = buildLayoutSeed("dungeon", [
    ...data.rooms.map((room) => room.id),
    ...data.edges.map((edge) => `${edge.from}->${edge.to}`),
    data.trapSignals,
    data.lootNodes,
  ]);
  return {
    mode: "dungeon",
    title: "Dungeon Depths",
    subtitle: "Room graph pressure, traps, and objective execution.",
    contextSource: args.contextSource,
    warnings: args.warnings,
    metrics,
    legend,
    hero: buildHero({ mode: "dungeon", details: data, metrics, contextSource: args.contextSource }),
    modeStrip: buildModeStrip({ mode: "dungeon", details: data, contextSource: args.contextSource }),
    cards,
    feed,
    hotspots,
    fallbackActions,
    layout: {
      version: 1,
      seed: layoutSeed,
    },
    dock: {
      inspectTitle: "Inspect",
      actionsTitle: "Dungeon Actions",
      compact: true,
    },
    popup: {
      title: "Dungeon Inspect",
      inspectHint: "Inspect rooms and features before committing actions.",
      emptyProbeHint: "Probe empty tiles to assess hazards and paths.",
    },
    combatRail: {
      enabled: false,
      title: "Core Actions",
      skillsLabel: "Skills",
    },
    grid: {
      cols: 12,
      rows: 8,
      blockedTiles: [],
    },
    details: data,
  };
}

function buildCombatScene(args: {
  boardState: Record<string, unknown>;
  warnings: string[];
  contextSource: "runtime_only" | "runtime_and_dm_context";
  combatInput: NarrativeBoardAdapterInput["combat"];
}): NarrativeBoardSceneModel {
  const data = parseCombatData({ boardState: args.boardState, combatInput: args.combatInput });
  const maxX = Math.max(8, ...data.combatants.map((entry) => Math.floor(entry.x) + 1), ...data.blockedTiles.map((tile) => tile.x + 1));
  const maxY = Math.max(6, ...data.combatants.map((entry) => Math.floor(entry.y) + 1), ...data.blockedTiles.map((tile) => tile.y + 1));
  const gridCols = Math.min(14, Math.max(8, maxX + 1));
  const gridRows = Math.min(10, Math.max(6, maxY + 1));
  const playerCombatant = data.playerCombatantId
    ? data.combatants.find((entry) => entry.id === data.playerCombatantId) ?? null
    : null;
  const isPlayersTurn = Boolean(
    playerCombatant
      && data.activeTurnCombatantId
      && data.activeTurnCombatantId === playerCombatant.id,
  );
  const moveCore = data.coreActions.find((entry) => entry.id === "basic_move") ?? null;
  const attackCore = data.coreActions.find((entry) => entry.id === "basic_attack") ?? null;
  const focusReason = !isPlayersTurn ? "Not your turn." : null;

  const hotspots: NarrativeHotspot[] = data.combatants.map((combatant) => {
    const x = Math.max(0, Math.min(gridCols - 1, Math.floor(combatant.x)));
    const y = Math.max(0, Math.min(gridRows - 1, Math.floor(combatant.y)));
    const hpPct = combatant.hp_max > 0 ? Math.max(0, Math.min(100, Math.round((combatant.hp / combatant.hp_max) * 100))) : 0;
    const distanceToPlayer = playerCombatant
      ? tileDistance({ x: Math.floor(playerCombatant.x), y: Math.floor(playerCombatant.y) }, { x, y })
      : null;
    const inRangeForAttack = distanceToPlayer !== null ? distanceToPlayer <= 1 : false;
    const moveReason = moveCore?.reason ?? (isPlayersTurn ? null : "Not your turn.");
    const attackReason = attackCore?.reason
      ?? (isPlayersTurn
        ? (inRangeForAttack ? null : "Out of range. Move first.")
        : "Not your turn.");
    return {
      id: `combatant-${combatant.id}`,
      kind: "combatant",
      title: combatant.name,
      subtitle: `${combatant.entity_type} • hp ${Math.floor(combatant.hp)}/${Math.floor(combatant.hp_max)}`,
      description: "Focus target and trigger tactical narration/actions.",
      rect: { x, y, w: 1, h: 1 },
      actions: buildCombatantActions({
        combatantId: combatant.id,
        combatantName: combatant.name,
        isFocused: data.focusedCombatantId === combatant.id,
        isEnemy: !isAllyCombatant(combatant),
        moveDisabledReason: !isAllyCombatant(combatant) ? moveReason : null,
        attackDisabledReason: !isAllyCombatant(combatant) ? attackReason : null,
        focusDisabledReason: focusReason,
      }),
      meta: {
        combatant_id: combatant.id,
        entity_type: combatant.entity_type,
        hp_pct: hpPct,
        power: Math.floor(combatant.power),
        distance_to_player: distanceToPlayer,
        in_range_attack: inRangeForAttack,
        statuses: combatant.statuses,
      },
      visual: {
        tier: isAllyCombatant(combatant) ? "secondary" : "primary",
        icon: isAllyCombatant(combatant) ? "ALY" : "ENY",
        emphasis: combatant.id === data.activeTurnCombatantId ? "pulse" : "normal",
      },
    };
  });

  const aliveEnemies = data.enemies.filter((entry) => entry.is_alive).length;
  const aliveAllies = data.allies.filter((entry) => entry.is_alive).length;
  const readyQuickCasts = data.quickCast.filter((entry) => entry.usableNow).length;

  const metrics: NarrativeSceneMetric[] = [
    { id: "status", label: "Session", value: data.status },
    { id: "allies", label: "Allies", value: String(aliveAllies), tone: aliveAllies > 0 ? "good" : "danger" },
    { id: "enemies", label: "Enemies", value: String(aliveEnemies), tone: aliveEnemies > 0 ? "warn" : "good" },
    { id: "quick_cast", label: "Quick Cast", value: String(readyQuickCasts), tone: readyQuickCasts > 0 ? "good" : "neutral" },
  ];
  const legend: NarrativeSceneLegendItem[] = [
    { id: "legend-combat-enemy", label: "ENY Enemy", detail: "pressure target", tone: "warn" },
    { id: "legend-combat-ally", label: "ALY Ally", detail: "controlled unit", tone: "good" },
    { id: "legend-combat-active", label: "ACT Active", detail: "active turn", tone: "neutral" },
    { id: "legend-combat-blocked", label: "BLK Tile", detail: "movement obstacle", tone: "danger" },
  ];
  const feed = buildCombatFeed(data);
  const effectiveFeed = feed.length > 0
    ? feed
    : buildAmbientFeed({ mode: "combat", warnings: args.warnings, metrics });
  const cards: NarrativeDockCardModel[] = [
    buildSceneSummaryCard({ mode: "combat", details: data, metrics }),
    buildFeedCard(effectiveFeed),
    buildMoreCard({
      metrics,
      legend,
      warnings: args.warnings,
      contextSource: args.contextSource,
    }),
  ];

  const fallbackActions = buildModeFallbackActions({ mode: "combat", combat: data });
  const layoutSeed = buildLayoutSeed("combat", [
    data.session?.id ?? "",
    ...data.combatants.map((combatant) => combatant.id),
    ...data.blockedTiles.map((tile) => `${tile.x},${tile.y}`),
  ]);

  return {
    mode: "combat",
    title: "Combat Grid",
    subtitle: "Focus targets, quick-cast from state truth, and keep narration synchronized.",
    contextSource: args.contextSource,
    warnings: args.warnings,
    metrics,
    legend,
    hero: buildHero({ mode: "combat", details: data, metrics, contextSource: args.contextSource }),
    modeStrip: buildModeStrip({ mode: "combat", details: data, contextSource: args.contextSource }),
    cards,
    feed: effectiveFeed,
    hotspots,
    fallbackActions,
    layout: {
      version: 1,
      seed: layoutSeed,
    },
    dock: {
      inspectTitle: "Inspect",
      actionsTitle: "Combat Actions",
      compact: true,
    },
    popup: {
      title: "Combat Inspect",
      inspectHint: "Inspect a target first, then confirm the action.",
      emptyProbeHint: "Probe empty tiles for tactical readouts.",
    },
    combatRail: {
      enabled: true,
      title: "Core Actions",
      skillsLabel: "Skills",
    },
    grid: {
      cols: gridCols,
      rows: gridRows,
      blockedTiles: data.blockedTiles,
    },
    details: data,
  };
}

export function buildNarrativeBoardScene(input: NarrativeBoardAdapterInput): NarrativeBoardSceneModel {
  const boardState = asRecord(input.boardState);
  const contextWarnings = Array.isArray(input.dmContext?.warnings)
    ? input.dmContext?.warnings.filter((entry): entry is string => typeof entry === "string")
    : [];
  const dmBoard = asRecord(input.dmContext?.board);
  const summary = asRecord(dmBoard.state_summary);
  const contextSource = input.dmContext ? "runtime_and_dm_context" : "runtime_only";

  if (input.mode === "town") {
    return buildTownScene({ boardState, summary, warnings: contextWarnings, contextSource });
  }
  if (input.mode === "travel") {
    return buildTravelScene({ boardState, summary, warnings: contextWarnings, contextSource });
  }
  if (input.mode === "dungeon") {
    return buildDungeonScene({ boardState, summary, warnings: contextWarnings, contextSource });
  }
  return buildCombatScene({ boardState, warnings: contextWarnings, contextSource, combatInput: input.combat });
}
