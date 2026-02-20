import type { MythicUiAction } from "@/hooks/useMythicDungeonMaster";
import type {
  CombatSceneData,
  DungeonSceneData,
  NarrativeBoardMode,
  NarrativeHotspot,
  NarrativeInspectTarget,
  TownSceneData,
  TravelSceneData,
} from "@/ui/components/mythic/board2/types";

function slugToken(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || "action";
}

function compactLabel(value: string, maxLength = 46): string {
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) return "Action";
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trim()}...` : clean;
}

export function actionSignature(action: MythicUiAction): string {
  const payload = action.payload ?? {};
  const target = typeof payload.target_combatant_id === "string"
    ? payload.target_combatant_id
    : typeof payload.vendorId === "string"
      ? payload.vendorId
      : typeof payload.room_id === "string"
        ? payload.room_id
        : typeof payload.to_room_id === "string"
          ? payload.to_room_id
          : typeof payload.search_target === "string"
            ? payload.search_target
            : typeof payload.travel_probe === "string"
              ? payload.travel_probe
              : action.boardTarget ?? action.panel ?? action.id;
  const promptKey = (action.prompt ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `${action.intent}:${target}:${promptKey}`;
}

export function dedupeBoardActions(actions: MythicUiAction[], maxActions = 8): MythicUiAction[] {
  const out: MythicUiAction[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    const normalized = {
      ...action,
      label: compactLabel(action.label || action.prompt || action.id),
    };
    const signature = actionSignature(normalized);
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(normalized);
    if (out.length >= maxActions) break;
  }
  return out;
}

export function buildInspectTargetFromHotspot(args: {
  hotspot: NarrativeHotspot;
  x: number;
  y: number;
}): NarrativeInspectTarget {
  const { hotspot } = args;
  return {
    id: hotspot.id,
    kind: hotspot.kind,
    title: hotspot.title,
    subtitle: hotspot.subtitle,
    description: hotspot.description,
    actions: hotspot.actions,
    meta: hotspot.meta,
    interaction: {
      source: "hotspot",
      x: args.x,
      y: args.y,
    },
  };
}

function formatMode(mode: NarrativeBoardMode): string {
  return mode.charAt(0).toUpperCase() + mode.slice(1);
}

export function buildMissClickInspectTarget(args: {
  mode: NarrativeBoardMode;
  x: number;
  y: number;
  travel?: TravelSceneData;
  dungeon?: DungeonSceneData;
  combat?: CombatSceneData;
}): NarrativeInspectTarget {
  const { mode, x, y } = args;

  if (mode === "town") {
    const actions: MythicUiAction[] = [
      {
        id: `town-probe-${x}-${y}`,
        label: "Probe this corner",
        intent: "dm_prompt",
        prompt: `I inspect this town corner near grid (${x}, ${y}) and extract the most actionable local lead right now.`,
        payload: {
          board_feature: "town_probe",
          probe_point: { x, y },
        },
      },
    ];
    return {
      id: `town-miss-${x}-${y}`,
      kind: "miss_click",
      title: "Streetline Probe",
      subtitle: "Crowd movement, rumors, and pressure points.",
      description: "No direct hotspot selected. Choose a probe action before committing.",
      actions,
      interaction: { source: "miss_click", x, y },
    };
  }

  if (mode === "travel") {
    const travel = args.travel;
    const actions: MythicUiAction[] = [
      {
        id: `travel-probe-scout-${x}-${y}`,
        label: "Scout this route tile",
        intent: "dm_prompt",
        prompt: `I scout route tile (${x}, ${y}) and report immediate risk, opportunity, and tactical next step.`,
        payload: {
          travel_probe: "scout",
          travel_goal: travel?.travelGoal ?? "explore_wilds",
          search_target: travel?.searchTarget ?? null,
          discovery_flags: {
            from_board_probe: true,
            searching_for_dungeon: (travel?.searchTarget ?? null) === "dungeon" || travel?.dungeonTracesFound === true,
          },
          probe_point: { x, y },
        },
      },
      {
        id: `travel-probe-loot-${x}-${y}`,
        label: "Search for loot",
        intent: "dm_prompt",
        prompt: `I search route tile (${x}, ${y}) for salvage, cache indicators, and ambush signs before committing.`,
        payload: {
          travel_probe: "loot",
          travel_goal: travel?.travelGoal ?? "explore_wilds",
          search_target: travel?.searchTarget ?? null,
          discovery_flags: {
            from_board_probe: true,
            explicit_probe: true,
          },
          probe_point: { x, y },
        },
      },
    ];
    return {
      id: `travel-miss-${x}-${y}`,
      kind: "miss_click",
      title: "Route Probe",
      subtitle: "No segment selected. Pick an explicit route check.",
      actions,
      interaction: { source: "miss_click", x, y },
    };
  }

  if (mode === "dungeon") {
    const firstRoom = args.dungeon?.rooms[0]?.id ?? null;
    const actions: MythicUiAction[] = [
      {
        id: `dungeon-probe-${x}-${y}`,
        label: "Assess this chamber",
        intent: "dm_prompt",
        prompt: `I assess this dungeon position (${x}, ${y}) for danger signals, exits, and leverage.`,
        payload: {
          room_id: firstRoom,
          action: "assess_room",
          probe_point: { x, y },
        },
      },
      {
        id: `dungeon-trap-sweep-${x}-${y}`,
        label: "Sweep for traps",
        intent: "dm_prompt",
        prompt: `I run a focused trap sweep around dungeon point (${x}, ${y}) and map the safe path forward.`,
        payload: {
          room_id: firstRoom,
          action: "disarm_traps",
          probe_point: { x, y },
        },
      },
    ];
    return {
      id: `dungeon-miss-${x}-${y}`,
      kind: "miss_click",
      title: "Dark Corner",
      subtitle: "No room hotspot selected.",
      actions,
      interaction: { source: "miss_click", x, y },
    };
  }

  const activeEnemy = args.combat?.combatants.find((entry) => entry.id === args.combat?.activeTurnCombatantId)
    ?? args.combat?.combatants.find((entry) => entry.entity_type !== "player" && entry.is_alive)
    ?? null;
  const actions: MythicUiAction[] = [
    {
      id: `combat-read-${x}-${y}`,
      label: "Request tactical read",
      intent: "dm_prompt",
      prompt: `Give me a tactical read at grid (${x}, ${y}) with immediate action economy priorities.`,
      payload: {
        board_feature: "combat_probe",
        probe_point: { x, y },
      },
    },
    ...(activeEnemy
      ? [
          {
            id: `combat-focus-${activeEnemy.id}`,
            label: `Focus ${activeEnemy.name}`,
            intent: "combat_action" as const,
            payload: {
              target_combatant_id: activeEnemy.id,
            },
            prompt: `I focus ${activeEnemy.name} and commit pressure on that threat.`,
          },
        ]
      : []),
  ];
  return {
    id: `combat-miss-${x}-${y}`,
    kind: "miss_click",
    title: "Battlefield Probe",
    subtitle: "No combatant selected.",
    actions,
    interaction: { source: "miss_click", x, y },
  };
}

export function buildTownVendorActions(vendor: { id: string; name: string; services: string[] }): MythicUiAction[] {
  const serviceLabel = vendor.services.slice(0, 2).join(", ");
  return [
    {
      id: `town-vendor-talk-${slugToken(vendor.id)}`,
      label: `Talk to ${vendor.name}`,
      intent: "dm_prompt",
      prompt: `I talk to ${vendor.name}${serviceLabel ? ` about ${serviceLabel}` : ""} and ask for leverage, local risks, and the most profitable immediate move.`,
      payload: {
        vendor_id: vendor.id,
        board_feature: "vendor",
      },
    },
    {
      id: `town-vendor-shop-${slugToken(vendor.id)}`,
      label: `Open ${vendor.name}`,
      intent: "shop_action",
      payload: {
        vendorId: vendor.id,
      },
      prompt: `I open ${vendor.name}'s stock and compare upgrades against current combat needs.`,
    },
  ];
}

