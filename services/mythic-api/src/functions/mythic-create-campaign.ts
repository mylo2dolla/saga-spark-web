import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { buildStarterDirection } from "../shared/intro_seed.js";
import {
  buildWorldProfilePayload,
  buildWorldSeedPayload,
  buildRuntimeWorldBindings,
  fromTemplateKey,
  WORLD_FORGE_VERSION,
  type CampaignContext,
} from "../lib/worldforge/index.js";
import {
  enforceRateLimit,
  getIdempotentResponse,
  idempotencyKeyFromRequest,
  storeIdempotentResponse,
} from "../shared/request_guard.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const TEMPLATE_KEYS = [
  "custom",
  "graphic_novel_fantasy",
  "sci_fi_ruins",
  "post_apoc_warlands",
  "gothic_horror",
  "mythic_chaos",
  "dark_mythic_horror",
  "post_apocalypse",
] as const;

const CompanionBlueprintSchema = z.object({
  name: z.string().trim().min(1).max(60),
  archetype: z.string().trim().min(1).max(24).optional(),
  voice: z.string().trim().min(1).max(24).optional(),
  mood: z.string().trim().min(1).max(24).optional(),
});

const RequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  template_key: z.enum(TEMPLATE_KEYS).default("custom").optional(),
  companion_blueprint: z.array(CompanionBlueprintSchema).max(4).optional(),
  forge_input: z.record(z.unknown()).optional(),
  forgeInput: z.record(z.unknown()).optional(),
  world_seed_override: z.union([
    z.string().trim().min(1).max(120),
    z.number().int().min(0).max(2_147_483_647),
  ]).optional(),
});

type TemplateKey = typeof TEMPLATE_KEYS[number];
type CompanionBlueprintInput = z.infer<typeof CompanionBlueprintSchema>;

const hashSeed = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 2_147_483_647;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function uniqueStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function makeInviteCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeTemplateServices(template: TemplateKey): string[] {
  switch (template) {
    case "sci_fi_ruins":
      return ["repair_bay", "med_station", "contract_board"];
    case "post_apoc_warlands":
      return ["scrap_trade", "field_medic", "bounty_board"];
    case "gothic_horror":
    case "dark_mythic_horror":
      return ["apothecary", "chapel", "whispers_board"];
    case "mythic_chaos":
      return ["rift_forge", "oracle_den", "chaos_board"];
    case "graphic_novel_fantasy":
    case "post_apocalypse":
    case "custom":
    default:
      return ["inn", "healer", "notice_board"];
  }
}

function makeBaselineFactions(template: TemplateKey): Array<{ name: string; description: string; tags: string[] }> {
  switch (template) {
    case "sci_fi_ruins":
      return [
        {
          name: "Relay Wardens",
          description: "Technocratic custodians of dead network ruins and salvage lanes.",
          tags: ["order", "tech", "salvage"],
        },
        {
          name: "Neon Scavengers",
          description: "Opportunistic crews turning broken megastructures into profit.",
          tags: ["trade", "black_market", "scavenger"],
        },
      ];
    case "post_apoc_warlands":
    case "post_apocalypse":
      return [
        {
          name: "Iron Convoy",
          description: "Heavily armed logistics clans controlling food and fuel routes.",
          tags: ["trade", "militia", "survival"],
        },
        {
          name: "Ash Cartel",
          description: "Smugglers and raiders trading in weapons, medicine, and bad decisions.",
          tags: ["black_market", "raider", "crime"],
        },
      ];
    case "gothic_horror":
    case "dark_mythic_horror":
      return [
        {
          name: "Candle Covenant",
          description: "Watchful clergy balancing mercy with brutal containment.",
          tags: ["faith", "order", "ritual"],
        },
        {
          name: "Grave Syndicate",
          description: "Grave-robbers and occult brokers who monetize forbidden relics.",
          tags: ["occult", "crime", "relics"],
        },
      ];
    case "mythic_chaos":
      return [
        {
          name: "Rift Sentinels",
          description: "Battle mages and mercs who stabilize chaos fractures for coin.",
          tags: ["order", "arcane", "guard"],
        },
        {
          name: "Laughing Spiral",
          description: "Cult opportunists who feed on upheaval and spectacle.",
          tags: ["chaos", "cult", "instability"],
        },
      ];
    case "graphic_novel_fantasy":
    case "custom":
    default:
      return [
        {
          name: "Gilded Accord",
          description: "Merchants and negotiators who keep civilization profitable.",
          tags: ["trade", "diplomacy", "guild"],
        },
        {
          name: "Nightwatch Compact",
          description: "Veteran wardens maintaining order across dangerous roads.",
          tags: ["guard", "order", "militia"],
        },
      ];
  }
}

