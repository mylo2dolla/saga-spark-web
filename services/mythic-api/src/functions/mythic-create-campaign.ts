import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
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

const RequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  template_key: z.enum(TEMPLATE_KEYS).default("custom").optional(),
});

type TemplateKey = typeof TEMPLATE_KEYS[number];

const hashSeed = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 2_147_483_647;
};

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

function makeBaselineCompanions(seed: number, template: TemplateKey): Array<{
  companion_id: string;
  name: string;
  archetype: string;
  voice: string;
  mood: string;
  cadence_turns: number;
  urgency_bias: number;
  metadata: Record<string, unknown>;
}> {
  const firstNames = ["Ash", "Morrow", "Vex", "Rook", "Kestrel", "Nyx", "Vale", "Drift"];
  const surnames = ["Vesper", "Pike", "Gallows", "Cinder", "Mire", "Quill", "Thorn", "Rune"];
  const bySeed = (label: string, pool: string[]) => pool[hashSeed(`${seed}:${template}:${label}`) % pool.length]!;
  const scoutName = `${bySeed("companion:scout:first", firstNames)} ${bySeed("companion:scout:last", surnames)}`;
  const tacticianName = `${bySeed("companion:tactician:first", firstNames)} ${bySeed("companion:tactician:last", surnames)}`;

  return [
    {
      companion_id: "companion_01",
      name: scoutName,
      archetype: "scout",
      voice: "dry",
      mood: "watchful",
      cadence_turns: 3,
      urgency_bias: 0.52,
      metadata: {
        role: "route_intel",
        hook_tags: ["threat", "recon", "ambush"],
      },
    },
    {
      companion_id: "companion_02",
      name: tacticianName,
      archetype: "tactician",
      voice: "blunt",
      mood: "measured",
      cadence_turns: 3,
      urgency_bias: 0.48,
      metadata: {
        role: "tempo_control",
        hook_tags: ["supply", "timing", "fallback"],
      },
    },
  ];
}

function makeTownState(args: {
  campaignId: string;
  name: string;
  description: string;
  templateKey: TemplateKey;
  seed: number;
  factionNames: string[];
}) {
  const { campaignId, name, description, templateKey, seed, factionNames } = args;
  const services = makeTemplateServices(templateKey);
  return {
    campaign_id: campaignId,
    template_key: templateKey,
    world_seed: {
      title: name,
      description,
      seed,
    },
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
    rumors: [],
    consequence_flags: {},
  };
}

function deriveWorldProfile(args: { name: string; description: string; templateKey: TemplateKey; seed: number }) {
  const { name, description, templateKey, seed } = args;
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

      const seed = hashSeed(`${campaign.id}:${name}:${description}:${templateKey}`);
      const worldProfileJson = deriveWorldProfile({ name, description, templateKey, seed });
      const baselineFactions = makeBaselineFactions(templateKey);
      const baselineCompanions = makeBaselineCompanions(seed, templateKey);
      const baselineFactionNames = baselineFactions.map((entry) => entry.name);
      const townState = makeTownState({
        campaignId: campaign.id,
        name,
        description,
        templateKey,
        seed,
        factionNames: baselineFactionNames,
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

      // Critical seed invariants: campaign ownership visibility + member row + active board must succeed.
      await runCritical(
        "campaign_members",
        svc.from("campaign_members").insert({
          campaign_id: campaign.id,
          user_id: user.userId,
          is_dm: true,
        }),
      );
      await runCritical(
        "boards",
        svc.schema("mythic").from("boards").insert({
          campaign_id: campaign.id,
          board_type: "town",
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
