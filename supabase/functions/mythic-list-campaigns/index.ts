import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { enforceRateLimit } from "../_shared/request_guard.ts";
import { sanitizeError } from "../_shared/redact.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type CampaignRow = {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  owner_id: string;
  is_active: boolean;
  updated_at: string;
};

type MemberRow = {
  campaign_id: string;
  is_dm: boolean;
};

type HealthStatus = "ready" | "needs_migration" | "broken";

type CampaignSummary = CampaignRow & {
  member_count: number;
  is_owner: boolean;
  is_dm_member: boolean;
  health_status: HealthStatus;
  health_detail: string | null;
};

const toIsoDesc = (a: CampaignRow, b: CampaignRow) =>
  new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
const logger = createLogger("mythic-list-campaigns");

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
    route: "mythic-list-campaigns",
    limit: 60,
    windowMs: 60_000,
    corsHeaders,
  });
  if (rateLimited) return rateLimited;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Authentication required" }), {
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

    const authToken = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(authToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid or expired authentication token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(supabaseUrl, serviceRoleKey);

    const [
      { data: ownedCampaigns, error: ownedError },
      { data: memberships, error: membershipError },
    ] = await Promise.all([
      svc
        .from("campaigns")
        .select("id,name,description,invite_code,owner_id,is_active,updated_at")
        .eq("owner_id", user.id),
      svc
        .from("campaign_members")
        .select("campaign_id,is_dm")
        .eq("user_id", user.id),
    ]);

    if (ownedError) throw ownedError;
    if (membershipError) throw membershipError;

    const memberRows = (memberships ?? []) as MemberRow[];
    const memberCampaignIds = Array.from(new Set(memberRows.map((row) => row.campaign_id).filter(Boolean)));

    let memberCampaigns: CampaignRow[] = [];
    if (memberCampaignIds.length > 0) {
      const { data, error } = await svc
        .from("campaigns")
        .select("id,name,description,invite_code,owner_id,is_active,updated_at")
        .in("id", memberCampaignIds);
      if (error) throw error;
      memberCampaigns = (data ?? []) as CampaignRow[];
    }

    const campaignsMap = new Map<string, CampaignRow>();
    for (const campaign of (ownedCampaigns ?? []) as CampaignRow[]) campaignsMap.set(campaign.id, campaign);
    for (const campaign of memberCampaigns) campaignsMap.set(campaign.id, campaign);

    const campaigns = Array.from(campaignsMap.values()).sort(toIsoDesc);
    if (campaigns.length === 0) {
      return new Response(JSON.stringify({ ok: true, campaigns: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ids = campaigns.map((c) => c.id);

    const [{ data: allMembers, error: allMembersError }, { data: activeBoards, error: activeBoardsError }] = await Promise.all([
      svc
        .from("campaign_members")
        .select("campaign_id")
        .in("campaign_id", ids),
      svc
        .schema("mythic")
        .from("boards")
        .select("campaign_id")
        .in("campaign_id", ids)
        .eq("status", "active"),
    ]);

    if (allMembersError) throw allMembersError;
    if (activeBoardsError) throw activeBoardsError;

    let worldProfiles: Array<{ campaign_id: string }> = [];
    {
      const primary = await svc
        .schema("mythic")
        .from("world_profiles")
        .select("campaign_id")
        .in("campaign_id", ids);
      if (primary.error) {
        const fallback = await svc
          .schema("mythic")
          .from("campaign_world_profiles")
          .select("campaign_id")
          .in("campaign_id", ids);
        if (fallback.error) throw fallback.error;
        worldProfiles = (fallback.data ?? []) as Array<{ campaign_id: string }>;
      } else {
        worldProfiles = (primary.data ?? []) as Array<{ campaign_id: string }>;
      }
    }

    const memberCounts: Record<string, number> = {};
    for (const row of allMembers ?? []) {
      const campaignId = (row as { campaign_id?: string }).campaign_id;
      if (!campaignId) continue;
      memberCounts[campaignId] = (memberCounts[campaignId] ?? 0) + 1;
    }

    const profileSet = new Set((worldProfiles ?? []).map((row) => (row as { campaign_id?: string }).campaign_id).filter(Boolean));
    const boardSet = new Set((activeBoards ?? []).map((row) => (row as { campaign_id?: string }).campaign_id).filter(Boolean));
    const membershipMap = new Map(memberRows.map((row) => [row.campaign_id, row]));

    const summaries: CampaignSummary[] = campaigns.map((campaign) => {
      const hasProfile = profileSet.has(campaign.id);
      const hasBoard = boardSet.has(campaign.id);
      let healthStatus: HealthStatus = "needs_migration";
      let healthDetail: string | null = null;
      if (hasProfile && hasBoard) {
        healthStatus = "ready";
      } else if (!hasBoard) {
        healthStatus = "broken";
        healthDetail = "Missing active board";
      } else {
        healthStatus = "needs_migration";
        healthDetail = "Missing world profile";
      }

      return {
        ...campaign,
        member_count: memberCounts[campaign.id] ?? 0,
        is_owner: campaign.owner_id === user.id,
        is_dm_member: membershipMap.get(campaign.id)?.is_dm ?? false,
        health_status: healthStatus,
        health_detail: healthDetail,
      };
    });

    logger.info("list_campaigns.success", { user_id: user.id, campaign_count: summaries.length });
    return new Response(JSON.stringify({ ok: true, campaigns: summaries }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const normalized = sanitizeError(error);
    logger.error("list_campaigns.failed", error);
    const message = normalized.message || "Failed to list campaigns";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