function canonicalCompanionArchetype(raw: string | undefined): "scout" | "tactician" | "support" | "vanguard" | "hunter" | "mystic" {
  const clean = (raw ?? "").trim().toLowerCase();
  if (clean === "scout") return "scout";
  if (clean === "tactician") return "tactician";
  if (clean === "support" || clean === "healer") return "support";
  if (clean === "vanguard" || clean === "tank") return "vanguard";
  if (clean === "hunter" || clean === "ranger") return "hunter";
  if (clean === "mystic" || clean === "caster" || clean === "mage") return "mystic";
  return "scout";
}

function companionArchetypeProfile(archetype: "scout" | "tactician" | "support" | "vanguard" | "hunter" | "mystic") {
  if (archetype === "tactician") {
    return { voice: "blunt", mood: "measured", cadence_turns: 3, urgency_bias: 0.48, role: "tempo_control", hook_tags: ["supply", "timing", "fallback"] };
  }
  if (archetype === "support") {
    return { voice: "steady", mood: "calm", cadence_turns: 2, urgency_bias: 0.42, role: "stability", hook_tags: ["triage", "recovery", "morale"] };
  }
  if (archetype === "vanguard") {
    return { voice: "grit", mood: "focused", cadence_turns: 3, urgency_bias: 0.55, role: "frontline", hook_tags: ["threat", "guard", "breach"] };
  }
  if (archetype === "hunter") {
    return { voice: "wry", mood: "intent", cadence_turns: 2, urgency_bias: 0.57, role: "pressure", hook_tags: ["mark", "pursuit", "ambush"] };
  }
  if (archetype === "mystic") {
    return { voice: "hushed", mood: "charged", cadence_turns: 2, urgency_bias: 0.5, role: "arcane_control", hook_tags: ["ritual", "ward", "burst"] };
  }
  return { voice: "dry", mood: "watchful", cadence_turns: 3, urgency_bias: 0.52, role: "route_intel", hook_tags: ["threat", "recon", "ambush"] };
}

function makeBaselineCompanions(
  seed: number,
  template: TemplateKey,
  blueprint: CompanionBlueprintInput[] | undefined,
): Array<{
  companion_id: string;
  name: string;
  archetype: string;
  voice: string;
  mood: string;
  cadence_turns: number;
  urgency_bias: number;
  metadata: Record<string, unknown>;
}> {
  const firstNames = ["Mira", "Kael", "Orin", "Poppy", "Juno", "Bram", "Iris", "Sable", "Lark", "Riven", "Talon", "Clover"];
  const surnames = ["Honeybrook", "Moonvale", "Sparkford", "Willowcrest", "Lanternfield", "Sunmeadow", "Bramblecross", "Cinderbay", "Stormpike", "Rainbowglen"];
  const bySeed = (label: string, pool: string[]) => pool[hashSeed(`${seed}:${template}:${label}`) % pool.length]!;
  const unique = new Set<string>();
  const ensureUniqueName = (raw: string, index: number) => {
    const clean = raw.trim().replace(/\s+/g, " ");
    const base = clean.length > 0 ? clean : `${bySeed(`companion:${index}:first`, firstNames)} ${bySeed(`companion:${index}:last`, surnames)}`;
    let candidate = base;
    let suffix = 2;
    while (unique.has(candidate.toLowerCase())) {
      candidate = `${base} ${suffix}`;
      suffix += 1;
    }
    unique.add(candidate.toLowerCase());
    return candidate;
  };

  const provided = (blueprint ?? [])
    .map((entry) => ({
      name: entry.name.trim(),
      archetype: canonicalCompanionArchetype(entry.archetype),
      voice: typeof entry.voice === "string" && entry.voice.trim().length > 0 ? entry.voice.trim() : null,
      mood: typeof entry.mood === "string" && entry.mood.trim().length > 0 ? entry.mood.trim() : null,
    }))
    .filter((entry) => entry.name.length > 0)
    .slice(0, 4);

  const defaultCompanions = [
    { name: `${bySeed("companion:scout:first", firstNames)} ${bySeed("companion:scout:last", surnames)}`, archetype: "scout" as const },
    { name: `${bySeed("companion:tactician:first", firstNames)} ${bySeed("companion:tactician:last", surnames)}`, archetype: "tactician" as const },
  ];

  const selected = provided.length > 0
    ? provided
    : defaultCompanions.map((entry) => ({ ...entry, voice: null, mood: null }));

  return selected.map((entry, index) => {
    const profile = companionArchetypeProfile(entry.archetype);
    return {
      companion_id: `companion_${String(index + 1).padStart(2, "0")}`,
      name: ensureUniqueName(entry.name, index + 1),
      archetype: entry.archetype,
      voice: entry.voice ?? profile.voice,
      mood: entry.mood ?? profile.mood,
      cadence_turns: profile.cadence_turns,
      urgency_bias: profile.urgency_bias,
      metadata: {
        role: profile.role,
        hook_tags: profile.hook_tags,
      },
    };
  });
}

