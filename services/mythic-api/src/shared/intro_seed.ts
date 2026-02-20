import { rngInt, rngPick } from "./mythic_rng.js";

export type IntroSeedSource = "create_campaign" | "join_campaign" | "bootstrap" | "migration";

export interface IntroSeedActionChip {
  id: string;
  label: string;
  intent: "town" | "travel" | "dungeon" | "dm_prompt";
  hint_key: string;
  prompt: string;
  boardTarget?: "town" | "travel" | "dungeon";
  payload?: Record<string, unknown>;
}

export interface IntroSeedPayload {
  rumors: Array<Record<string, unknown>>;
  objectives: Array<Record<string, unknown>>;
  discovery_log: Array<Record<string, unknown>>;
  action_chips: IntroSeedActionChip[];
  discovery_flags: Record<string, unknown>;
}

interface BuildIntroSeedArgs {
  seed: number;
  templateKey: string;
  campaignName: string;
  campaignDescription: string;
  factionNames: string[];
  source: IntroSeedSource;
  seededAtIso?: string;
}

const INTRO_VERSION = 1;

const TEMPLATE_THEME: Record<string, string> = {
  sci_fi_ruins: "signal-lost ruinfront",
  post_apoc_warlands: "warland salvage frontier",
  post_apocalypse: "ash frontier",
  gothic_horror: "gravebound ward",
  dark_mythic_horror: "omen-locked march",
  mythic_chaos: "rift-scarred front",
  graphic_novel_fantasy: "heroic borderland",
  custom: "wild frontier",
};

function trimText(value: string, maxLen: number): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen).trim()}...`;
}

function slug(value: string): string {
  const token = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token.length > 0 ? token : "unknown";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function buildStarterDirection(args: BuildIntroSeedArgs): IntroSeedPayload {
  const theme = TEMPLATE_THEME[args.templateKey] ?? TEMPLATE_THEME.custom;
  const focusFaction = args.factionNames.length > 0
    ? args.factionNames[rngInt(args.seed, "intro:faction", 0, args.factionNames.length - 1)]!
    : "local power brokers";
  const objectiveAction = rngPick(args.seed, "intro:objective:action", [
    "lock a foothold",
    "secure leverage",
    "stabilize supply lines",
    "break enemy tempo",
  ] as const);
  const objectivePressure = rngPick(args.seed, "intro:objective:pressure", [
    "before the next escalation pulse",
    "before rival scouts close the route",
    "before panic fractures the district",
    "before the front collapses into chaos",
  ] as const);
  const rumorThreat = rngPick(args.seed, "intro:rumor:threat", [
    "an armed convoy vanished off-route",
    "a gate watch reported false-clear signals",
    "a wardstone went dark for exactly nine breaths",
    "a paid messenger never reached checkpoint",
  ] as const);
  const rumorOpportunity = rngPick(args.seed, "intro:rumor:opportunity", [
    "a quartermaster cache is rumored nearby",
    "an unclaimed contract board just refreshed",
    "a local guide offers a risky shortcut",
    "an encrypted map fragment surfaced in town",
  ] as const);
  const descSnippet = trimText(args.campaignDescription, 220);
  const seededAtIso = args.seededAtIso ?? new Date().toISOString();
  const campaignSlug = slug(args.campaignName);

  const rumors = [
    {
      title: "Frontline Signal",
      detail: `${rumorThreat} around ${args.campaignName}.`,
      tags: ["intro", "threat", theme],
    },
    {
      title: "Immediate Opportunity",
      detail: `${rumorOpportunity}.`,
      tags: ["intro", "opportunity", campaignSlug],
    },
  ];

  const objectives = [
    {
      title: "First Footing",
      description: `${objectiveAction} in ${theme} ${objectivePressure}.`,
      priority: "high",
      tags: ["intro", "starter"],
    },
    {
      title: "Read The Situation",
      description: `Interrogate leads tied to ${focusFaction} and commit one concrete move this turn.`,
      priority: "high",
      tags: ["intro", "faction", slug(focusFaction)],
    },
  ];

  const discovery_log = [
    {
      kind: "intro_briefing",
      title: "Opening Briefing",
      detail: `${args.campaignName}: ${descSnippet}`,
      source: args.source,
      seeded_at: seededAtIso,
    },
  ];

  const action_chips: IntroSeedActionChip[] = [
    {
      id: "intro-town-brief",
      label: "Read Local Briefing",
      intent: "town",
      boardTarget: "town",
      hint_key: "intro:town_brief",
      prompt: `I gather immediate leads in ${args.campaignName} and identify who is pressing this front.`,
      payload: { intro: true, board_feature: "notice_board" },
    },
    {
      id: "intro-travel-scout",
      label: "Scout Outer Route",
      intent: "travel",
      boardTarget: "travel",
      hint_key: "intro:travel_scout",
      prompt: "I scout the outer route for threats, supplies, and a decisive next objective.",
      payload: { intro: true, travel_probe: "scout_route" },
    },
    {
      id: "intro-dungeon-push",
      label: "Press The Hotspot",
      intent: "dungeon",
      boardTarget: "dungeon",
      hint_key: "intro:dungeon_push",
      prompt: "I push into the nearest hotspot and force the first meaningful confrontation.",
      payload: { intro: true, search_target: "hotspot" },
    },
    {
      id: "intro-dm-read",
      label: "Ask For Tactical Read",
      intent: "dm_prompt",
      hint_key: "intro:tactical_read",
      prompt: `Give me the immediate tactical read in ${args.campaignName}: biggest threat, best opening, and first payoff path.`,
      payload: { intro: true, followup: "tactical_read" },
    },
  ];

  const discovery_flags: Record<string, unknown> = {
    intro_pending: true,
    intro_version: INTRO_VERSION,
    intro_seeded_at: seededAtIso,
    intro_source: args.source,
  };

  return {
    rumors,
    objectives,
    discovery_log,
    action_chips,
    discovery_flags,
  };
}

export function mergeStarterDirectionIntoState(
  state: Record<string, unknown>,
  starter: IntroSeedPayload,
): Record<string, unknown> {
  const existingRumors = Array.isArray(state.rumors) ? state.rumors : [];
  const existingObjectives = Array.isArray(state.objectives) ? state.objectives : [];
  const existingDiscoveryLog = Array.isArray(state.discovery_log) ? state.discovery_log : [];
  const existingActionChips = Array.isArray(state.action_chips) ? state.action_chips : [];
  const existingFlags = asRecord(state.discovery_flags) ?? {};
  const mergedFlags = {
    ...existingFlags,
  } as Record<string, unknown>;

  if (!("intro_pending" in mergedFlags)) mergedFlags.intro_pending = starter.discovery_flags.intro_pending;
  if (!("intro_version" in mergedFlags)) mergedFlags.intro_version = starter.discovery_flags.intro_version;
  if (!("intro_seeded_at" in mergedFlags)) mergedFlags.intro_seeded_at = starter.discovery_flags.intro_seeded_at;
  if (!("intro_source" in mergedFlags)) mergedFlags.intro_source = starter.discovery_flags.intro_source;

  return {
    ...state,
    rumors: existingRumors.length > 0 ? existingRumors : starter.rumors,
    objectives: existingObjectives.length > 0 ? existingObjectives : starter.objectives,
    discovery_log: existingDiscoveryLog.length > 0 ? existingDiscoveryLog : starter.discovery_log,
    action_chips: existingActionChips.length > 0 ? existingActionChips : starter.action_chips,
    discovery_flags: mergedFlags,
  };
}
