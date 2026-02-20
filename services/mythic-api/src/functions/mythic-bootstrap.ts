import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { rngInt, rngPick } from "../shared/mythic_rng.js";
import { buildStarterDirection, mergeStarterDirectionIntoState } from "../shared/intro_seed.js";
import { enforceRateLimit } from "../shared/request_guard.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
});

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

type TemplateKey =
  | "custom"
  | "graphic_novel_fantasy"
  | "sci_fi_ruins"
  | "post_apoc_warlands"
  | "gothic_horror"
  | "mythic_chaos"
  | "dark_mythic_horror"
  | "post_apocalypse";

const hashSeed = (input: string): number => {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 2_147_483_647;
};

const makeName = (seed: number, label: string): string => {
  const a = rngPick(seed, `${label}:a`, syllableA);
  const b = rngPick(seed, `${label}:b`, syllableB);
  return `${a}${b}`;
};

const normalizeTemplate = (value: unknown): TemplateKey => {
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
};

const makeBaselineFactions = (template: TemplateKey): Array<{ name: string; description: string; tags: string[] }> => {
  switch (template) {
    case "sci_fi_ruins":
      return [
        { name: "Relay Wardens", description: "Custodians of relic networks.", tags: ["order", "tech", "salvage"] },
        { name: "Neon Scavengers", description: "High-risk salvage crews.", tags: ["trade", "black_market", "scavenger"] },
      ];
    case "post_apoc_warlands":
    case "post_apocalypse":
      return [
        { name: "Iron Convoy", description: "Supply-line enforcers.", tags: ["trade", "militia", "survival"] },
        { name: "Ash Cartel", description: "Warland smugglers and raiders.", tags: ["crime", "raider", "black_market"] },
      ];
    case "gothic_horror":
    case "dark_mythic_horror":
      return [
        { name: "Candle Covenant", description: "Wardens of ritual order.", tags: ["faith", "order", "ritual"] },
        { name: "Grave Syndicate", description: "Occult brokers and grave thieves.", tags: ["occult", "crime", "relics"] },
      ];
    case "mythic_chaos":
      return [
        { name: "Rift Sentinels", description: "Stabilizers of chaotic frontiers.", tags: ["order", "arcane", "guard"] },
        { name: "Laughing Spiral", description: "Chaos profiteers and cultists.", tags: ["chaos", "cult", "instability"] },
      ];
    case "graphic_novel_fantasy":
    case "custom":
    default:
      return [
        { name: "Gilded Accord", description: "Merchant power bloc.", tags: ["trade", "guild", "diplomacy"] },
        { name: "Nightwatch Compact", description: "Regional defenders.", tags: ["guard", "order", "militia"] },
      ];
  }
};

