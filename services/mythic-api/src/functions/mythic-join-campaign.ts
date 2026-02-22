import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { rngInt, rngPick } from "../shared/mythic_rng.js";
import { buildStarterDirection } from "../shared/intro_seed.js";
import {
  buildWorldProfilePayload,
  buildRuntimeWorldBindings,
  buildWorldSeedPayload,
  coerceCampaignContextFromProfile,
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

const RequestSchema = z.object({
  inviteCode: z.string().trim().min(4).max(32).optional(),
  invite_code: z.string().trim().min(4).max(32).optional(),
}).refine((value) => Boolean(value.inviteCode || value.invite_code), {
  message: "inviteCode is required",
  path: ["inviteCode"],
});

const syllableA = ["Ash", "Iron", "Dus", "Grim", "Stone", "Glen", "Oath", "Hex", "Rift", "Wolf", "Black", "Silver"];
const syllableB = ["hold", "bridge", "hollow", "reach", "mark", "port", "spire", "vale", "cross", "ford", "fall", "gate"];

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

const makeName = (seed: number, label: string): string => {
  const a = rngPick(seed, `${label}:a`, syllableA);
  const b = rngPick(seed, `${label}:b`, syllableB);
  return `${a}${b}`;
};

const makeTownState = (args: {
  seed: number;
  campaignName: string;
  campaignDescription: string;
  campaignContext: CampaignContext;
}) => {
  const { seed, campaignName, campaignDescription, campaignContext } = args;
  const runtimeBindings = buildRuntimeWorldBindings(campaignContext, {
    includeCampaignContext: true,
    directiveLimit: 6,
    coreConflictLimit: 4,
    factionTensionLimit: 4,
  });
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
    templateKey: "custom",
    campaignName,
    campaignDescription,
    factionNames: [],
    source: "join_campaign",
  });

  return {
    seed,
    world_seed: buildWorldSeedPayload(campaignContext, {
      includeTitleDescription: true,
      title: campaignName,
      description: campaignDescription,
      includeLegacySeed: true,
    }),
    ...runtimeBindings,
    vendors,
    services: ["inn", "healer", "notice_board"],
    gossip: [],
    factions_present: [],
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

export const mythicJoinCampaign: FunctionHandler = {
  name: "mythic-join-campaign",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-join-campaign",
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

      const svc = createServiceClient();
      const inviteCodeRaw = (parsed.data.inviteCode ?? parsed.data.invite_code ?? "").trim();
      const inviteCode = inviteCodeRaw.toUpperCase();
      const warnings: string[] = [];

      const idempotencyHeader = idempotencyKeyFromRequest(req);
      const idempotencyKey = idempotencyHeader ? `${user.userId}:${idempotencyHeader}` : null;
      if (idempotencyKey) {
        const cached = getIdempotentResponse(idempotencyKey);
        if (cached) {
          ctx.log.info("join_campaign.idempotent_hit", { request_id: ctx.requestId, user_id: user.userId });
          return cached;
        }
      }

      // Do not use the legacy RPC here. It may return a partial campaign row and break
      // "inactive"/UI expectations. Query campaigns directly for all required fields.
      const { data: campaign, error: findError } = await svc
        .from("campaigns")
        .select("id,name,description,invite_code,owner_id,is_active,updated_at")
        .eq("invite_code", inviteCode)
        .maybeSingle();
      if (findError) throw findError;

      if (!campaign) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid invite code", code: "invalid", requestId: ctx.requestId }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (!campaign.is_active) {
        return new Response(JSON.stringify({ ok: false, error: "Invite code is inactive", code: "inactive", requestId: ctx.requestId }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { data: existingMember, error: memberLookupError } = await svc
        .from("campaign_members")
        .select("id,is_dm")
        .eq("campaign_id", campaign.id)
        .eq("user_id", user.userId)
        .maybeSingle();
      if (memberLookupError) throw memberLookupError;

      let alreadyMember = Boolean(existingMember);
      if (!existingMember) {
        const { error: joinError } = await svc.from("campaign_members").insert({
          campaign_id: campaign.id,
          user_id: user.userId,
          is_dm: false,
        });
        if (joinError) {
          // If a unique constraint exists (campaign_id,user_id), treat the race as already_member.
          if (joinError.code === "23505") {
            alreadyMember = true;
          } else {
            throw joinError;
          }
        }
      }

      // Ensure Mythic runtime artifacts exist so joined campaigns are always actionable.
      const existingProfile = await svc
        .schema("mythic")
        .from("world_profiles")
        .select("template_key, world_profile_json, seed_title, seed_description")
        .eq("campaign_id", campaign.id)
        .maybeSingle();
      const fallbackProfile = (!existingProfile.error && existingProfile.data)
        ? null
        : await svc
          .schema("mythic")
          .from("campaign_world_profiles")
          .select("template_key, world_profile_json, seed_title, seed_description")
          .eq("campaign_id", campaign.id)
          .maybeSingle();

      const templateKey = String(
        (existingProfile.data as { template_key?: unknown } | null)?.template_key
          ?? (fallbackProfile?.data as { template_key?: unknown } | null)?.template_key
          ?? "custom",
      );
      const worldProfileJson = asRecord(
        (existingProfile.data as { world_profile_json?: unknown } | null)?.world_profile_json
          ?? (fallbackProfile?.data as { world_profile_json?: unknown } | null)?.world_profile_json,
      );
      const campaignContext = coerceCampaignContextFromProfile({
        seedTitle: String(campaign.name ?? "Mythic Campaign"),
        seedDescription: String(campaign.description ?? "World seeded from campaign join flow."),
        templateKey,
        worldProfileJson,
      });
      const seedBase = campaignContext.worldSeed.seedNumber || hashSeed(`${campaign.id}:${campaign.name}:${campaign.invite_code}`);
      const dmStateSeed = await svc
        .schema("mythic")
        .from("dm_campaign_state")
        .upsert({ campaign_id: campaign.id }, { onConflict: "campaign_id" });
      if (dmStateSeed.error) {
        warnings.push(`dm_campaign_state:${dmStateSeed.error.message ?? "unknown"}`);
      }

      const tensionSeed = await svc
        .schema("mythic")
        .from("dm_world_tension")
        .upsert({ campaign_id: campaign.id }, { onConflict: "campaign_id" });
      if (tensionSeed.error) {
        warnings.push(`dm_world_tension:${tensionSeed.error.message ?? "unknown"}`);
      }

      const { data: activeRuntimeRows, error: activeRuntimeError } = await svc
        .schema("mythic")
        .from("campaign_runtime")
        .select("id,mode,state_json,updated_at")
        .eq("campaign_id", campaign.id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(5);
      if (activeRuntimeError) throw activeRuntimeError;
      if ((activeRuntimeRows?.length ?? 0) > 1) {
        warnings.push("duplicate_active_runtime_rows_detected:using_latest_runtime_row");
        const newest = activeRuntimeRows?.[0]?.id ?? null;
        if (newest) {
          const extras = (activeRuntimeRows ?? []).slice(1).map((row) => row.id);
          if (extras.length > 0) {
            const { error: archiveErr } = await svc
              .schema("mythic")
              .from("campaign_runtime")
              .update({ status: "archived" })
              .in("id", extras);
            if (archiveErr) warnings.push(`archive_duplicate_runtime_rows:${archiveErr.message ?? "unknown"}`);
          }
        }
      }
      const activeRuntime = activeRuntimeRows?.[0] ?? null;

      if (!activeRuntime) {
        const { error: runtimeInsertError } = await svc.schema("mythic").from("campaign_runtime").insert({
          campaign_id: campaign.id,
          mode: "town",
          status: "active",
          state_json: makeTownState({
            seed: seedBase,
            campaignName: String(campaign.name ?? "Mythic Campaign"),
            campaignDescription: String(campaign.description ?? "A dangerous world in motion."),
            campaignContext,
          }),
          ui_hints_json: { camera: { x: 0, y: 0, zoom: 1.0 } },
        });
        if (runtimeInsertError) throw runtimeInsertError;
      } else if (activeRuntime.mode === "town") {
        const activeState = asRecord(activeRuntime.state_json);
        const runtimeBindings = buildRuntimeWorldBindings(campaignContext, {
          includeCampaignContext: true,
          directiveLimit: 6,
          coreConflictLimit: 4,
          factionTensionLimit: 4,
        });
        const patchedState = {
          ...activeState,
          ...runtimeBindings,
        };
        const patchRuntime = await svc
          .schema("mythic")
          .from("campaign_runtime")
          .update({ state_json: patchedState })
          .eq("id", activeRuntime.id);
        if (patchRuntime.error) {
          warnings.push(`runtime_context_patch:${patchRuntime.error.message ?? "unknown"}`);
        }
      }

      const worldProfilePayload = {
        campaign_id: campaign.id,
        seed_title: campaign.name,
        seed_description: campaign.description ?? "World seeded from campaign join flow.",
        template_key: templateKey,
        world_profile_json: buildWorldProfilePayload({
          source: "mythic-join-campaign",
          campaignContext,
          templateKey,
        }),
      };

      const worldProfileResult = await svc
        .schema("mythic")
        .from("world_profiles")
        .upsert(worldProfilePayload, { onConflict: "campaign_id", ignoreDuplicates: true });
      if (worldProfileResult.error) {
        warnings.push(`world_profiles:${worldProfileResult.error.message ?? "unknown"}`);
      }

      const legacyProfileResult = await svc
        .schema("mythic")
        .from("campaign_world_profiles")
        .upsert(worldProfilePayload, { onConflict: "campaign_id", ignoreDuplicates: true });
      if (legacyProfileResult.error) {
        warnings.push(`campaign_world_profiles:${legacyProfileResult.error.message ?? "unknown"}`);
      }

      if (warnings.length > 0) {
        ctx.log.warn("join_campaign.profile_mirror_warning", {
          campaign_id: campaign.id,
          user_id: user.userId,
          request_id: ctx.requestId,
          warnings,
        });
      }

      const response = new Response(JSON.stringify({
        ok: true,
        campaign,
        already_member: alreadyMember,
        world_forge_version: WORLD_FORGE_VERSION,
        world_seed: buildWorldSeedPayload(campaignContext),
        warnings,
        requestId: ctx.requestId,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

      if (idempotencyKey) {
        storeIdempotentResponse(idempotencyKey, response, 60_000);
      }

      ctx.log.info("join_campaign.success", { request_id: ctx.requestId, campaign_id: campaign.id, user_id: user.userId });
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
      ctx.log.error("join_campaign.failed", { request_id: ctx.requestId, error: normalized.message, code: normalized.code });
      const message = normalized.message || "Failed to join campaign";
      return new Response(JSON.stringify({ ok: false, error: message, code: "join_failed", requestId: ctx.requestId }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