export function buildTownNoticeBoardActions(jobPostings: Array<{ id: string; title: string; status: string }>): MythicUiAction[] {
  const openJob = jobPostings.find((entry) => entry.status === "open") ?? null;
  return [
    {
      id: "town-notice-read",
      label: "Read board postings",
      intent: "dm_prompt",
      prompt: "I review the notice board and prioritize one contract that aligns with current runtime pressure.",
      payload: {
        board_feature: "notice_board",
        job_action: "browse",
      },
    },
    ...(openJob
      ? [
          {
            id: `town-notice-accept-${slugToken(openJob.id)}`,
            label: `Accept: ${compactLabel(openJob.title, 32)}`,
            intent: "dm_prompt" as const,
            prompt: `I accept the posting "${openJob.title}" and lock in the next operational move.`,
            payload: {
              board_feature: "notice_board",
              job_action: "accept",
              job_posting_id: openJob.id,
            },
          },
        ]
      : []),
    {
      id: "town-notice-open-quests",
      label: "Open quest ledger",
      intent: "open_panel",
      panel: "quests",
    },
  ];
}

export function buildTownGateActions(): MythicUiAction[] {
  return [
    {
      id: "town-gate-depart",
      label: "Depart town",
      intent: "quest_action",
      boardTarget: "travel",
      payload: {
        mode: "travel",
        travel_goal: "explore_wilds",
      },
      prompt: "I leave town and move to overland travel with explicit tactical intent.",
    },
  ];
}