const makeTownState = (args: {
  seed: number;
  templateKey: TemplateKey;
  factionNames: string[];
  campaignName: string;
  campaignDescription: string;
}) => {
  const {
    seed,
    templateKey,
    factionNames,
    campaignName,
    campaignDescription,
  } = args;
  const vendorCount = rngInt(seed, "town:vendors", 1, 3);
  const vendors = Array.from({ length: vendorCount }).map((_, idx) => ({
    id: `vendor_${idx + 1}`,
    name: makeName(seed, `town:vendor:${idx}`),
    services: rngPick(seed, `town:vendor:svc:${idx}`, [
      ["repair", "craft"],
      ["potions", "bombs"],
      ["trade", "bank"],
      ["heal", "enchant"],
    ]),
  }));
  const starter = buildStarterDirection({
    seed,
    templateKey,
    campaignName,
    campaignDescription,
    factionNames,
    source: "bootstrap",
  });

  return {
    seed,
    template_key: templateKey,
    vendors,
    services: ["inn", "healer", "notice_board"],
    gossip: [],
    factions_present: factionNames,
    guard_alertness: rngInt(seed, "town:guard", 10, 60) / 100,
    bounties: [],
    rumors: starter.rumors,
    objectives: starter.objectives,
    discovery_log: starter.discovery_log,
    action_chips: starter.action_chips,
    discovery_flags: starter.discovery_flags,
    room_state: {},
    companion_checkins: [],
    consequence_flags: {},
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export const mythicBootstrap: FunctionHandler = {
  name: "mythic-bootstrap",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-bootstrap",
      limit: 30,
      windowMs: 60_000,
      corsHeaders: {},
      requestId: ctx.requestId,
    });
    if (rateLimited) return rateLimited;

    try {
      const user = await requireUser(req.headers);
      const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { campaignId } = parsed.data;
      ctx.log.info("bootstrap.start", { request_id: ctx.requestId, campaign_id: campaignId, user_id: user.userId });

      const svc = createServiceClient();
      await assertCampaignAccess(svc, campaignId, user.userId);

      const { data: campaign, error: campaignError } = await svc
        .from("campaigns")
        .select("id, owner_id, name, description")
        .eq("id", campaignId)
        .maybeSingle();
      if (campaignError) throw campaignError;
      const profileTitle = String((campaign as { name?: string | null })?.name ?? "").trim();
      const profileDescription = String((campaign as { description?: string | null })?.description ?? "").trim();
      const campaignName = profileTitle.length > 0 ? profileTitle : `Campaign ${campaignId.slice(0, 8)}`;
      const campaignDescription = profileDescription.length > 0 ? profileDescription : "World seed generated from campaign bootstrap.";

      // Ensure DM state rows exist.
      await svc.schema("mythic").from("dm_campaign_state").upsert({ campaign_id: campaignId }, { onConflict: "campaign_id" });
      await svc.schema("mythic").from("dm_world_tension").upsert({ campaign_id: campaignId }, { onConflict: "campaign_id" });

      const warnings: string[] = [];
      let templateKey: TemplateKey = "custom";
      const profileRow = await svc
        .schema("mythic")
        .from("world_profiles")
        .select("template_key")
        .eq("campaign_id", campaignId)
        .maybeSingle();
      if (!profileRow.error && profileRow.data?.template_key) {
        templateKey = normalizeTemplate(profileRow.data.template_key);
      } else {
        const fallbackProfile = await svc
          .schema("mythic")
          .from("campaign_world_profiles")
          .select("template_key")
          .eq("campaign_id", campaignId)
          .maybeSingle();
        if (!fallbackProfile.error && fallbackProfile.data?.template_key) {
          templateKey = normalizeTemplate(fallbackProfile.data.template_key);
        }
      }

      const baselineFactions = makeBaselineFactions(templateKey);
      const factionNames = baselineFactions.map((entry) => entry.name);
      const { error: factionSeedError } = await svc.schema("mythic").from("factions").upsert(
        baselineFactions.map((faction) => ({
          campaign_id: campaignId,
          name: faction.name,
          description: faction.description,
          tags: faction.tags,
        })),
        { onConflict: "campaign_id,name" },
      );
      if (factionSeedError) {
        warnings.push(`faction_seed_warning:${factionSeedError.message}`);
      }

      // Ensure there is an active runtime row.
      const { data: activeRuntime, error: runtimeError } = await svc
        .schema("mythic")
        .from("campaign_runtime")
        .select("id, mode, status, state_json")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (runtimeError) throw runtimeError;

      if (!activeRuntime) {
        const seedBase = hashSeed(`bootstrap:${campaignId}`);
        const townState = makeTownState({
          seed: seedBase,
          templateKey,
          factionNames,
          campaignName,
          campaignDescription,
        });

        const { error: insertRuntimeError } = await svc.schema("mythic").from("campaign_runtime").insert({
          campaign_id: campaignId,
          mode: "town",
          status: "active",
          state_json: townState,
          ui_hints_json: { camera: { x: 0, y: 0, zoom: 1.0 } },
        });

        if (insertRuntimeError) throw insertRuntimeError;

        if (factionNames.length === 0) {
          await svc.schema("mythic").from("factions").upsert(
            {
              campaign_id: campaignId,
              name: makeName(seedBase, "faction"),
              description: "A local power bloc with interests in keeping order and collecting leverage.",
              tags: ["order", "influence", "watchers"],
            },
            { onConflict: "campaign_id,name" },
          );
        }
      } else if (activeRuntime.mode === "town") {
        const activeState = asRecord((activeRuntime as { state_json?: unknown }).state_json) ?? {};
        const discoveryFlags = asRecord(activeState.discovery_flags) ?? {};
        if (discoveryFlags.intro_pending !== true) {
          const { data: latestTurn, error: turnErr } = await svc
            .schema("mythic")
            .from("turns")
            .select("id")
            .eq("campaign_id", campaignId)
            .order("turn_index", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (turnErr) {
            warnings.push(`turn_lookup_warning:${turnErr.message ?? "unknown"}`);
          } else if (!latestTurn) {
            const seedBase = hashSeed(`bootstrap:${campaignId}`);
            const starter = buildStarterDirection({
              seed: seedBase,
              templateKey,
              campaignName,
              campaignDescription,
              factionNames,
              source: "bootstrap",
            });
            const mergedState = mergeStarterDirectionIntoState(activeState, starter);
            const patchRuntime = await svc
              .schema("mythic")
              .from("campaign_runtime")
              .update({ state_json: mergedState })
              .eq("id", activeRuntime.id);
            if (patchRuntime.error) {
              warnings.push(`intro_seed_patch_warning:${patchRuntime.error.message ?? "unknown"}`);
            }
          }
        }
      }
      const profilePayload = {
        campaign_id: campaignId,
        seed_title: campaignName,
        seed_description: campaignDescription,
        template_key: templateKey,
        world_profile_json: {
          source: "mythic-bootstrap",
          campaign_name: profileTitle,
          campaign_description: profileDescription,
        },
      };

      const { error: profileErr } = await svc
        .schema("mythic")
        .from("world_profiles")
        .upsert(profilePayload, { onConflict: "campaign_id" });
      if (profileErr) {
        ctx.log.warn("bootstrap.world_profile.warning", { request_id: ctx.requestId, campaign_id: campaignId, error: profileErr.message ?? "unknown" });
        warnings.push(`world_profile_unavailable:${profileErr.message}`);
      }
      await svc
        .schema("mythic")
        .from("campaign_world_profiles")
        .upsert(profilePayload, { onConflict: "campaign_id" });

      ctx.log.info("bootstrap.success", { request_id: ctx.requestId, campaign_id: campaignId, warnings: warnings.length });
      return new Response(JSON.stringify({ ok: true, warnings }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (error instanceof AuthError) {
        const message = error.code === "auth_required" ? "Authentication required" : "Invalid or expired authentication token";
        return new Response(JSON.stringify({ error: message }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (error instanceof AuthzError) {
        return new Response(JSON.stringify({ error: error.message, code: error.code, requestId: ctx.requestId }), {
          status: error.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const normalized = sanitizeError(error);
      ctx.log.error("bootstrap.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      return new Response(
        JSON.stringify({ error: normalized.message || "Failed to bootstrap campaign", code: normalized.code ?? "bootstrap_failed" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  },
};
