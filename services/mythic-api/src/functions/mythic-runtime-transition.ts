import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { rngInt, rngPick } from "../shared/mythic_rng.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RuntimeModeSchema = z.enum(["town", "travel", "dungeon", "combat"]);

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  toMode: RuntimeModeSchema.optional(),
  toBoardType: RuntimeModeSchema.optional(),
  reason: z.string().max(200).optional(),
  payload: z.record(z.unknown()).optional(),
}).superRefine((value, ctx) => {
  if (!value.toMode && !value.toBoardType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["toMode"],
      message: "toMode is required",
    });
  }
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
  job_postings: unknown[];
  room_state: Record<string, unknown>;
  town_npcs: unknown[];
  town_relationships: Record<string, unknown>;
  town_grudges: Record<string, unknown>;
  town_activity_log: unknown[];
  town_clock: Record<string, unknown>;
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

type CompanionCommandPayload = {
  companion_id: string;
  stance: "aggressive" | "balanced" | "defensive";
  directive: "focus" | "protect" | "harry" | "hold";
  target_hint?: string | null;
};

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

const townNpcGivenNames = [
  "Mirth",
  "Bracken",
  "Oona",
  "Thistle",
  "Rook",
  "Pip",
  "Bram",
  "Lyra",
  "Kettle",
  "Vesper",
  "Nettle",
  "Quill",
];
const townNpcTitles = [
  "Lanternwright",
  "Rumorkeeper",
  "Gate Marshal",
  "Cartographer",
  "Hex Broker",
  "Bellwarden",
  "Route Scribe",
  "Dusk Herbalist",
];
const townNpcMoods = ["steady", "wary", "eager", "tired", "suspicious", "hopeful"];
const townNpcScheduleStates = ["market", "square", "gate", "alley", "notice_board", "chapel"];

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

function parseCompanionCommand(value: unknown): CompanionCommandPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const companionId = typeof row.companion_id === "string" ? row.companion_id.trim() : "";
  if (!companionId) return null;
  const stanceRaw = typeof row.stance === "string" ? row.stance.trim().toLowerCase() : "";
  const directiveRaw = typeof row.directive === "string" ? row.directive.trim().toLowerCase() : "";
  if (stanceRaw !== "aggressive" && stanceRaw !== "balanced" && stanceRaw !== "defensive") return null;
  if (directiveRaw !== "focus" && directiveRaw !== "protect" && directiveRaw !== "harry" && directiveRaw !== "hold") return null;
  const targetHint = typeof row.target_hint === "string" && row.target_hint.trim().length > 0
    ? row.target_hint.trim().slice(0, 80)
    : null;
  return {
    companion_id: companionId,
    stance: stanceRaw,
    directive: directiveRaw,
    target_hint: targetHint,
  };
}

function applyCompanionCommand(args: {
  state: Record<string, unknown>;
  companions: CompanionState[];
  command: CompanionCommandPayload | null;
}): Record<string, unknown> {
  const command = args.command;
  if (!command) return args.state;
  const now = nowIso();
  const companionCommands = asRecord(args.state.companion_commands);
  const nextCommands = {
    ...companionCommands,
    [command.companion_id]: {
      companion_id: command.companion_id,
      stance: command.stance,
      directive: command.directive,
      target_hint: command.target_hint ?? null,
      updated_at: now,
    },
  };

  const basePresence = Array.isArray(args.state.companion_presence)
    ? args.state.companion_presence.map((entry) => asRecord(entry))
    : buildCompanionPresence(args.companions).map((entry) => asRecord(entry));
  const nextPresence: Array<Record<string, unknown>> = [];
  let updated = false;
  for (const entry of basePresence) {
    const companionId = typeof entry.companion_id === "string" ? entry.companion_id : null;
    if (!companionId) {
      nextPresence.push(entry);
      continue;
    }
    if (companionId !== command.companion_id) {
      nextPresence.push(entry);
      continue;
    }
    nextPresence.push({
      ...entry,
      stance: command.stance,
      directive: command.directive,
      target_hint: command.target_hint ?? null,
      command_updated_at: now,
    });
    updated = true;
  }
  if (!updated) {
    const known = args.companions.find((entry) => entry.companion_id === command.companion_id) ?? null;
    nextPresence.push({
      companion_id: command.companion_id,
      name: known?.name ?? command.companion_id,
      archetype: known?.archetype ?? "ally",
      mood: known?.mood ?? "steady",
      stance: command.stance,
      directive: command.directive,
      target_hint: command.target_hint ?? null,
      command_updated_at: now,
    });
  }

  return {
    ...args.state,
    companion_presence: nextPresence.slice(0, 12),
    companion_commands: nextCommands,
  };
}