export function buildTravelSegmentActions(args: {
  segmentId: string;
  segmentName: string;
  terrain: string;
  travelGoal: string;
  searchTarget: string | null;
  dungeonTracesFound: boolean;
}): MythicUiAction[] {
  const basePayload = {
    travel_goal: args.travelGoal,
    search_target: args.searchTarget,
    discovery_flags: {
      searching_for_dungeon: args.searchTarget === "dungeon" || args.dungeonTracesFound,
      from_board_probe: true,
    },
    segment_id: args.segmentId,
  };
  return [
    {
      id: `travel-segment-scout-${slugToken(args.segmentId)}`,
      label: `Scout ${args.segmentName}`,
      intent: "dm_prompt",
      prompt: `I scout ${args.segmentName} (${args.terrain}) and report the exact risk/reward profile for this leg.`,
      payload: {
        ...basePayload,
        travel_probe: "scout",
      },
    },
    {
      id: `travel-segment-loot-${slugToken(args.segmentId)}`,
      label: `Search ${args.segmentName}`,
      intent: "dm_prompt",
      prompt: `I search ${args.segmentName} for caches, traces, and ambush triggers before advancing.`,
      payload: {
        ...basePayload,
        travel_probe: "loot",
      },
    },
    {
      id: `travel-segment-risk-${slugToken(args.segmentId)}`,
      label: "Force an encounter check",
      intent: "dm_prompt",
      prompt: `I deliberately pressure ${args.segmentName} to force encounter clarity now instead of later.`,
      payload: {
        ...basePayload,
        travel_probe: "encounter",
        discovery_flags: {
          ...(basePayload.discovery_flags ?? {}),
          explicit_probe: true,
        },
      },
    },
  ];
}

export function buildTravelDungeonEntryActions(args: {
  travelGoal: string;
  searchTarget: string | null;
}): MythicUiAction[] {
  return [
    {
      id: "travel-dungeon-check",
      label: "Check for dungeon entry",
      intent: "dm_prompt",
      prompt: "I investigate nearby traces and verify whether this is a viable dungeon entry point right now.",
      payload: {
        travel_probe: "scout",
        travel_goal: args.travelGoal,
        search_target: args.searchTarget ?? "dungeon",
        discovery_flags: {
          searching_for_dungeon: true,
          explicit_probe: true,
        },
      },
    },
    {
      id: "travel-enter-dungeon",
      label: "Enter dungeon mode",
      intent: "quest_action",
      boardTarget: "dungeon",
      payload: {
        mode: "dungeon",
        travel_goal: "enter_dungeon",
        search_target: "dungeon",
      },
    },
  ];
}

