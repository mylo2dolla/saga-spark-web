import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
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
const logger = createLogger("mythic-create-campaign");

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

function makeTownState(args: {
  campaignId: string;
  name: string;
  description: string;
  templateKey: TemplateKey;
  seed: number;
}) {
  const { campaignId, name, description, templateKey, seed } = args;
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
    factions_present: [],
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

async function allocateInviteCode(svc: ReturnType<typeof createClient>): Promise<string> {
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed", code: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rateLimited = enforceRateLimit({
    req,
    route: "mythic-create-campaign",
    limit: 25,
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

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase env is not configured (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY)");
    }

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid or expired authentication token", code: "auth_invalid" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid request", code: "invalid_request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const name = parsed.data.name.trim();
    const description = parsed.data.description.trim();
    const templateKey = normalizeTemplate(parsed.data.template_key);
    const svc = createClient(supabaseUrl, serviceRoleKey);
    const idempotencyHeader = idempotencyKeyFromRequest(req);
    const idempotencyKey = idempotencyHeader ? `${user.id}:${idempotencyHeader}` : null;
    if (idempotencyKey) {
      const cached = getIdempotentResponse(idempotencyKey);
      if (cached) {
        logger.info("create_campaign.idempotent_hit", { user_id: user.id });
        return cached;
      }
    }

    const inviteCodeValue = await allocateInviteCode(svc);

    const { data: campaign, error: insertErr } = await svc
      .from("campaigns")
      .insert({
        name,
        description,
        owner_id: user.id,
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
    const townState = makeTownState({
      campaignId: campaign.id,
      name,
      description,
      templateKey,
      seed,
    });

    const writeErrors: string[] = [];

    const safeExec = async (label: string, operation: Promise<{ error: { message?: string } | null }>) => {
      const { error } = await operation;
      if (error) {
        writeErrors.push(`${label}: ${error.message ?? "unknown"}`);
      }
    };

    await Promise.all([
      safeExec(
        "campaign_members",
        svc.from("campaign_members").insert({
          campaign_id: campaign.id,
          user_id: user.id,
          is_dm: true,
        }),
      ),
      safeExec(
        "combat_state",
        svc.from("combat_state").insert({ campaign_id: campaign.id }),
      ),
      safeExec(
        "dm_campaign_state",
        svc.schema("mythic").from("dm_campaign_state").upsert({ campaign_id: campaign.id }, { onConflict: "campaign_id" }),
      ),
      safeExec(
        "dm_world_tension",
        svc.schema("mythic").from("dm_world_tension").upsert({ campaign_id: campaign.id }, { onConflict: "campaign_id" }),
      ),
      safeExec(
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
      ),
      safeExec(
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
      ),
      safeExec(
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
      ),
    ]);

    const seedStatus = writeErrors.length === 0 ? "seeded" : "seeding_failed";
    if (writeErrors.length > 0) {
      logger.warn("create_campaign.partial_seed_failure", { campaign_id: campaign.id, warnings: writeErrors });
    }

    const response = new Response(
      JSON.stringify({
        ok: true,
        campaign,
        template_key: templateKey,
        world_seed_status: seedStatus,
        health_status: writeErrors.length === 0 ? "Mythic Ready" : "Needs Repair",
        warnings: writeErrors,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
    if (idempotencyKey) {
      storeIdempotentResponse(idempotencyKey, response, 60_000);
    }
    logger.info("create_campaign.success", { campaign_id: campaign.id, user_id: user.id, seed_status: seedStatus });
    return response;
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("create_campaign.failed", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: normalized.message || "Failed to create campaign",
        code: "create_failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