function makeTownState(args: {
  campaignId: string;
  name: string;
  description: string;
  templateKey: TemplateKey;
  seed: number;
  factionNames: string[];
  campaignContext: CampaignContext;
}) {
  const { campaignId, name, description, templateKey, seed, factionNames, campaignContext } = args;
  const services = makeTemplateServices(templateKey);
  const runtimeWorldBindings = buildRuntimeWorldBindings(campaignContext, {
    includeCampaignContext: true,
    directiveLimit: 6,
    coreConflictLimit: 4,
    factionTensionLimit: 4,
  });
  const starter = buildStarterDirection({
    seed,
    templateKey,
    campaignName: name,
    campaignDescription: description,
    factionNames,
    source: "create_campaign",
  });
  return {
    campaign_id: campaignId,
    template_key: templateKey,
    world_seed: {
      ...buildWorldSeedPayload(campaignContext, {
        includeTitleDescription: true,
        title: name,
        description,
        includeLegacySeed: true,
      }),
    },
    ...runtimeWorldBindings,
    vendors: [
      {
        id: "vendor_1",
        name: "Quartermaster",
        services,
      },
    ],
    services,
    gossip: [],
    factions_present: factionNames,
    guard_alertness: 0.35,
    bounties: [],
    rumors: starter.rumors,
    objectives: starter.objectives,
    discovery_log: starter.discovery_log,
    action_chips: starter.action_chips,
    consequence_flags: {},
    discovery_flags: starter.discovery_flags,
    room_state: {},
    companion_checkins: [],
  };
}

function seedPick(seed: number, label: string, pool: readonly string[]): string {
  return pool[hashSeed(`${seed}:${label}`) % pool.length]!;
}

function buildSettlementSeed(seed: number): string {
  const starts = ["Honey", "Berry", "Brook", "Vale", "Glow", "Sun", "Moon", "Clover", "Sparkle", "Willow", "Lantern", "Apple", "Moss", "Puddle", "Rainbow"] as const;
  const ends = ["haven", "ford", "glen", "hollow", "crossing", "rest", "meadow", "bay", "field", "crest"] as const;
  return `${seedPick(seed, "settlement:start", starts)}${seedPick(seed, "settlement:end", ends)}`;
}

function deriveWorldProfile(args: {
  name: string;
  description: string;
  templateKey: TemplateKey;
  seed: number;
  factionNames: string[];
  starter: ReturnType<typeof buildStarterDirection>;
  companions: Array<{ name: string; archetype: string }>;
}) {
  const { name, description, templateKey, seed, factionNames, starter, companions } = args;
  const tone = (() => {
    switch (templateKey) {
      case "sci_fi_ruins":
        return "high-tech decay";
      case "post_apoc_warlands":
      case "post_apocalypse":
        return "survival brutality";
      case "gothic_horror":
      case "dark_mythic_horror":
        return "dread and omen";
      case "mythic_chaos":
        return "volatile mythic escalation";
      case "graphic_novel_fantasy":
        return "bold heroic pulp";
      default:
        return "adaptive";
    }
  })();

  return {
    source: "mythic-create-campaign",
    seed,
    title: name,
    description,
    template_key: templateKey,
    tone,
    starter_objective: "Establish a foothold and survive the first escalation.",
    starter_settlement: buildSettlementSeed(seed),
    faction_briefs: factionNames.slice(0, 6).map((entry, index) => ({
      id: `faction_${index + 1}`,
      name: entry,
      pressure: seedPick(seed, `faction:pressure:${entry}`, ["low", "rising", "high", "volatile"]),
    })),
    seed_hooks: starter.discovery_log.slice(0, 4),
    seed_rumors: starter.rumors.slice(0, 6),
    seed_objectives: starter.objectives.slice(0, 4),
    starter_companions: companions.slice(0, 4).map((entry) => ({
      name: entry.name,
      archetype: entry.archetype,
    })),
  };
}

