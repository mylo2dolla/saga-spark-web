import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { rngInt, rngPick } from "../_shared/mythic_rng.ts";
import { createLogger } from "../_shared/logger.ts";
import {
  enforceRateLimit,
  getIdempotentResponse,
  idempotencyKeyFromRequest,
  storeIdempotentResponse,
} from "../_shared/request_guard.ts";
import { sanitizeError } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  inviteCode: z.string().trim().min(4).max(32),
});

const syllableA = ["Ash", "Iron", "Dus", "Grim", "Stone", "Glen", "Oath", "Hex", "Rift", "Wolf", "Black", "Silver"];
const syllableB = ["hold", "bridge", "hollow", "reach", "mark", "port", "spire", "vale", "cross", "ford", "fall", "gate"];
const logger = createLogger("mythic-join-campaign");

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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rateLimited = enforceRateLimit({
    req,
    route: "mythic-join-campaign",
    limit: 30,
    windowMs: 60_000,
    corsHeaders,
  });
  if (rateLimited) return rateLimited;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Authentication required", code: "auth_required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase env is not configured (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY)");
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid request", code: "invalid_request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authToken = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(authToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid or expired authentication token", code: "auth_invalid" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(supabaseUrl, serviceRoleKey);
    const inviteCode = parsed.data.inviteCode.trim();
    const idempotencyHeader = idempotencyKeyFromRequest(req);
    const idempotencyKey = idempotencyHeader ? `${user.id}:${idempotencyHeader}` : null;
    if (idempotencyKey) {
      const cached = getIdempotentResponse(idempotencyKey);
      if (cached) {
        logger.info("join_campaign.idempotent_hit", { user_id: user.id });
        return cached;
      }
    }

    const { data: foundCampaigns, error: findError } = await svc
      .rpc("get_campaign_by_invite_code", { _invite_code: inviteCode });
    if (findError) throw findError;

    const campaign = (foundCampaigns?.[0] ?? null) as
      | {
          id: string;
          name: string;
          description: string | null;
          invite_code: string;
          owner_id: string;
          is_active: boolean;
          updated_at: string;
        }
      | null;

    if (!campaign) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid invite code", code: "invalid" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!campaign.is_active) {
      return new Response(JSON.stringify({ ok: false, error: "Invite code is inactive", code: "inactive" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existingMember, error: memberLookupError } = await svc
      .from("campaign_members")
      .select("id,is_dm")
      .eq("campaign_id", campaign.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberLookupError) throw memberLookupError;

    if (!existingMember) {
      const { error: joinError } = await svc.from("campaign_members").insert({
        campaign_id: campaign.id,
        user_id: user.id,
        is_dm: false,
      });
      if (joinError) throw joinError;
    }

    // Ensure Mythic runtime artifacts exist so joined campaigns are always actionable.
    const seedBase = hashSeed(`${campaign.id}:${user.id}:join`);
    await svc.schema("mythic").from("dm_campaign_state").upsert({ campaign_id: campaign.id }, { onConflict: "campaign_id" });
    await svc.schema("mythic").from("dm_world_tension").upsert({ campaign_id: campaign.id }, { onConflict: "campaign_id" });

    const { data: activeBoard } = await svc
      .schema("mythic")
      .from("boards")
      .select("id")
      .eq("campaign_id", campaign.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

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

    await svc
      .schema("mythic")
      .from("world_profiles")
      .upsert(worldProfilePayload, { onConflict: "campaign_id" });

    await svc
      .schema("mythic")
      .from("campaign_world_profiles")
      .upsert(worldProfilePayload, { onConflict: "campaign_id" });

    const response = new Response(JSON.stringify({
      ok: true,
      campaign,
      already_member: Boolean(existingMember),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
    if (idempotencyKey) {
      storeIdempotentResponse(idempotencyKey, response, 60_000);
    }
    logger.info("join_campaign.success", { campaign_id: campaign.id, user_id: user.id });
    return response;
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("join_campaign.failed", error);
    const message = normalized.message || "Failed to join campaign";
    return new Response(JSON.stringify({ ok: false, error: message, code: "join_failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