export function buildTravelReturnTownActions(): MythicUiAction[] {
  return [
    {
      id: "travel-return-town",
      label: "Return to town",
      intent: "quest_action",
      boardTarget: "town",
      payload: {
        mode: "town",
        travel_goal: "return_town",
      },
      prompt: "I return to town, cash out field intel, and reset pressure.",
    },
  ];
}

export function buildDungeonRoomActions(args: {
  roomId: string;
  roomName: string;
  roomStatus: string | null;
}): MythicUiAction[] {
  return [
    {
      id: `dungeon-room-assess-${slugToken(args.roomId)}`,
      label: `Assess ${args.roomName}`,
      intent: "dm_prompt",
      prompt: `I assess ${args.roomName} and extract immediate threats, resources, and tactical routes.`,
      payload: {
        room_id: args.roomId,
        action: "assess_room",
      },
    },
    {
      id: `dungeon-room-search-${slugToken(args.roomId)}`,
      label: "Search room",
      intent: "dm_prompt",
      prompt: `I sweep ${args.roomName} for hidden caches, traps, and enemy staging signals.`,
      payload: {
        room_id: args.roomId,
        action: args.roomStatus === "looted" ? "study_puzzle" : "loot_cache",
      },
    },
    {
      id: `dungeon-room-secure-${slugToken(args.roomId)}`,
      label: "Secure room",
      intent: "dm_prompt",
      prompt: `I secure ${args.roomName} and neutralize trap vectors before we advance.`,
      payload: {
        room_id: args.roomId,
        action: "disarm_traps",
      },
    },
  ];
}

export function buildDungeonDoorActions(args: {
  fromRoomId: string;
  toRoomId: string;
  toRoomName: string;
}): MythicUiAction[] {
  return [
    {
      id: `dungeon-door-${slugToken(args.fromRoomId)}-${slugToken(args.toRoomId)}`,
      label: `Open to ${args.toRoomName}`,
      intent: "dm_prompt",
      prompt: `I open the route from ${args.fromRoomId} to ${args.toRoomName} and commit to controlled entry.`,
      payload: {
        room_id: args.fromRoomId,
        to_room_id: args.toRoomId,
        action: "open_door",
      },
    },
  ];
}

export function buildDungeonFeatureActions(args: {
  roomId: string | null;
  feature: "trap" | "chest" | "altar" | "puzzle";
}): MythicUiAction[] {
  const featureAction = args.feature === "trap"
    ? "disarm_traps"
    : args.feature === "chest"
      ? "loot_cache"
      : args.feature === "altar"
        ? "study_altar"
        : "study_puzzle";
  const promptFeature = args.feature.replace(/_/g, " ");
  return [
    {
      id: `dungeon-feature-${args.feature}-${slugToken(args.roomId ?? "room")}`,
      label: `Interact: ${promptFeature}`,
      intent: "dm_prompt",
      prompt: `I interact with this ${promptFeature} and resolve immediate consequences from committed dungeon state.`,
      payload: {
        room_id: args.roomId,
        action: featureAction,
      },
    },
  ];
}

export function buildCombatantActions(args: {
  combatantId: string;
  combatantName: string;
  isFocused: boolean;
}): MythicUiAction[] {
  return [
    {
      id: `combat-focus-${slugToken(args.combatantId)}`,
      label: args.isFocused ? `Maintain focus: ${args.combatantName}` : `Focus ${args.combatantName}`,
      intent: "combat_action",
      payload: {
        target_combatant_id: args.combatantId,
      },
      prompt: `I focus ${args.combatantName} and align the next strike to that target.`,
    },
    {
      id: `combat-prompt-${slugToken(args.combatantId)}`,
      label: `Pressure ${args.combatantName}`,
      intent: "dm_prompt",
      prompt: `I pressure ${args.combatantName}. Narrate the best tactical sequence from current board state.`,
      payload: {
        board_feature: "combat_target",
        target_combatant_id: args.combatantId,
      },
    },
  ];
}

export function buildTownFallbackActions(data: TownSceneData): MythicUiAction[] {
  const vendor = data.vendors[0] ?? null;
  return dedupeBoardActions([
    ...(vendor ? buildTownVendorActions(vendor) : []),
    ...buildTownNoticeBoardActions(data.jobPostings),
    ...buildTownGateActions(),
  ], 6);
}

