import { z } from "zod";

import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { rngInt, rngPick } from "../shared/mythic_rng.js";
import {
  enforceRateLimit,
  getIdempotentResponse,
  idempotencyKeyFromRequest,
  storeIdempotentResponse,
} from "../shared/request_guard.js";
import { sanitizeError } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

const RequestSchema = z.object({
  inviteCode: z.string().trim().min(4).max(32),
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

const makeName = (seed: number, label: string): string => {
  const a = rngPick(seed, `${label}:a`, syllableA);
  const b = rngPick(seed, `${label}:b`, syllableB);
  return `${a}${b}`;
};

const makeTownState = (seed: number) => {
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

  return {
    seed,
    vendors,
    services: ["inn", "healer", "notice_board"],
    gossip: [],
    factions_present: [],
    guard_alertness: rngInt(seed, "town:guard", 10, 60) / 100,
    bounties: [],
    rumors: [],
    consequence_flags: {},
  };
};

type CampaignRpcRow = {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  owner_id: string;
  is_active: boolean;
  updated_at: string;
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
      const inviteCode = parsed.data.inviteCode.trim();
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

      const { data: foundCampaigns, error: findError } = await svc
        .rpc("get_campaign_by_invite_code", { _invite_code: inviteCode });
      if (findError) throw findError;

      const campaign = (foundCampaigns?.[0] ?? null) as CampaignRpcRow | null;
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

      if (!existingMember) {
        const { error: joinError } = await svc.from("campaign_members").insert({
          campaign_id: campaign.id,
          user_id: user.userId,
          is_dm: false,
        });
        if (joinError) throw joinError;
      }

      // Ensure Mythic runtime artifacts exist so joined campaigns are always actionable.
      const seedBase = hashSeed(`${campaign.id}:${user.userId}:join`);
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

      const { data: activeBoards, error: activeBoardError } = await svc
        .schema("mythic")
        .from("boards")
        .select("id")
        .eq("campaign_id", campaign.id)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(2);
      if (activeBoardError) throw activeBoardError;
      if ((activeBoards?.length ?? 0) > 1) {
        warnings.push("duplicate_active_boards_detected:using_latest_board_row");
      }
      const activeBoard = activeBoards?.[0] ?? null;

      if (!activeBoard) {
        const { error: boardInsertError } = await svc.schema("mythic").from("boards").insert({
          campaign_id: campaign.id,
          board_type: "town",
          status: "active",
          state_json: makeTownState(seedBase),
          ui_hints_json: { camera: { x: 0, y: 0, zoom: 1.0 } },
        });
        if (boardInsertError) throw boardInsertError;
      }

      const worldProfilePayload = {
        campaign_id: campaign.id,
        seed_title: campaign.name,
        seed_description: campaign.description ?? "World seeded from campaign join flow.",
        template_key: "custom",
        world_profile_json: {
          source: "mythic-join-campaign",
          title: campaign.name,
          description: campaign.description ?? "",
        },
      };

      const worldProfileResult = await svc
        .schema("mythic")
        .from("world_profiles")
        .upsert(worldProfilePayload, { onConflict: "campaign_id" });
      if (worldProfileResult.error) {
        warnings.push(`world_profiles:${worldProfileResult.error.message ?? "unknown"}`);
      }

      const legacyProfileResult = await svc
        .schema("mythic")
        .from("campaign_world_profiles")
        .upsert(worldProfilePayload, { onConflict: "campaign_id" });
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
        already_member: Boolean(existingMember),
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

