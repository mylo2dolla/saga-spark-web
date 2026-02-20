import {
  buildCombatantActions,
  buildDungeonDoorActions,
  buildDungeonFeatureActions,
  buildDungeonRoomActions,
  buildModeFallbackActions,
  buildTownGateActions,
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
  NarrativeHotspot,
  NarrativeSceneLegendItem,
  NarrativeSceneMetric,
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

  return {
    vendors,
    services,
    jobPostings: jobs,
    rumors: rumors.length > 0 ? rumors : fallbackRumors,
    factionsPresent: factions,
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
}): CombatSceneData["playerHud"] {
  return {
    id: args.combatant.id,
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

function parseCombatDelta(event: NarrativeBoardAdapterInput["combat"]["events"][number]) {
  const payload = asRecord(event.payload);
  const targetCombatantId = asString(payload.target_combatant_id) || null;
  if (event.event_type === "damage") {
    const amount = Math.max(0, Math.floor(asNumber(payload.damage_to_hp, asNumber(payload.final_damage, 0))));
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
    const amount = Math.max(0, Math.floor(asNumber(payload.amount, 0)));
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
    const amount = Math.max(0, Math.floor(asNumber(payload.amount, 0)));
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
    const amount = Math.max(0, Math.floor(asNumber(payload.amount, 0)));
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
  return null;
}

function parseCombatData(args: {
  boardState: Record<string, unknown>;
  combatInput: NarrativeBoardAdapterInput["combat"];
}): CombatSceneData {
  const combatants = args.combatInput.combatants;
  const allies = combatants.filter((entry) => isAllyCombatant(entry));
  const enemies = combatants.filter((entry) => !isAllyCombatant(entry));
  const playerCombatant = args.combatInput.playerCombatantId
    ? combatants.find((entry) => entry.id === args.combatInput.playerCombatantId) ?? null
    : null;
  const focusedCombatant = args.combatInput.focusedCombatantId
    ? combatants.find((entry) => entry.id === args.combatInput.focusedCombatantId) ?? null
    : null;
  const fallbackEnemy = enemies.find((entry) => entry.is_alive) ?? null;
  const focusedHudCombatant = focusedCombatant ?? fallbackEnemy ?? null;
  const isPlayersTurn = Boolean(
    playerCombatant
    && args.combatInput.activeTurnCombatantId
    && playerCombatant.id === args.combatInput.activeTurnCombatantId,
  );
  const hasLiveEnemy = enemies.some((entry) => entry.is_alive);
  const coreReason = !playerCombatant
    ? "No player combatant."
    : !playerCombatant.is_alive
      ? "You are down."
      : !isPlayersTurn
        ? "Not your turn."
        : null;
  const status = asString(args.combatInput.session?.status, "idle");
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
    activeTurnCombatantId: args.combatInput.activeTurnCombatantId,
    playerCombatantId: args.combatInput.playerCombatantId,
    focusedCombatantId: args.combatInput.focusedCombatantId,
    blockedTiles: parseBlockedTiles(args.boardState),
    playerHud: playerCombatant
      ? toHudEntity({
          combatant: playerCombatant,
          focusedId: args.combatInput.focusedCombatantId,
          activeTurnId: args.combatInput.activeTurnCombatantId,
        })
      : null,
    focusedHud: focusedHudCombatant
      ? toHudEntity({
          combatant: focusedHudCombatant,
          focusedId: args.combatInput.focusedCombatantId,
          activeTurnId: args.combatInput.activeTurnCombatantId,
        })
      : null,
    coreActions: [
      {
        id: "basic_attack",
        label: "Attack",
        targeting: "single",
        usableNow: coreReason === null && hasLiveEnemy,
        reason: coreReason ?? (hasLiveEnemy ? null : "No enemies alive."),
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

  const openJobs = data.jobPostings.filter((entry) => entry.status === "open").length;
  const metrics: NarrativeSceneMetric[] = [
    { id: "vendors", label: "Vendors", value: String(data.vendors.length) },
    { id: "jobs", label: "Open Jobs", value: String(openJobs), tone: openJobs > 0 ? "good" : "neutral" },
    { id: "factions", label: "Factions", value: String(data.factionsPresent.length) },
    { id: "rumors", label: "Rumors", value: String(data.rumors.length) },
  ];
  const legend: NarrativeSceneLegendItem[] = [
    { id: "legend-town-vendor", label: "V Vendor", detail: "trade and intel", tone: "good" },
    { id: "legend-town-board", label: "N Notice", detail: "contracts and jobs", tone: "neutral" },
    { id: "legend-town-gate", label: "G Gate", detail: "travel transition", tone: "warn" },
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
        tier: "primary",
        icon: "R",
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

  const hotspots: NarrativeHotspot[] = data.combatants.map((combatant) => {
    const x = Math.max(0, Math.min(gridCols - 1, Math.floor(combatant.x)));
    const y = Math.max(0, Math.min(gridRows - 1, Math.floor(combatant.y)));
    const hpPct = combatant.hp_max > 0 ? Math.max(0, Math.min(100, Math.round((combatant.hp / combatant.hp_max) * 100))) : 0;
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
      }),
      meta: {
        combatant_id: combatant.id,
        entity_type: combatant.entity_type,
        hp_pct: hpPct,
        power: Math.floor(combatant.power),
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
