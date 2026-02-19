import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { rngInt, rngPick } from "../shared/mythic_rng.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  toBoardType: z.enum(["town", "travel", "dungeon", "combat"]),
  reason: z.string().max(200).optional(),
  payload: z.record(z.unknown()).optional(),
});

type TemplateKey =
  | "custom"
  | "graphic_novel_fantasy"
  | "sci_fi_ruins"
  | "post_apoc_warlands"
  | "gothic_horror"
  | "mythic_chaos"
  | "dark_mythic_horror"
  | "post_apocalypse";

interface WorldProfile {
  seed_title: string;
  seed_description: string;
  template_key: TemplateKey;
  world_profile_json: Record<string, unknown>;
}

interface ContinuityState {
  seed: number | null;
  rumors: unknown[];
  discovery_log: unknown[];
  consequence_flags: Record<string, unknown>;
  objectives: unknown[];
  persistent_flags: Record<string, unknown>;
  factions_present: unknown[];
  travel_goal: string | null;
  search_target: string | null;
  discovery_flags: Record<string, unknown>;
  companion_checkins: unknown[];
}

interface CompanionState {
  companion_id: string;
  name: string;
  archetype: string;
  voice: string;
  mood: string;
  cadence_turns: number;
  urgency_bias: number;
  metadata: Record<string, unknown>;
}

const syllableA = [
  "Ash",
  "Iron",
  "Dus",
  "Grim",
  "Stone",
  "Glen",
  "Oath",
  "Hex",
  "Rift",
  "Wolf",
  "Black",
  "Silver",
];
const syllableB = [
  "hold",
  "bridge",
  "hollow",
  "reach",
  "mark",
  "port",
  "spire",
  "vale",
  "cross",
  "ford",
  "fall",
  "gate",
];

const templateTerrains: Record<TemplateKey, string[]> = {
  custom: ["road", "forest", "ridge", "bog", "ruins"],
  graphic_novel_fantasy: ["kingroad", "emerald_woods", "cliffpass", "ancient_waystones", "ruined_watchpost"],
  sci_fi_ruins: ["alloy_flats", "broken_magrail", "rad_glass", "relay_wreck", "vault_approach"],
  post_apoc_warlands: ["ash_dune", "wreckfield", "toxic_marsh", "scrap_canyon", "war_road"],
  gothic_horror: ["grave_road", "mist_moor", "thorn_wood", "abbey_ruin", "cathedral_steps"],
  mythic_chaos: ["fracture_plain", "rift_bridge", "storm_cradle", "echo_glade", "chaos_spires"],
  dark_mythic_horror: ["black_fen", "moonless_heath", "crypt_trench", "boneway", "omenscar"],
  post_apocalypse: ["dust_highway", "collapsed_suburb", "rust_channel", "scorchline", "radio_tower_trail"],
};

const templateWeather: Record<TemplateKey, string[]> = {
  custom: ["clear", "wind", "rain", "dust", "storm"],
  graphic_novel_fantasy: ["clear", "golden_mist", "wind", "storm"],
  sci_fi_ruins: ["ion_wind", "acid_rain", "smog", "electro_storm"],
  post_apoc_warlands: ["dust", "ashfall", "heat_haze", "storm"],
  gothic_horror: ["fog", "drizzle", "cold_wind", "thunder"],
  mythic_chaos: ["rift_static", "mana_storm", "chaos_rain", "clear"],
  dark_mythic_horror: ["blood_mist", "funeral_rain", "black_wind", "fog"],
  post_apocalypse: ["dust", "acid_rain", "clear", "storm"],
};

const templateServices: Record<TemplateKey, string[]> = {
  custom: ["inn", "healer", "notice_board"],
  graphic_novel_fantasy: ["inn", "apothecary", "guild_board"],
  sci_fi_ruins: ["repair_bay", "med_station", "contract_board"],
  post_apoc_warlands: ["scrap_trade", "field_medic", "bounty_board"],
  gothic_horror: ["apothecary", "chapel", "whispers_board"],
  mythic_chaos: ["rift_forge", "oracle_den", "chaos_board"],
  dark_mythic_horror: ["grave_chapel", "hex_alchemist", "omens_board"],
  post_apocalypse: ["salvage_shop", "clinic", "job_board"],
};

function nowIso() {
  return new Date().toISOString();
}