export function buildTravelFallbackActions(data: TravelSceneData): MythicUiAction[] {
  const segment = data.routeSegments[0] ?? null;
  return dedupeBoardActions([
    ...(segment
      ? buildTravelSegmentActions({
          segmentId: segment.id,
          segmentName: segment.name,
          terrain: segment.terrain,
          travelGoal: data.travelGoal,
          searchTarget: data.searchTarget,
          dungeonTracesFound: data.dungeonTracesFound,
        })
      : []),
    ...buildTravelDungeonEntryActions({
      travelGoal: data.travelGoal,
      searchTarget: data.searchTarget,
    }),
    ...buildTravelReturnTownActions(),
  ], 6);
}

export function buildDungeonFallbackActions(data: DungeonSceneData): MythicUiAction[] {
  const firstRoom = data.rooms[0] ?? null;
  return dedupeBoardActions([
    ...(firstRoom
      ? buildDungeonRoomActions({
          roomId: firstRoom.id,
          roomName: firstRoom.name,
          roomStatus: typeof data.roomState[firstRoom.id] === "object"
            ? String((data.roomState[firstRoom.id] as Record<string, unknown>).status ?? "") || null
            : null,
        })
      : []),
    ...buildDungeonFeatureActions({ roomId: firstRoom?.id ?? null, feature: "trap" }),
    ...buildDungeonFeatureActions({ roomId: firstRoom?.id ?? null, feature: "chest" }),
  ], 6);
}

export function buildCombatFallbackActions(data: CombatSceneData): MythicUiAction[] {
  const active = data.combatants.find((entry) => entry.id === data.activeTurnCombatantId) ?? null;
  const firstEnemy = data.combatants.find((entry) => entry.entity_type !== "player" && entry.is_alive) ?? null;
  const combatantForFocus = active && active.entity_type !== "player" ? active : firstEnemy;
  const quickCast = data.quickCast.find((entry) => entry.usableNow) ?? null;

  return dedupeBoardActions([
    ...(combatantForFocus
      ? buildCombatantActions({
          combatantId: combatantForFocus.id,
          combatantName: combatantForFocus.name,
          isFocused: data.focusedCombatantId === combatantForFocus.id,
        })
      : []),
    ...(quickCast
      ? [
          {
            id: `combat-quick-cast-${slugToken(quickCast.skillId)}`,
            label: `Quick cast ${quickCast.name}`,
            intent: "dm_prompt" as const,
            prompt: `Use ${quickCast.name} immediately and narrate the committed tactical result.`,
            payload: {
              quick_cast_skill_id: quickCast.skillId,
              quick_cast_targeting: quickCast.targeting,
              board_feature: "quick_cast",
            },
          },
        ]
      : []),
    {
      id: "combat-open-panel",
      label: "Open combat controls",
      intent: "open_panel",
      panel: "combat",
    },
    {
      id: "combat-refresh",
      label: "Refresh combat state",
      intent: "refresh",
      prompt: "Refresh combat state and narrate tactical deltas.",
    },
  ], 6);
}

export function buildModeFallbackActions(args: {
  mode: NarrativeBoardMode;
  town?: TownSceneData;
  travel?: TravelSceneData;
  dungeon?: DungeonSceneData;
  combat?: CombatSceneData;
}): MythicUiAction[] {
  if (args.mode === "town" && args.town) return buildTownFallbackActions(args.town);
  if (args.mode === "travel" && args.travel) return buildTravelFallbackActions(args.travel);
  if (args.mode === "dungeon" && args.dungeon) return buildDungeonFallbackActions(args.dungeon);
  if (args.mode === "combat" && args.combat) return buildCombatFallbackActions(args.combat);

  return [
    {
      id: `fallback-${args.mode}`,
      label: `Press ${formatMode(args.mode)} context`,
      intent: "dm_prompt",
      prompt: `I press the ${args.mode} context and request the next authoritative move.`,
    },
  ];
}