function normalizeJobPosting(entry: unknown, fallbackId: string): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const raw = entry as Record<string, unknown>;
  const id = typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : fallbackId;
  const title = typeof raw.title === "string" && raw.title.trim().length > 0 ? raw.title.trim() : null;
  const summary = typeof raw.summary === "string" && raw.summary.trim().length > 0 ? raw.summary.trim() : null;
  if (!title && !summary) return null;
  const statusRaw = typeof raw.status === "string" ? raw.status.trim().toLowerCase() : "open";
  const status = statusRaw === "accepted" || statusRaw === "completed" ? statusRaw : "open";
  return {
    ...raw,
    id,
    title: title ?? summary,
    summary,
    status,
  };
}

function buildTownJobPostings(args: {
  seed: number;
  factionNames: string[];
  tension: number;
  continuity: ContinuityState;
  payload: Record<string, unknown>;
}): Record<string, unknown>[] {
  const factionA = args.factionNames[0] ?? "the watch";
  const factionB = args.factionNames[1] ?? "the guild";
  const tensionTier = args.tension >= 0.7 ? "high" : args.tension >= 0.4 ? "rising" : "low";
  const base = [
    {
      id: `job-${rngInt(args.seed, "job:0:id", 100, 999)}`,
      title: "Break The Supply Ring",
      summary: `Hit ${factionB}'s courier chain before dusk and recover what they are hiding.`,
      reward_hint: "xp_medium_loot_low",
      danger: tensionTier,
      status: "open",
    },
    {
      id: `job-${rngInt(args.seed, "job:1:id", 100, 999)}`,
      title: "Shadow The Scout Cell",
      summary: `Track ${factionA} scouts from gate to safehouse without burning your cover.`,
      reward_hint: "xp_medium_loot_medium",
      danger: tensionTier === "high" ? "high" : "medium",
      status: "open",
    },
    {
      id: `job-${rngInt(args.seed, "job:2:id", 100, 999)}`,
      title: "Recover A Lost Ledger",
      summary: "Find the ledger, verify it, and decide who gets exposed in public.",
      reward_hint: "xp_low_loot_medium",
      danger: "medium",
      status: "open",
    },
  ];
  const continuityRows = args.continuity.job_postings
    .map((entry, index) => normalizeJobPosting(entry, `job-prev-${index + 1}`))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(-8);

  const merged = new Map<string, Record<string, unknown>>();
  for (const posting of base) {
    merged.set(posting.id, posting);
  }
  for (const posting of continuityRows) {
    merged.set(String(posting.id), { ...(merged.get(String(posting.id)) ?? {}), ...posting });
  }

  const payloadPostings = Array.isArray(args.payload.job_postings)
    ? args.payload.job_postings
      .map((entry, index) => normalizeJobPosting(entry, `job-payload-${index + 1}`))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    : [];
  for (const posting of payloadPostings) {
    merged.set(String(posting.id), { ...(merged.get(String(posting.id)) ?? {}), ...posting });
  }

  const jobId = typeof args.payload.job_posting_id === "string" ? args.payload.job_posting_id.trim() : "";
  const jobAction = typeof args.payload.job_action === "string" ? args.payload.job_action.trim().toLowerCase() : "";
  if (jobId && merged.has(jobId)) {
    const current = merged.get(jobId)!;
    if (jobAction === "accept") {
      merged.set(jobId, { ...current, status: "accepted", accepted_at: nowIso() });
    } else if (jobAction === "complete") {
      merged.set(jobId, { ...current, status: "completed", completed_at: nowIso() });
    }
  }

  return Array.from(merged.values()).slice(0, 8);
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
    job_postings: asArray(state.job_postings),
    room_state: asRecord(state.room_state),
    town_npcs: asArray(state.town_npcs),
    town_relationships: asRecord(state.town_relationships),
    town_grudges: asRecord(state.town_grudges),
    town_activity_log: asArray(state.town_activity_log),
    town_clock: asRecord(state.town_clock),
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

function clampScore(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeTownNpc(entry: unknown, fallbackId: string): Record<string, unknown> | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const row = entry as Record<string, unknown>;
  const id = typeof row.id === "string" && row.id.trim().length > 0 ? row.id.trim() : fallbackId;
  const name = typeof row.name === "string" && row.name.trim().length > 0 ? row.name.trim() : null;
  if (!name) return null;
  const role = typeof row.role === "string" && row.role.trim().length > 0 ? row.role.trim() : "local";
  const faction = typeof row.faction === "string" && row.faction.trim().length > 0 ? row.faction.trim() : "independent";
  const mood = typeof row.mood === "string" && row.mood.trim().length > 0 ? row.mood.trim().toLowerCase() : "steady";
  const relationship = clampScore(Number(row.relationship ?? 0), -100, 100);
  const grudge = clampScore(Number(row.grudge ?? 0), 0, 100);
  const scheduleState = typeof row.schedule_state === "string" && row.schedule_state.trim().length > 0
    ? row.schedule_state.trim().toLowerCase()
    : "square";
  const locationTileRaw = asRecord(row.location_tile);
  const tileX = clampInt(Number(locationTileRaw.x ?? 0), 0, 11);
  const tileY = clampInt(Number(locationTileRaw.y ?? 0), 0, 7);
  return {
    ...row,
    id,
    name,
    role,
    faction,
    mood,
    relationship,
    grudge,
    schedule_state: scheduleState,
    location_tile: { x: tileX, y: tileY },
    updated_at: nowIso(),
  };
}

function buildDefaultTownNpcs(args: {
  seed: number;
  factionNames: string[];
  count: number;
}): Record<string, unknown>[] {
  const count = Math.max(4, Math.min(9, Math.floor(args.count)));
  return Array.from({ length: count }).map((_, index) => {
    const id = `npc_${index + 1}`;
    const given = rngPick(args.seed, `town:npc:given:${index}`, townNpcGivenNames);
    const title = rngPick(args.seed, `town:npc:title:${index}`, townNpcTitles);
    const faction = args.factionNames[index % Math.max(1, args.factionNames.length)] ?? "independent";
    return {
      id,
      name: `${given} ${title}`,
      role: title.toLowerCase(),
      faction,
      mood: rngPick(args.seed, `town:npc:mood:${index}`, townNpcMoods),
      relationship: rngInt(args.seed, `town:npc:rel:${index}`, -12, 20),
      grudge: rngInt(args.seed, `town:npc:grudge:${index}`, 0, 18),
      schedule_state: rngPick(args.seed, `town:npc:schedule:${index}`, townNpcScheduleStates),
      location_tile: {
        x: rngInt(args.seed, `town:npc:x:${index}`, 0, 11),
        y: rngInt(args.seed, `town:npc:y:${index}`, 4, 7),
      },
      updated_at: nowIso(),
    };
  });
}

function buildTownLiveness(args: {
  seed: number;
  continuity: ContinuityState;
  factionNames: string[];
  payload: Record<string, unknown>;
}): {
  town_npcs: Record<string, unknown>[];
  town_relationships: Record<string, unknown>;
  town_grudges: Record<string, unknown>;
  town_activity_log: Record<string, unknown>[];
  town_clock: Record<string, unknown>;
} {
  const baseClockTick = clampInt(Number(args.continuity.town_clock.tick ?? 0), 0, 999999);
  const tick = baseClockTick + 1;
  const interaction = asRecord(args.payload.npc_interaction);
  const interactionNpcId = typeof interaction?.npc_id === "string" ? interaction.npc_id.trim() : "";
  const interactionAction = typeof interaction?.action === "string" ? interaction.action.trim().toLowerCase() : "talk";
  const interactionTone = typeof interaction?.tone === "string" ? interaction.tone.trim().toLowerCase() : "neutral";

  const continuityNpcs = args.continuity.town_npcs
    .map((entry, index) => normalizeTownNpc(entry, `npc_prev_${index + 1}`))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const baselineNpcs = continuityNpcs.length > 0
    ? continuityNpcs
    : buildDefaultTownNpcs({
        seed: args.seed,
        factionNames: args.factionNames,
        count: rngInt(args.seed, "town:npc:count", 5, 8),
      });

  const relationshipMap: Record<string, unknown> = {
    ...args.continuity.town_relationships,
  };
  const grudgeMap: Record<string, unknown> = {
    ...args.continuity.town_grudges,
  };
  const activityLog = args.continuity.town_activity_log
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .slice(-20);

  const updatedNpcs = baselineNpcs.map((entry, index) => {
    const id = typeof entry.id === "string" ? entry.id : `npc_${index + 1}`;
    const relationshipBase = clampScore(Number(relationshipMap[id] ?? entry.relationship ?? 0), -100, 100);
    const grudgeBase = clampScore(Number(grudgeMap[id] ?? entry.grudge ?? 0), 0, 100);
    const stanceDelta = rngInt(args.seed, `town:npc:drift:${tick}:${id}`, -2, 2);
    const mood = rngPick(args.seed, `town:npc:mood:${tick}:${id}`, townNpcMoods);
    const scheduleState = rngPick(args.seed, `town:npc:schedule:${tick}:${id}`, townNpcScheduleStates);
    const tileX = rngInt(args.seed, `town:npc:x:${tick}:${id}`, 0, 11);
    const tileY = rngInt(args.seed, `town:npc:y:${tick}:${id}`, 4, 7);
    let relationship = clampScore(relationshipBase + stanceDelta, -100, 100);
    let grudge = clampScore(grudgeBase + (stanceDelta < 0 ? 1 : 0), 0, 100);

    if (interactionNpcId && interactionNpcId === id) {
      const relationshipDelta = interactionTone === "helpful"
        ? 8
        : interactionTone === "hostile"
          ? -12
          : interactionTone === "tense"
            ? -6
            : 3;
      const grudgeDelta = interactionTone === "hostile"
        ? 12
        : interactionTone === "tense"
          ? 6
          : interactionTone === "helpful"
            ? -4
            : -1;
      relationship = clampScore(relationship + relationshipDelta, -100, 100);
      grudge = clampScore(grudge + grudgeDelta, 0, 100);
      activityLog.push({
        tick,
        npc_id: id,
        npc_name: entry.name,
        action: interactionAction || "talk",
        detail: `${entry.name} reacts ${interactionTone}.`,
        relationship,
        grudge,
        happened_at: nowIso(),
      });
    } else {
      activityLog.push({
        tick,
        npc_id: id,
        npc_name: entry.name,
        action: "patrol",
        detail: `${entry.name} rotates through ${scheduleState}.`,
        relationship,
        grudge,
        happened_at: nowIso(),
      });
    }

    relationshipMap[id] = relationship;
    grudgeMap[id] = grudge;
    return {
      ...entry,
      mood,
      relationship,
      grudge,
      schedule_state: scheduleState,
      location_tile: { x: tileX, y: tileY },
      updated_at: nowIso(),
    };
  });

  return {
    town_npcs: updatedNpcs.slice(0, 12),
    town_relationships: relationshipMap,
    town_grudges: grudgeMap,
    town_activity_log: activityLog.slice(-24),
    town_clock: {
      tick,
      updated_at: nowIso(),
    },
  };
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
  const jobPostings = buildTownJobPostings({
    seed,
    factionNames,
    tension,
    continuity,
    payload,
  });
  const jobAction = typeof payload.job_action === "string" ? payload.job_action : null;
  const jobPostingId = typeof payload.job_posting_id === "string" ? payload.job_posting_id : null;
  const jobDiscovery = (jobAction && jobPostingId)
    ? [{ kind: "job_posting", detail: `${jobAction}:${jobPostingId}` }]
    : [];
  const townLiveness = buildTownLiveness({
    seed,
    continuity,
    factionNames,
    payload,
  });

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
    discovery_log: mergeDiscoveryLog(continuity.discovery_log, [...jobDiscovery, ...asArray(payload.discovery_log)], 40),
    job_postings: jobPostings,
    room_state: continuity.room_state,
    ...townLiveness,
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
    {
      kind: "probe_outcome",
      detail: explicitProbe ? probeKind : "passive",
      encounter_triggered: encounterTriggered,
      treasure_triggered: treasureTriggered,
      dungeon_traces_found: dungeonTracesFound,
      encounter_type: encounterTriggered
        ? rngPick(seed, "travel:encounter:type:log", ["bandits", "beast_pack", "rival_scouts", "ruin_wardens", "faction_ambush"])
        : null,
      treasure_type: treasureTriggered
        ? rngPick(seed, "travel:treasure:type:log", ["cache", "supply_crate", "forgotten_relic", "coin_stash", "sealed_map"])
        : null,
    },
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
    job_postings: continuity.job_postings,
    room_state: continuity.room_state,
    town_npcs: continuity.town_npcs,
    town_relationships: continuity.town_relationships,
    town_grudges: continuity.town_grudges,
    town_activity_log: continuity.town_activity_log,
    town_clock: continuity.town_clock,
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
  const roomState = {
    ...continuity.room_state,
  };
  const roomId = typeof payload.room_id === "string" && payload.room_id.trim().length > 0 ? payload.room_id.trim() : null;
  const roomAction = typeof payload.action === "string" && payload.action.trim().length > 0 ? payload.action.trim().toLowerCase() : null;
  if (roomId) {
    const current = asRecord(roomState[roomId]);
    const visits = Number.isFinite(Number(current?.visits)) ? Math.max(0, Math.floor(Number(current?.visits))) : 0;
    roomState[roomId] = {
      ...(current ?? {}),
      room_id: roomId,
      last_action: roomAction ?? "assess_room",
      visits: visits + 1,
      status: roomAction === "loot_cache"
        ? "looted"
        : roomAction === "disarm_traps"
          ? "secured"
          : roomAction === "study_puzzle"
            ? "investigating"
            : current?.status ?? "active",
      updated_at: nowIso(),
    };
  }
  const roomDiscovery = roomId
    ? [{ kind: "room_state", detail: `${roomId}:${roomAction ?? "assess_room"}` }]
    : [];

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
      [{ kind: "board", detail: "dungeon" }, ...roomDiscovery, ...asArray(payload.discovery_log)],
      48,
    ),
    travel_goal: "enter_dungeon",
    search_target: resolveSearchTarget(payload, continuity) ?? "dungeon",
    job_postings: continuity.job_postings,
    room_state: roomState,
    town_npcs: continuity.town_npcs,
    town_relationships: continuity.town_relationships,
    town_grudges: continuity.town_grudges,
    town_activity_log: continuity.town_activity_log,
    town_clock: continuity.town_clock,
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

export const mythicRuntimeTransition: FunctionHandler = {
  name: "mythic-runtime-transition",
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

      const { campaignId } = parsed.data;
      const toMode = parsed.data.toMode ?? parsed.data.toBoardType!;
      const rawReason = parsed.data.reason ?? "manual";
      const payload = asRecord(parsed.data.payload ?? {});
      const reasonCode = typeof payload.reason_code === "string"
        ? normalizeReasonCode(payload.reason_code)
        : normalizeReasonCode(rawReason);
      const reason = typeof payload.reason_label === "string"
        ? humanizeReason(payload.reason_label)
        : humanizeReason(rawReason);
      const companionCommand = parseCompanionCommand(payload.companion_command);

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

      const activeRuntimeQuery = await svc
        .schema("mythic")
        .from("campaign_runtime")
        .select("id, mode, state_json, updated_at, combat_session_id, status")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false });
      if (activeRuntimeQuery.error) throw activeRuntimeQuery.error;

      const activeRuntimeRows = (activeRuntimeQuery.data ?? []) as Array<Record<string, unknown>>;
      if (activeRuntimeRows.length > 1) {
        warnings.push("duplicate_active_runtime_rows_detected:archiving_old_rows");
      }
      const activeRuntime = activeRuntimeRows[0] ?? null;
      const activeState = activeRuntime ? asRecord(activeRuntime.state_json) : {};
      const combatResolution = asRecord(activeState.combat_resolution);
      const combatResolutionPending = combatResolution?.pending === true;
      const combatResolutionReturnMode = (
        typeof combatResolution?.return_mode === "string"
        && (
          combatResolution.return_mode === "town"
          || combatResolution.return_mode === "travel"
          || combatResolution.return_mode === "dungeon"
          || combatResolution.return_mode === "combat"
        )
      )
        ? combatResolution.return_mode
        : null;
      const continuity = readContinuity(activeRuntime ? activeState : null);
      const transitionCountQuery = await svc
        .schema("mythic")
        .from("runtime_events")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId);
      if (transitionCountQuery.error) throw transitionCountQuery.error;
      const transitionCount = Number(transitionCountQuery.count ?? 0);

      const worldSeedBase = Number(asRecord(world.world_profile_json).seed ?? Number.NaN);
      const seedBase = Number.isFinite(continuity.seed)
        ? Number(continuity.seed)
        : Number.isFinite(worldSeedBase)
          ? worldSeedBase
          : hashSeed(`${campaignId}:${reasonCode}:${toMode}`);
      const phaseOffset = toMode === "town" ? 1 : toMode === "travel" ? 2 : toMode === "dungeon" ? 3 : 4;
      const variationOffset = hashSeed(`${campaignId}:${reasonCode}:${transitionCount}`) % 5000;
      const seed = seedBase + phaseOffset + variationOffset;

      let nextState: Record<string, unknown>;
      if (toMode === "town") {
        nextState = buildTownState({ seed, world, continuity, factionNames, tension: worldTension, companions, payload });
      } else if (toMode === "travel") {
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
      } else if (toMode === "dungeon") {
        nextState = buildDungeonState({ seed, world, continuity, factionNames, tension: worldTension, companions, payload });
      } else {
        nextState = {
          ...activeState,
          ...payload,
          seed,
          template_key: world.template_key,
          world_seed: { title: world.seed_title, description: world.seed_description },
          town_npcs: continuity.town_npcs,
          town_relationships: continuity.town_relationships,
          town_grudges: continuity.town_grudges,
          town_activity_log: continuity.town_activity_log,
          town_clock: continuity.town_clock,
          companion_presence: buildCompanionPresence(companions),
          companion_checkins: uniqueUnknownArray([...continuity.companion_checkins, ...asArray(payload.companion_checkins)]).slice(-24),
        };
      }

      nextState = applyCompanionCommand({
        state: nextState,
        companions,
        command: companionCommand,
      });

      const clearCombatResolution = (
        combatResolutionPending
        && typeof activeRuntime?.mode === "string"
        && activeRuntime.mode === "combat"
        && toMode !== "combat"
      );
      if (clearCombatResolution) {
        nextState = {
          ...nextState,
          combat_session_id: null,
          return_mode: null,
          combat_resolution: null,
        };
      }

      const archivedRuntimeIds = activeRuntimeRows
        .slice(1)
        .map((row) => (typeof row.id === "string" ? row.id : null))
        .filter((id): id is string => Boolean(id));
      if (archivedRuntimeIds.length > 0) {
        const { error: archiveError } = await svc
          .schema("mythic")
          .from("campaign_runtime")
          .update({ status: "archived", updated_at: nowIso() })
          .in("id", archivedRuntimeIds);
        if (archiveError) throw archiveError;
      }

      let runtimeId: string;
      if (activeRuntime && typeof activeRuntime.id === "string") {
        const { error: runtimeUpdateError } = await svc
          .schema("mythic")
          .from("campaign_runtime")
          .update({
            mode: toMode,
            state_json: nextState,
            ui_hints_json: {
              camera: { x: 0, y: 0, zoom: 1.0 },
              runtime_theme: world.template_key,
            },
            updated_at: nowIso(),
          })
          .eq("id", activeRuntime.id);
        if (runtimeUpdateError) throw runtimeUpdateError;
        runtimeId = activeRuntime.id;
      } else {
        const runtimeInsert = await svc
          .schema("mythic")
          .from("campaign_runtime")
          .insert({
            campaign_id: campaignId,
            mode: toMode,
            status: "active",
            state_json: nextState,
            ui_hints_json: {
              camera: { x: 0, y: 0, zoom: 1.0 },
              runtime_theme: world.template_key,
            },
          })
          .select("id")
          .single();
        if (runtimeInsert.error) throw runtimeInsert.error;
        runtimeId = String((runtimeInsert.data as { id: string }).id);
      }

      const transitionPayload = {
        ...payload,
        reason_code: reasonCode,
        travel_goal: (nextState as any).travel_goal ?? null,
        travel_probe: (payload as any).travel_probe ?? null,
        search_target: (nextState as any).search_target ?? null,
        discovery_flags: asRecord((nextState as any).discovery_flags),
        combat_resolution_pending_before: combatResolutionPending,
        combat_resolution_return_mode: combatResolutionReturnMode,
        combat_resolution_cleared: (
          combatResolutionPending
          && typeof activeRuntime?.mode === "string"
          && activeRuntime.mode === "combat"
          && toMode !== "combat"
        ),
      };

      const { error: transitionError } = await svc
        .schema("mythic")
        .from("runtime_events")
        .insert({
          campaign_id: campaignId,
          runtime_id: runtimeId,
          from_mode: typeof activeRuntime?.mode === "string" ? activeRuntime.mode : null,
          to_mode: toMode,
          reason,
          payload_json: transitionPayload,
        });
      if (transitionError) throw transitionError;

      try {
        await appendMemoryEvent({
          svc,
          campaignId,
          playerId: user.userId,
          category: "runtime_transition",
          severity: 2,
          payload: {
            from_mode: typeof activeRuntime?.mode === "string" ? activeRuntime.mode : null,
            to_mode: toMode,
            reason,
            transition_payload: transitionPayload,
            reason_code: reasonCode,
            runtime_id: runtimeId,
          },
        });
      } catch (error) {
        warnings.push(`dm_memory_events:${sanitizeError(error).message}`);
      }

      const npcInteraction = asRecord(payload.npc_interaction);
      if (toMode === "town" && npcInteraction) {
        const npcId = typeof npcInteraction.npc_id === "string" ? npcInteraction.npc_id.trim() : "";
        const interactionTone = typeof npcInteraction.tone === "string" ? npcInteraction.tone.trim().toLowerCase() : "neutral";
        const townNpcs = asArray(nextState.town_npcs)
          .map((entry) => asRecord(entry))
          .filter((entry): entry is Record<string, unknown> => Boolean(entry));
        const hitNpc = townNpcs.find((entry) => String(entry.id ?? "") === npcId) ?? null;
        if (npcId && hitNpc) {
          const relationship = clampInt(Number(hitNpc.relationship ?? 0), -100, 100);
          const grudge = clampInt(Number(hitNpc.grudge ?? 0), 0, 100);
          try {
            await appendMemoryEvent({
              svc,
              campaignId,
              playerId: user.userId,
              category: "town_relationship",
              severity: grudge >= 40 ? 3 : relationship >= 35 ? 1 : 2,
              payload: {
                npc_id: npcId,
                npc_name: hitNpc.name ?? npcId,
                action: typeof npcInteraction.action === "string" ? npcInteraction.action : "talk",
                tone: interactionTone,
                relationship,
                grudge,
                faction: hitNpc.faction ?? null,
                to_mode: toMode,
              },
            });
          } catch (error) {
            warnings.push(`town_memory:${sanitizeError(error).message}`);
          }

          const factionName = typeof hitNpc.faction === "string" ? hitNpc.faction.toLowerCase() : "";
          const factionFromNpc = factions.find((entry) => entry.name.toLowerCase() === factionName)
            ?? factions.find((entry) => factionName.length > 0 && entry.name.toLowerCase().includes(factionName))
            ?? null;
          if (factionFromNpc) {
            let delta = 0;
            if (interactionTone === "helpful") delta = 3;
            else if (interactionTone === "hostile") delta = -6;
            else if (interactionTone === "tense") delta = -3;
            else if (interactionTone === "neutral" || interactionTone === "probe") delta = 1;
            if (delta !== 0) {
              try {
                await applyReputationDelta({
                  svc,
                  campaignId,
                  playerId: user.userId,
                  factionId: factionFromNpc.id,
                  delta,
                  severity: Math.abs(delta) >= 5 ? 3 : 2,
                  evidence: {
                    reason,
                    reason_code: reasonCode,
                    npc_id: npcId,
                    npc_name: hitNpc.name ?? npcId,
                    interaction_tone: interactionTone,
                  },
                });
              } catch (error) {
                warnings.push(`town_reputation:${sanitizeError(error).message}`);
              }
            }
          }
        }
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
        } else if (toMode === "dungeon") {
          delta = 2;
        } else if (toMode === "travel" && Boolean(asRecord((nextState as any).discovery_flags).encounter_triggered)) {
          delta = -2;
          severity = 2;
        } else if (toMode === "travel" && Boolean(asRecord((nextState as any).discovery_flags).dungeon_traces_found)) {
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
                to_mode: toMode,
                transition_payload: transitionPayload,
                faction_name: factionTarget.name,
              },
            });
          } catch (error) {
            warnings.push(`reputation_update:${sanitizeError(error).message}`);
          }
        }
      }

      ctx.log.info("runtime_transition.success", {
        request_id: requestId,
        campaign_id: campaignId,
        to_mode: toMode,
        warnings: warnings.length,
      });

      return new Response(
        JSON.stringify({
          ok: true,
          runtime_id: runtimeId,
          mode: toMode,
          board_type: toMode,
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
      ctx.log.error("runtime_transition.failed", { request_id: requestId, error: normalized.message, code: normalized.code });
      return new Response(
        JSON.stringify({ error: normalized.message || "Failed to transition runtime", code: normalized.code ?? "runtime_transition_failed", requestId }),
        { status: 500, headers: baseHeaders },
      );
    }
  },
};