function hashSeed(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 2_147_483_647;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function uniqueUnknownArray(values: unknown[]): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function makeName(seed: number, label: string): string {
  const a = rngPick(seed, `${label}:a`, syllableA);
  const b = rngPick(seed, `${label}:b`, syllableB);
  return `${a}${b}`;
}

function normalizeTemplate(value: unknown): TemplateKey {
  const raw = typeof value === "string" ? value.trim() : "";
  if (
    raw === "custom" ||
    raw === "graphic_novel_fantasy" ||
    raw === "sci_fi_ruins" ||
    raw === "post_apoc_warlands" ||
    raw === "gothic_horror" ||
    raw === "mythic_chaos" ||
    raw === "dark_mythic_horror" ||
    raw === "post_apocalypse"
  ) {
    return raw;
  }
  return "custom";
}

function normalizeReasonCode(value: string): string {
  const raw = value.startsWith("narrative:") ? value.slice("narrative:".length) : value;
  const token = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token.length > 0 ? token : "story_progression";
}

function humanizeReason(value: string): string {
  const raw = value
    .replace(/^narrative:/, "")
    .replace(/^fallback-/, "")
    .replace(/^dm-action-/, "")
    .replace(/^transition_reason:/, "");
  const normalized = raw
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  if (!normalized) return "Story Progression";
  return normalized.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function normalizeDiscoveryEntry(entry: unknown): Record<string, unknown> | null {
  if (!entry) return null;
  if (typeof entry === "object" && !Array.isArray(entry)) {
    return entry as Record<string, unknown>;
  }
  if (typeof entry === "string") {
    const trimmed = entry.trim();
    if (!trimmed) return null;
    const prefixes: Array<{ key: string; kind: string }> = [
      { key: "transition_reason:", kind: "transition_reason" },
      { key: "travel_goal:", kind: "travel_goal" },
      { key: "search_target:", kind: "search_target" },
      { key: "probe:", kind: "probe" },
      { key: "encounter:", kind: "encounter" },
      { key: "treasure:", kind: "treasure" },
      { key: "dungeon_traces:", kind: "dungeon_traces" },
      { key: "board:", kind: "board" },
    ];
    for (const prefix of prefixes) {
      if (!trimmed.startsWith(prefix.key)) continue;
      const detail = trimmed.slice(prefix.key.length).replace(/_/g, " ").trim();
      return { kind: prefix.kind, detail };
    }
    return { kind: "note", detail: trimmed };
  }
  return null;
}

function mergeDiscoveryLog(base: unknown[], incoming: unknown[], maxItems: number): Record<string, unknown>[] {
  const merged = uniqueUnknownArray([...base, ...incoming])
    .map((entry) => normalizeDiscoveryEntry(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  return merged.slice(-maxItems);
}

function buildDynamicHooks(args: {
  seed: number;
  boardType: "town" | "travel" | "dungeon" | "combat";
  world: WorldProfile;
  factionNames: string[];
  tension: number;
}): { rumors: unknown[]; objectives: unknown[] } {
  const factionA = args.factionNames[0] ?? "an old faction";
  const factionB = args.factionNames[1] ?? factionA;
  const tensionTier = args.tension >= 0.7 ? "high" : args.tension >= 0.4 ? "rising" : "low";
  const boardLabel = args.boardType === "town" ? "gates" : args.boardType === "travel" ? "roads" : "depths";
  const rumorPool = [
    `${factionA} scouts were seen near the ${boardLabel}.`,
    `${factionB} is moving supplies under false colors.`,
    `A courier from ${args.world.seed_title} never reached the checkpoint.`,
    `The ${tensionTier} tension around ${args.world.seed_title} is drawing predators.`,
  ];
  const objectivePool = [
    { title: "Interrogate The Route", detail: `Trace ${factionA} movement and identify their next pressure point.` },
    { title: "Disrupt The Supply Chain", detail: `Cut ${factionB}'s logistics before their advantage compounds.` },
    { title: "Secure Forward Position", detail: "Claim a safe foothold and deny enemy reconnaissance." },
    { title: "Pressure The Instigator", detail: "Find who is escalating conflict and force a reaction." },
  ];

  const rumorA = rngPick(args.seed, `${args.boardType}:rumor:a`, rumorPool);
  const rumorB = rngPick(args.seed, `${args.boardType}:rumor:b`, rumorPool);
  const objectiveA = rngPick(args.seed, `${args.boardType}:objective:a`, objectivePool);
  return {
    rumors: uniqueUnknownArray([rumorA, rumorB]),
    objectives: uniqueUnknownArray([
      {
        ...objectiveA,
        source: "dynamic_board_generator",
        tension_tier: tensionTier,
      },
    ]),
  };
}

function buildCompanionPresence(companions: CompanionState[]): Array<Record<string, unknown>> {
  return companions.slice(0, 6).map((companion) => ({
    companion_id: companion.companion_id,
    name: companion.name,
    archetype: companion.archetype,
    mood: companion.mood,
  }));
}

function readContinuity(activeState: Record<string, unknown> | null): ContinuityState {
  const state = activeState ?? {};
  const consequenceFlags = asRecord(state.consequence_flags);
  const persistentFlags = asRecord(state.persistent_flags);
  const discoveryFlags = asRecord(state.discovery_flags);
  return {
    seed: typeof state.seed === "number" ? Number(state.seed) : null,
    rumors: asArray(state.rumors),
    discovery_log: asArray(state.discovery_log),
    consequence_flags: consequenceFlags,
    objectives: asArray(state.objectives),
    persistent_flags: persistentFlags,
    factions_present: asArray(state.factions_present),
    travel_goal: typeof state.travel_goal === "string" ? state.travel_goal : null,
    search_target: typeof state.search_target === "string" ? state.search_target : null,
    discovery_flags: discoveryFlags,
    companion_checkins: asArray(state.companion_checkins),
  };
}

function pickFactionNames(seed: number, factionNames: string[], maxCount: number, label: string): string[] {
  if (factionNames.length === 0) return [];
  if (factionNames.length <= maxCount) return factionNames;
  const shuffled = [...factionNames];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = rngInt(seed, `${label}:${i}`, 0, i);
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }
  return shuffled.slice(0, maxCount);
}

function resolveSearchTarget(payload: Record<string, unknown>, continuity: ContinuityState): string | null {
  if (typeof payload.search_target === "string" && payload.search_target.trim().length > 0) {
    return payload.search_target.trim().toLowerCase();
  }
  return continuity.search_target;
}

function resolveTravelGoal(payload: Record<string, unknown>, continuity: ContinuityState, fallback: string): string {
  if (typeof payload.travel_goal === "string" && payload.travel_goal.trim().length > 0) {
    return payload.travel_goal.trim().toLowerCase();
  }
  if (continuity.travel_goal && continuity.travel_goal.trim().length > 0) {
    return continuity.travel_goal.trim().toLowerCase();
  }
  return fallback;
}

function buildTownState(args: {
  seed: number;
  world: WorldProfile;
  continuity: ContinuityState;
  factionNames: string[];
  tension: number;
  companions: CompanionState[];
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const { seed, world, continuity, factionNames, tension, companions, payload } = args;
  const vendorCount = rngInt(seed, "town:vendors", 2, 5);
  const services = templateServices[world.template_key] ?? templateServices.custom;
  const dynamicHooks = buildDynamicHooks({
    seed,
    boardType: "town",
    world,
    factionNames,
    tension,
  });
  const vendors = Array.from({ length: vendorCount }).map((_, idx) => ({
    id: `vendor_${idx + 1}`,
    name: makeName(seed, `town:vendor:${idx}`),
    services: rngPick(seed, `town:vendor:svc:${idx}`, [
      services.slice(0, 2),
      services.slice(-2),
      [...services],
    ]),
  }));

  return {
    seed,
    template_key: world.template_key,
    world_seed: {
      title: world.seed_title,
      description: world.seed_description,
    },
    vendors,
    services,
    gossip: asArray(payload.gossip).length > 0 ? asArray(payload.gossip) : [],
    rumors: uniqueUnknownArray([...continuity.rumors, ...dynamicHooks.rumors, ...asArray(payload.rumors)]).slice(-24),
    factions_present: uniqueUnknownArray([
      ...pickFactionNames(seed, factionNames, 4, "town:factions"),
      ...continuity.factions_present,
    ]).slice(0, 6),
    guard_alertness: Math.max(
      0,
      Math.min(
        1,
        Number(payload.guard_alertness ?? continuity.consequence_flags.guard_alertness ?? rngInt(seed, "town:guard", 20, 72) / 100),
      ),
    ),
    bounties: asArray(payload.bounties),
    objectives: uniqueUnknownArray([...continuity.objectives, ...dynamicHooks.objectives, ...asArray(payload.objectives)]).slice(-16),
    consequence_flags: {
      ...continuity.consequence_flags,
      ...asRecord(payload.consequence_flags),
    },
    persistent_flags: {
      ...continuity.persistent_flags,
      ...asRecord(payload.persistent_flags),
    },
    discovery_flags: {
      ...continuity.discovery_flags,
      ...asRecord(payload.discovery_flags),
    },
    discovery_log: mergeDiscoveryLog(continuity.discovery_log, asArray(payload.discovery_log), 40),
    companion_presence: buildCompanionPresence(companions),
    companion_checkins: uniqueUnknownArray([...continuity.companion_checkins, ...asArray(payload.companion_checkins)]).slice(-24),
  };
}

function buildTravelState(args: {
  seed: number;
  world: WorldProfile;
  continuity: ContinuityState;
  factionNames: string[];
  reasonCode: string;
  reasonLabel: string;
  tension: number;
  companions: CompanionState[];
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const { seed, world, continuity, factionNames, reasonCode, reasonLabel, tension, companions, payload } = args;
  const terrains = templateTerrains[world.template_key] ?? templateTerrains.custom;
  const weatherPool = templateWeather[world.template_key] ?? templateWeather.custom;
  const weather = rngPick(seed, "travel:weather", weatherPool);
  const segmentCount = rngInt(seed, "travel:segments", 4, 8);
  const travelGoal = resolveTravelGoal(payload, continuity, "explore_wilds");
  const searchTarget = resolveSearchTarget(payload, continuity);
  const probeKind = typeof payload.travel_probe === "string" ? payload.travel_probe.toLowerCase() : null;
  const explicitProbe = Boolean(probeKind);
  const dynamicHooks = buildDynamicHooks({
    seed,
    boardType: "travel",
    world,
    factionNames,
    tension,
  });

  const routeSegments = Array.from({ length: segmentCount }).map((_, i) => ({
    id: `seg_${i + 1}`,
    name: makeName(seed, `travel:segment:${i}`),
    terrain: rngPick(seed, `travel:terrain:${i}`, terrains),
    danger: rngInt(seed, `travel:danger:${i}`, 1, 7),
  }));
  const encounterSeeds = routeSegments.map((_, i) => rngInt(seed, `travel:encounter:${i}`, 1000, 9999));
  const encounterRoll = rngInt(seed, "travel:encounter:roll", 1, 100);
  const treasureRoll = rngInt(seed, "travel:treasure:roll", 1, 100);
  const dungeonTraceRoll = rngInt(seed, "travel:dungeon_trace:roll", 1, 100);
  const encounterTriggered = explicitProbe ? encounterRoll <= 74 : encounterRoll <= 46;
  const treasureTriggered = explicitProbe ? treasureRoll <= 66 : treasureRoll <= 34;
  const dungeonTracesFound =
    searchTarget === "dungeon"
      ? (explicitProbe ? dungeonTraceRoll <= 72 : dungeonTraceRoll <= 48)
      : false;

  const discoveryFlags = {
    ...continuity.discovery_flags,
    ...asRecord(payload.discovery_flags),
    encounter_triggered: encounterTriggered,
    treasure_triggered: treasureTriggered,
    dungeon_traces_found: dungeonTracesFound,
  };

  const discoveryLines: unknown[] = [
    { kind: "transition_reason", detail: reasonLabel, reason_code: reasonCode },
    { kind: "travel_goal", detail: travelGoal },
    { kind: "search_target", detail: searchTarget ?? "none" },
    { kind: "probe", detail: explicitProbe ? probeKind : "passive" },
    { kind: "encounter", detail: encounterTriggered ? "triggered" : "none" },
    { kind: "treasure", detail: treasureTriggered ? "triggered" : "none" },
    { kind: "dungeon_traces", detail: dungeonTracesFound ? "found" : "none" },
  ];

  return {
    seed,
    template_key: world.template_key,
    world_seed: {
      title: world.seed_title,
      description: world.seed_description,
    },
    terrain_bands: terrains,
    weather,
    route_style: world.template_key,
    travel_goal: travelGoal,
    search_target: searchTarget,
    route_segments: routeSegments,
    hazard_meter: rngInt(seed, "travel:hazard", 1, 10),
    scouting: { advantage: rngInt(seed, "travel:scout", 0, 3) },
    encounter_seeds: encounterSeeds,
    encounter_roll: encounterRoll,
    treasure_roll: treasureRoll,
    dungeon_trace_roll: dungeonTraceRoll,
    encounter_triggered: encounterTriggered,
    treasure_triggered: treasureTriggered,
    encounter_type: encounterTriggered
      ? rngPick(seed, "travel:encounter:type", ["bandits", "beast_pack", "rival_scouts", "ruin_wardens", "faction_ambush"])
      : null,
    treasure_type: treasureTriggered
      ? rngPick(seed, "travel:treasure:type", ["cache", "supply_crate", "forgotten_relic", "coin_stash", "sealed_map"])
      : null,
    dungeon_traces_found: dungeonTracesFound,
    faction_markers: pickFactionNames(seed, factionNames, 3, "travel:faction_markers"),
    rumors: uniqueUnknownArray([...continuity.rumors, ...dynamicHooks.rumors, ...asArray(payload.rumors)]).slice(-24),
    objectives: uniqueUnknownArray([...continuity.objectives, ...dynamicHooks.objectives, ...asArray(payload.objectives)]).slice(-16),
    consequence_flags: {
      ...continuity.consequence_flags,
      ...asRecord(payload.consequence_flags),
    },
    persistent_flags: {
      ...continuity.persistent_flags,
      ...asRecord(payload.persistent_flags),
    },
    discovery_flags: discoveryFlags,
    discovery_log: mergeDiscoveryLog(continuity.discovery_log, [...discoveryLines, ...asArray(payload.discovery_log)], 48),
    transition_reason: reasonLabel,
    transition_reason_code: reasonCode,
    companion_presence: buildCompanionPresence(companions),
    companion_checkins: uniqueUnknownArray([...continuity.companion_checkins, ...asArray(payload.companion_checkins)]).slice(-24),
  };
}

function buildDungeonState(args: {
  seed: number;
  world: WorldProfile;
  continuity: ContinuityState;
  factionNames: string[];
  tension: number;
  companions: CompanionState[];
  payload: Record<string, unknown>;
}): Record<string, unknown> {
  const { seed, world, continuity, factionNames, tension, companions, payload } = args;
  const dynamicHooks = buildDynamicHooks({
    seed,
    boardType: "dungeon",
    world,
    factionNames,
    tension,
  });
  const roomCount = rngInt(seed, "dungeon:rooms", 6, 11);
  const rooms = Array.from({ length: roomCount }).map((_, i) => ({
    id: `room_${i + 1}`,
    name: makeName(seed, `dungeon:room:${i}`),
    tags: [rngPick(seed, `dungeon:tag:${i}`, ["trap", "altar", "lair", "cache", "puzzle", "vault"])],
    danger: rngInt(seed, `dungeon:danger:${i}`, 1, 6),
  }));
  const edges = rooms.slice(1).map((room, i) => ({
    from: rooms[i]!.id,
    to: room.id,
  }));

  return {
    seed,
    template_key: world.template_key,
    world_seed: {
      title: world.seed_title,
      description: world.seed_description,
    },
    room_graph: { rooms, edges },
    fog_of_war: { revealed: [rooms[0]!.id] },
    trap_signals: rngInt(seed, "dungeon:traps", 1, 5),
    loot_nodes: rngInt(seed, "dungeon:loot", 1, 6),
    faction_presence: pickFactionNames(seed, factionNames, 2, "dungeon:factions"),
    rumors: uniqueUnknownArray([...continuity.rumors, ...dynamicHooks.rumors, ...asArray(payload.rumors)]).slice(-24),
    objectives: uniqueUnknownArray([...continuity.objectives, ...dynamicHooks.objectives, ...asArray(payload.objectives)]).slice(-16),
    consequence_flags: {
      ...continuity.consequence_flags,
      ...asRecord(payload.consequence_flags),
    },
    persistent_flags: {
      ...continuity.persistent_flags,
      ...asRecord(payload.persistent_flags),
    },
    discovery_flags: {
      ...continuity.discovery_flags,
      ...asRecord(payload.discovery_flags),
      entered_dungeon: true,
    },
    discovery_log: mergeDiscoveryLog(
      continuity.discovery_log,
      [{ kind: "board", detail: "dungeon" }, ...asArray(payload.discovery_log)],
      48,
    ),
    travel_goal: "enter_dungeon",
    search_target: resolveSearchTarget(payload, continuity) ?? "dungeon",
    companion_presence: buildCompanionPresence(companions),
    companion_checkins: uniqueUnknownArray([...continuity.companion_checkins, ...asArray(payload.companion_checkins)]).slice(-24),
  };
}

async function loadWorldProfile(
  svc: ReturnType<typeof createServiceClient>,
  campaignId: string,
): Promise<WorldProfile> {
  const primary = await svc
    .schema("mythic")
    .from("world_profiles")
    .select("seed_title, seed_description, template_key, world_profile_json")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (primary.data) {
    return {
      seed_title: String((primary.data as any).seed_title ?? "Mythic Campaign"),
      seed_description: String((primary.data as any).seed_description ?? "A dangerous world in motion."),
      template_key: normalizeTemplate((primary.data as any).template_key),
      world_profile_json: asRecord((primary.data as any).world_profile_json),
    };
  }

  const fallback = await svc
    .schema("mythic")
    .from("campaign_world_profiles")
    .select("seed_title, seed_description, template_key, world_profile_json")
    .eq("campaign_id", campaignId)
    .maybeSingle();

  if (fallback.data) {
    return {
      seed_title: String((fallback.data as any).seed_title ?? "Mythic Campaign"),
      seed_description: String((fallback.data as any).seed_description ?? "A dangerous world in motion."),
      template_key: normalizeTemplate((fallback.data as any).template_key),
      world_profile_json: asRecord((fallback.data as any).world_profile_json),
    };
  }

  return {
    seed_title: "Mythic Campaign",
    seed_description: "A dangerous world in motion.",
    template_key: "custom",
    world_profile_json: {},
  };
}

async function loadFactions(
  svc: ReturnType<typeof createServiceClient>,
  campaignId: string,
): Promise<Array<{ id: string; name: string; tags: string[] }>> {
  const { data, error } = await svc
    .schema("mythic")
    .from("factions")
    .select("id,name,tags")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return (data as any[])
    .filter((row) => typeof row.id === "string" && typeof row.name === "string")
    .map((row) => ({
      id: row.id as string,
      name: row.name as string,
      tags: Array.isArray(row.tags) ? row.tags.filter((entry: unknown): entry is string => typeof entry === "string") : [],
    }));
}

async function loadCompanions(
  svc: ReturnType<typeof createServiceClient>,
  campaignId: string,
): Promise<CompanionState[]> {
  const { data, error } = await svc
    .schema("mythic")
    .from("campaign_companions")
    .select("companion_id,name,archetype,voice,mood,cadence_turns,urgency_bias,metadata")
    .eq("campaign_id", campaignId)
    .order("companion_id", { ascending: true });
  if (error || !data) return [];
  return (data as any[])
    .filter((row) => typeof row.companion_id === "string" && typeof row.name === "string")
    .map((row) => ({
      companion_id: row.companion_id as string,
      name: row.name as string,
      archetype: typeof row.archetype === "string" ? row.archetype : "scout",
      voice: typeof row.voice === "string" ? row.voice : "dry",
      mood: typeof row.mood === "string" ? row.mood : "steady",
      cadence_turns: Number.isFinite(Number(row.cadence_turns)) ? Number(row.cadence_turns) : 3,
      urgency_bias: Number.isFinite(Number(row.urgency_bias)) ? Number(row.urgency_bias) : 0.5,
      metadata: asRecord(row.metadata),
    }));
}

function chooseFactionForOutcome(
  factions: Array<{ id: string; name: string; tags: string[] }>,
  reason: string,
): { id: string; name: string } | null {
  if (factions.length === 0) return null;
  const lowerReason = reason.toLowerCase();
  if (lowerReason.includes("steal")) {
    const guardFaction = factions.find((f) =>
      /guard|watch|order|warden/.test(f.name.toLowerCase()) || f.tags.some((tag) => /guard|watch|order|warden/.test(tag.toLowerCase()))
    );
    if (guardFaction) return { id: guardFaction.id, name: guardFaction.name };
  }
  if (lowerReason.includes("shop")) {
    const merchantFaction = factions.find((f) =>
      /merchant|trade|guild|market/.test(f.name.toLowerCase()) || f.tags.some((tag) => /merchant|trade|guild|market/.test(tag.toLowerCase()))
    );
    if (merchantFaction) return { id: merchantFaction.id, name: merchantFaction.name };
  }
  return { id: factions[0]!.id, name: factions[0]!.name };
}

async function appendMemoryEvent(args: {
  svc: ReturnType<typeof createServiceClient>;
  campaignId: string;
  playerId: string;
  category: string;
  severity: number;
  payload: Record<string, unknown>;
}) {
  const { error } = await args.svc.schema("mythic").from("dm_memory_events").insert({
    campaign_id: args.campaignId,
    player_id: args.playerId,
    category: args.category,
    severity: clampInt(args.severity, 1, 5),
    payload: args.payload,
  });
  if (error) throw error;
}

async function applyReputationDelta(args: {
  svc: ReturnType<typeof createServiceClient>;
  campaignId: string;
  playerId: string;
  factionId: string;
  delta: number;
  severity: number;
  evidence: Record<string, unknown>;
}) {
  if (args.delta === 0) return;

  const { error: repEventError } = await args.svc
    .schema("mythic")
    .from("reputation_events")
    .insert({
      campaign_id: args.campaignId,
      faction_id: args.factionId,
      player_id: args.playerId,
      severity: clampInt(args.severity, 1, 5),
      delta: clampInt(args.delta, -1000, 1000),
      evidence: args.evidence,
    });
  if (repEventError) throw repEventError;

  const currentRepQuery = await args.svc
    .schema("mythic")
    .from("faction_reputation")
    .select("rep")
    .eq("campaign_id", args.campaignId)
    .eq("faction_id", args.factionId)
    .eq("player_id", args.playerId)
    .maybeSingle();
  if (currentRepQuery.error) throw currentRepQuery.error;
  const currentRep = Number((currentRepQuery.data as any)?.rep ?? 0);
  const nextRep = clampInt(currentRep + args.delta, -1000, 1000);
  const { error: upsertError } = await args.svc
    .schema("mythic")
    .from("faction_reputation")
    .upsert(
      {
        campaign_id: args.campaignId,
        faction_id: args.factionId,
        player_id: args.playerId,
        rep: nextRep,
        updated_at: nowIso(),
      },
      { onConflict: "campaign_id,faction_id,player_id" },
    );
  if (upsertError) throw upsertError;
}

export const mythicBoardTransition: FunctionHandler = {
  name: "mythic-board-transition",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const requestId = ctx.requestId;
    const baseHeaders = { "x-request-id": requestId, "Content-Type": "application/json" };

    try {
      const user = await requireUser(req.headers);

      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(
          JSON.stringify({ error: "Invalid request", code: "invalid_request", details: parsed.error.flatten(), requestId }),
          { status: 400, headers: baseHeaders },
        );
      }

      const { campaignId, toBoardType } = parsed.data;
      const rawReason = parsed.data.reason ?? "manual";
      const payload = asRecord(parsed.data.payload ?? {});
      const reasonCode = typeof payload.reason_code === "string"
        ? normalizeReasonCode(payload.reason_code)
        : normalizeReasonCode(rawReason);
      const reason = typeof payload.reason_label === "string"
        ? humanizeReason(payload.reason_label)
        : humanizeReason(rawReason);

      const svc = createServiceClient();
      await assertCampaignAccess(svc, campaignId, user.userId);

      const warnings: string[] = [];

      const world = await loadWorldProfile(svc, campaignId);
      const factions = await loadFactions(svc, campaignId);
      const companions = await loadCompanions(svc, campaignId);
      const factionNames = factions.map((f) => f.name);
      const tensionQuery = await svc
        .schema("mythic")
        .from("dm_world_tension")
        .select("tension")
        .eq("campaign_id", campaignId)
        .maybeSingle();
      if (tensionQuery.error) {
        warnings.push(`dm_world_tension:${tensionQuery.error.message ?? "unknown"}`);
      }
      const worldTension = Number((tensionQuery.data as { tension?: unknown } | null)?.tension ?? 0.25);

      const activeBoardsQuery = await svc
        .schema("mythic")
        .from("boards")
        .select("id, board_type, state_json, updated_at, combat_session_id")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false });
      if (activeBoardsQuery.error) throw activeBoardsQuery.error;

      const activeBoards = (activeBoardsQuery.data ?? []) as Array<Record<string, unknown>>;
      if (activeBoards.length > 1) {
        warnings.push("duplicate_active_boards_detected:archiving_old_rows");
      }
      const activeBoard = activeBoards[0] ?? null;
      const activeState = activeBoard ? asRecord(activeBoard.state_json) : {};
      const continuity = readContinuity(activeBoard ? activeState : null);
      const transitionCountQuery = await svc
        .schema("mythic")
        .from("board_transitions")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId);
      if (transitionCountQuery.error) throw transitionCountQuery.error;
      const transitionCount = Number(transitionCountQuery.count ?? 0);

      const worldSeedBase = Number(asRecord(world.world_profile_json).seed ?? Number.NaN);
      const seedBase = Number.isFinite(continuity.seed)
        ? Number(continuity.seed)
        : Number.isFinite(worldSeedBase)
          ? worldSeedBase
          : hashSeed(`${campaignId}:${reasonCode}:${toBoardType}`);
      const phaseOffset = toBoardType === "town" ? 1 : toBoardType === "travel" ? 2 : toBoardType === "dungeon" ? 3 : 4;
      const variationOffset = hashSeed(`${campaignId}:${reasonCode}:${transitionCount}`) % 5000;
      const seed = seedBase + phaseOffset + variationOffset;

      let nextState: Record<string, unknown>;
      if (toBoardType === "town") {
        nextState = buildTownState({ seed, world, continuity, factionNames, tension: worldTension, companions, payload });
      } else if (toBoardType === "travel") {
        nextState = buildTravelState({
          seed,
          world,
          continuity,
          factionNames,
          reasonCode,
          reasonLabel: reason,
          tension: worldTension,
          companions,
          payload,
        });
      } else if (toBoardType === "dungeon") {
        nextState = buildDungeonState({ seed, world, continuity, factionNames, tension: worldTension, companions, payload });
      } else {
        nextState = {
          ...activeState,
          ...payload,
          seed,
          template_key: world.template_key,
          world_seed: { title: world.seed_title, description: world.seed_description },
          companion_presence: buildCompanionPresence(companions),
          companion_checkins: uniqueUnknownArray([...continuity.companion_checkins, ...asArray(payload.companion_checkins)]).slice(-24),
        };
      }

      const archivedBoardIds = activeBoards
        .map((row) => (typeof row.id === "string" ? row.id : null))
        .filter((id): id is string => Boolean(id));
      if (archivedBoardIds.length > 0) {
        const { error: archiveError } = await svc
          .schema("mythic")
          .from("boards")
          .update({ status: "archived", updated_at: nowIso() })
          .in("id", archivedBoardIds);
        if (archiveError) throw archiveError;
      }

      const insertedBoard = await svc
        .schema("mythic")
        .from("boards")
        .insert({
          campaign_id: campaignId,
          board_type: toBoardType,
          status: "active",
          state_json: nextState,
          ui_hints_json: {
            camera: { x: 0, y: 0, zoom: 1.0 },
            board_theme: world.template_key,
          },
        })
        .select("id")
        .maybeSingle();
      if (insertedBoard.error) throw insertedBoard.error;

      const transitionPayload = {
        ...payload,
        reason_code: reasonCode,
        travel_goal: (nextState as any).travel_goal ?? null,
        travel_probe: (payload as any).travel_probe ?? null,
        search_target: (nextState as any).search_target ?? null,
        discovery_flags: asRecord((nextState as any).discovery_flags),
      };

      const { error: transitionError } = await svc
        .schema("mythic")
        .from("board_transitions")
        .insert({
          campaign_id: campaignId,
          from_board_type: typeof (activeBoard as any)?.board_type === "string" ? (activeBoard as any).board_type : null,
          to_board_type: toBoardType,
          reason,
          animation: "page_turn",
          payload_json: transitionPayload,
        });
      if (transitionError) throw transitionError;

      try {
        await appendMemoryEvent({
          svc,
          campaignId,
          playerId: user.userId,
          category: "board_transition",
          severity: 2,
          payload: {
            from_board_type: typeof (activeBoard as any)?.board_type === "string" ? (activeBoard as any).board_type : null,
            to_board_type: toBoardType,
            reason,
            transition_payload: transitionPayload,
            reason_code: reasonCode,
            board_id: (insertedBoard.data as any)?.id ?? null,
          },
        });
      } catch (error) {
        warnings.push(`dm_memory_events:${sanitizeError(error).message}`);
      }

      const factionTarget = chooseFactionForOutcome(factions, `${rawReason} ${reasonCode} ${reason}`);
      if (factionTarget) {
        const lowerReason = `${rawReason} ${reasonCode} ${reason}`.toLowerCase();
        let delta = 0;
        let severity = 1;
        if (lowerReason.includes("steal")) {
          delta = -8;
          severity = 3;
        } else if (lowerReason.includes("shop")) {
          delta = 3;
        } else if (toBoardType === "dungeon") {
          delta = 2;
        } else if (toBoardType === "travel" && Boolean(asRecord((nextState as any).discovery_flags).encounter_triggered)) {
          delta = -2;
          severity = 2;
        } else if (toBoardType === "travel" && Boolean(asRecord((nextState as any).discovery_flags).dungeon_traces_found)) {
          delta = 4;
          severity = 2;
        }

        if (delta !== 0) {
          try {
            await applyReputationDelta({
              svc,
              campaignId,
              playerId: user.userId,
              factionId: factionTarget.id,
              delta,
              severity,
              evidence: {
                reason,
                reason_code: reasonCode,
                to_board_type: toBoardType,
                transition_payload: transitionPayload,
                faction_name: factionTarget.name,
              },
            });
          } catch (error) {
            warnings.push(`reputation_update:${sanitizeError(error).message}`);
          }
        }
      }

      ctx.log.info("board_transition.success", {
        request_id: requestId,
        campaign_id: campaignId,
        to_board_type: toBoardType,
        warnings: warnings.length,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          board_id: (insertedBoard.data as any)?.id ?? null,
          board_type: toBoardType,
          reason_code: reasonCode,
          travel_goal: (nextState as any).travel_goal ?? null,
          search_target: (nextState as any).search_target ?? null,
          discovery_flags: asRecord((nextState as any).discovery_flags),
          warnings,
          requestId,
        }),
        { status: 200, headers: baseHeaders },
      );
    } catch (error) {
      if (error instanceof AuthError) {
        const code = error.code === "auth_required" ? "auth_required" : "auth_invalid";
        const message = code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message, code, requestId }), { status: 401, headers: baseHeaders });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId }), { status: error.status, headers: baseHeaders });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("board_transition.failed", { request_id: requestId, error: normalized.message, code: normalized.code });
      return new Response(
        JSON.stringify({ error: normalized.message || "Failed to transition board", code: normalized.code ?? "board_transition_failed", requestId }),
        { status: 500, headers: baseHeaders },
      );
    }
  },
};