async function allocateInviteCode(svc: ReturnType<typeof createServiceClient>): Promise<string> {
  for (let i = 0; i < 8; i += 1) {
    const code = makeInviteCode();
    const { data, error } = await svc
      .from("campaigns")
      .select("id")
      .eq("invite_code", code)
      .maybeSingle();
    if (error) throw error;
    if (!data) return code;
  }
  throw new Error("Failed to allocate invite code");
}

function normalizeTemplate(input: string | undefined): TemplateKey {
  if (input && (TEMPLATE_KEYS as readonly string[]).includes(input)) {
    return input as TemplateKey;
  }
  return "custom";
}

export const mythicCreateCampaign: FunctionHandler = {
  name: "mythic-create-campaign",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-create-campaign",
      limit: 25,
      windowMs: 60_000,
      corsHeaders: {},
      requestId: ctx.requestId,
    });
    if (rateLimited) return rateLimited;

    try {
      const user = await requireUser(req.headers);
      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({
          ok: false,
          error: "Invalid request",
          code: "invalid_request",
          details: parsed.error.flatten(),
          requestId: ctx.requestId,
        }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const name = parsed.data.name.trim();
      const description = parsed.data.description.trim();
      const templateKey = normalizeTemplate(parsed.data.template_key);
      const companionBlueprint = parsed.data.companion_blueprint ?? [];
      const svc = createServiceClient();

      const idempotencyHeader = idempotencyKeyFromRequest(req);
      const idempotencyKey = idempotencyHeader ? `${user.userId}:${idempotencyHeader}` : null;
      if (idempotencyKey) {
        const cached = getIdempotentResponse(idempotencyKey);
        if (cached) {
          ctx.log.info("create_campaign.idempotent_hit", { request_id: ctx.requestId, user_id: user.userId });
          return cached;
        }
      }

      const inviteCodeValue = await allocateInviteCode(svc);

      const { data: campaign, error: insertErr } = await svc
        .from("campaigns")
        .insert({
          name,
          description,
          owner_id: user.userId,
          invite_code: inviteCodeValue,
          is_active: true,
        })
        .select("id, name, description, invite_code, owner_id, is_active, updated_at")
        .single();

      if (insertErr || !campaign) {
        throw insertErr ?? new Error("Failed to create campaign");
      }

      const forgePatch = {
        ...asRecord(parsed.data.forge_input),
        ...asRecord(parsed.data.forgeInput),
      };
      const campaignContext = fromTemplateKey({
        title: name,
        description,
        templateKey,
        manualSeedOverride: parsed.data.world_seed_override,
        forgePatch,
      });
      const seed = campaignContext.worldSeed.seedNumber;
      const generatedFactions = campaignContext.worldContext.factionGraph.factions.map((faction) => ({
        name: faction.name,
        description: `${faction.ideology}. ${faction.goals[0] ?? "Strategic ambitions in motion."}`,
        tags: uniqueStrings([
          ...campaignContext.worldSeed.themeTags.slice(0, 2),
          `region:${faction.homeRegionId}`,
        ]),
      }));
      const baselineFactions = generatedFactions.length > 0
        ? generatedFactions
        : makeBaselineFactions(templateKey);
      const baselineCompanions = makeBaselineCompanions(seed, templateKey, companionBlueprint);
      const baselineFactionNames = baselineFactions.map((entry) => entry.name);
      const worldProfileJson = buildWorldProfilePayload({
        source: "mythic-create-campaign",
        campaignContext,
        templateKey,
      });
      const townState = makeTownState({
        campaignId: campaign.id,
        name,
        description,
        templateKey,
        seed,
        factionNames: baselineFactionNames,
        campaignContext,
      });

      const warnings: string[] = [];
      const criticalFailures: string[] = [];

      type DbWriteResult = { error: { message?: string } | null };
      const runOptional = async (label: string, operation: PromiseLike<DbWriteResult>) => {
        const { error } = await operation;
        if (error) {
          warnings.push(`${label}: ${error.message ?? "unknown"}`);
        }
      };

      const runCritical = async (label: string, operation: PromiseLike<DbWriteResult>) => {
        const { error } = await operation;
        if (error) {
          criticalFailures.push(`${label}: ${error.message ?? "unknown"}`);
        }
      };

      // Critical seed invariants: campaign ownership visibility + member row + active runtime must succeed.
      await runCritical(
        "campaign_members",
        svc.from("campaign_members").insert({
          campaign_id: campaign.id,
          user_id: user.userId,
          is_dm: true,
        }),
      );
      await runCritical(
        "campaign_runtime",
        svc.schema("mythic").from("campaign_runtime").insert({
          campaign_id: campaign.id,
          mode: "town",
          status: "active",
          state_json: townState,
          ui_hints_json: {
            camera: { x: 0, y: 0, zoom: 1 },
            board_theme: templateKey,
          },
        }),
      );

      if (criticalFailures.length > 0) {
        ctx.log.error("create_campaign.critical_seed_failure", {
          request_id: ctx.requestId,
          campaign_id: campaign.id,
          user_id: user.userId,
          failed_steps: criticalFailures,
        });

        const rollback = await svc
          .from("campaigns")
          .delete()
          .eq("id", campaign.id)
          .eq("owner_id", user.userId);
        if (rollback.error) {
          warnings.push(`rollback: ${rollback.error.message ?? "unknown"}`);
        }

        return new Response(
          JSON.stringify({
            ok: false,
            code: "critical_seed_failed",
            error: "Failed to initialize campaign runtime",
            details: {
              failed_steps: criticalFailures,
              rollback_warning: warnings.length > 0 ? warnings : null,
            },
            requestId: ctx.requestId,
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      await runOptional(
        "combat_state",
        svc.from("combat_state").insert({ campaign_id: campaign.id }),
      );
      await runOptional(
        "dm_campaign_state",
        svc.schema("mythic").from("dm_campaign_state").upsert({ campaign_id: campaign.id }, { onConflict: "campaign_id" }),
      );
      await runOptional(
        "dm_world_tension",
        svc.schema("mythic").from("dm_world_tension").upsert({ campaign_id: campaign.id }, { onConflict: "campaign_id" }),
      );
      await runOptional(
        "factions",
        svc.schema("mythic").from("factions").upsert(
          baselineFactions.map((faction) => ({
            campaign_id: campaign.id,
            name: faction.name,
            description: faction.description,
            tags: faction.tags,
          })),
          { onConflict: "campaign_id,name" },
        ),
      );
      await runOptional(
        "campaign_companions",
        svc.schema("mythic").from("campaign_companions").upsert(
          baselineCompanions.map((companion) => ({
            campaign_id: campaign.id,
            companion_id: companion.companion_id,
            name: companion.name,
            archetype: companion.archetype,
            voice: companion.voice,
            mood: companion.mood,
            cadence_turns: companion.cadence_turns,
            urgency_bias: companion.urgency_bias,
            metadata: companion.metadata,
          })),
          { onConflict: "campaign_id,companion_id" },
        ),
      );
      await runOptional(
        "world_profiles",
        svc.schema("mythic").from("world_profiles").upsert(
          {
            campaign_id: campaign.id,
            seed_title: name,
            seed_description: description,
            template_key: templateKey,
            world_profile_json: worldProfileJson,
          },
          { onConflict: "campaign_id" },
        ),
      );
      await runOptional(
        "campaign_world_profiles",
        svc.schema("mythic").from("campaign_world_profiles").upsert(
          {
            campaign_id: campaign.id,
            seed_title: name,
            seed_description: description,
            template_key: templateKey,
            world_profile_json: worldProfileJson,
          },
          { onConflict: "campaign_id" },
        ),
      );

      const seedStatus = warnings.length === 0 ? "seeded" : "seeding_failed";
      if (warnings.length > 0) {
        ctx.log.warn("create_campaign.partial_seed_failure", { request_id: ctx.requestId, campaign_id: campaign.id, warnings });
      }

      const response = new Response(
        JSON.stringify({
          ok: true,
          campaign,
          template_key: templateKey,
          world_forge_version: WORLD_FORGE_VERSION,
          world_seed: {
            ...buildWorldSeedPayload(campaignContext, {
              includeThemeTags: true,
              includeToneVector: true,
            }),
          },
          world_seed_status: seedStatus,
          health_status: warnings.length === 0 ? "Mythic Ready" : "Needs Repair",
          warnings,
          requestId: ctx.requestId,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );

      if (idempotencyKey) {
        storeIdempotentResponse(idempotencyKey, response, 60_000);
      }

      ctx.log.info("create_campaign.success", { request_id: ctx.requestId, campaign_id: campaign.id, user_id: user.userId, seed_status: seedStatus });
      return response;
    } catch (error) {
      if (error instanceof AuthError) {
        const code = error.code === "auth_required" ? "auth_required" : "auth_invalid";
        const message = code === "auth_required"
          ? "Authentication required"
          : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ ok: false, error: message, code, requestId: ctx.requestId }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("create_campaign.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      return new Response(
        JSON.stringify({
          ok: false,
          error: normalized.message || "Failed to create campaign",
          code: "create_failed",
          requestId: ctx.requestId,
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  },
};
