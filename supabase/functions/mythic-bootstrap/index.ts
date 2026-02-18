import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { rngInt, rngPick } from "../_shared/mythic_rng.ts";
import { createLogger } from "../_shared/logger.ts";
import { enforceRateLimit } from "../_shared/request_guard.ts";
import { sanitizeError } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
});

const syllableA = [
  "Ash", "Iron", "Dus", "Grim", "Stone", "Glen", "Oath", "Hex", "Rift", "Wolf", "Black", "Silver",
];
const syllableB = [
  "hold", "bridge", "hollow", "reach", "mark", "port", "spire", "vale", "cross", "ford", "fall", "gate",
];
const logger = createLogger("mythic-bootstrap");
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

const makeTownState = (seed: number, templateKey: TemplateKey, factionNames: string[]) => {
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
    template_key: templateKey,
    vendors,
    services: ["inn", "healer", "notice_board"],
    gossip: [],
    factions_present: factionNames,
    guard_alertness: rngInt(seed, "town:guard", 10, 60) / 100,
    bounties: [],
    rumors: [],
    consequence_flags: {},
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rateLimited = enforceRateLimit({
    req,
    route: "mythic-bootstrap",
    limit: 30,
    windowMs: 60_000,
    corsHeaders,
  });
  if (rateLimited) return rateLimited;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
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

    const authToken = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(authToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { campaignId } = parsed.data;
    logger.info("bootstrap.start", { campaign_id: campaignId });

    // Service role client for mythic schema writes (no RLS yet, but schema grants may still be restrictive).
    const svc = createClient(supabaseUrl, serviceRoleKey);

    // Ensure the campaign exists and the user is a member/owner.
    const { data: campaign, error: campaignError } = await svc
      .from("campaigns")
      .select("id, owner_id, name, description")
      .eq("id", campaignId)
      .maybeSingle();

    if (campaignError) throw campaignError;
    if (!campaign) {
      return new Response(JSON.stringify({ error: "Campaign not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: member, error: memberError } = await svc
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (memberError) throw memberError;
    if (!member && campaign.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Not authorized for this campaign" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Ensure there is an active board.
    const { data: activeBoard, error: boardError } = await svc
      .schema("mythic")
      .from("boards")
      .select("id, board_type, status")
      .eq("campaign_id", campaignId)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (boardError) throw boardError;

    if (!activeBoard) {
      const seedBase = hashSeed(`bootstrap:${campaignId}`);
      const townState = makeTownState(seedBase, templateKey, factionNames);

      const { error: insertBoardError } = await svc.schema("mythic").from("boards").insert({
        campaign_id: campaignId,
        board_type: "town",
        status: "active",
        state_json: townState,
        ui_hints_json: { camera: { x: 0, y: 0, zoom: 1.0 } },
      });

      if (insertBoardError) throw insertBoardError;

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
    }

    const profileTitle = String((campaign as { name?: string | null })?.name ?? "").trim();
    const profileDescription = String((campaign as { description?: string | null })?.description ?? "").trim();
    const profilePayload = {
      campaign_id: campaignId,
      seed_title: profileTitle.length > 0 ? profileTitle : `Campaign ${campaignId.slice(0, 8)}`,
      seed_description: profileDescription.length > 0 ? profileDescription : "World seed generated from campaign bootstrap.",
      template_key: "custom",
      world_profile_json: {
        source: "mythic-bootstrap",
        campaign_name: profileTitle,
        campaign_description: profileDescription,
      },
    };

    const { error: profileErr } = await svc
      .schema("mythic")
      .from("world_profiles")
      .upsert(
        profilePayload,
        { onConflict: "campaign_id" },
      );
    if (profileErr) {
      logger.warn("bootstrap.world_profile.warning", { campaign_id: campaignId, error: profileErr.message ?? "unknown" });
      warnings.push(`world_profile_unavailable:${profileErr.message}`);
    }
    await svc
      .schema("mythic")
      .from("campaign_world_profiles")
      .upsert(profilePayload, { onConflict: "campaign_id" });

    logger.info("bootstrap.success", { campaign_id: campaignId, warnings: warnings.length });
    return new Response(JSON.stringify({ ok: true, warnings }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("bootstrap.failed", error);
    const normalized = sanitizeError(error);
    return new Response(
      JSON.stringify({ error: normalized.message || "Failed to bootstrap campaign", code: normalized.code ?? "bootstrap_failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
