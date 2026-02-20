import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { enforceRateLimit } from "../shared/request_guard.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

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

const nowMs = () => performance.now();

export const mythicListCampaigns: FunctionHandler = {
  name: "mythic-list-campaigns",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const startMs = nowMs();

    const rateLimited = enforceRateLimit({
      req,
      route: "mythic-list-campaigns",
      limit: 60,
      windowMs: 60_000,
      corsHeaders: {},
      requestId: ctx.requestId,
    });
    if (rateLimited) return rateLimited;

    try {
      let user = ctx.user;
      if (!user) {
        try {
          user = await requireUser(req.headers);
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
          throw error;
        }
      }
      const svc = createServiceClient();
      const warnings: string[] = [];

      const ownedStart = nowMs();
      const [
        { data: ownedCampaigns, error: ownedError },
        { data: memberships, error: membershipError },
      ] = await Promise.all([
        svc
          .from("campaigns")
          .select("id,name,description,invite_code,owner_id,is_active,updated_at")
          .eq("owner_id", user.userId),
        svc
          .from("campaign_members")
          .select("campaign_id,is_dm")
          .eq("user_id", user.userId),
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
        return new Response(JSON.stringify({ ok: true, campaigns: [], requestId: ctx.requestId, warnings }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      const ids = campaigns.map((c) => c.id);

      const [{ data: allMembers, error: allMembersError }, { data: activeRuntimeRows, error: activeRuntimeError }] = await Promise.all([
        svc
          .from("campaign_members")
          .select("campaign_id")
          .in("campaign_id", ids),
        svc
          .schema("mythic")
          .from("campaign_runtime")
          .select("campaign_id")
          .in("campaign_id", ids)
          .eq("status", "active"),
      ]);

      if (allMembersError) throw allMembersError;
      if (activeRuntimeError) throw activeRuntimeError;

      let worldProfiles: Array<{ campaign_id: string }> = [];
      let degraded = false;
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
          if (fallback.error) {
            degraded = true;
            warnings.push(`world_profile_lookup_failed:${fallback.error.message ?? "unknown"}`);
            worldProfiles = [];
          } else {
            worldProfiles = (fallback.data ?? []) as Array<{ campaign_id: string }>;
          }
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
      const runtimeSet = new Set((activeRuntimeRows ?? []).map((row) => (row as { campaign_id?: string }).campaign_id).filter(Boolean));
      const membershipMap = new Map(memberRows.map((row) => [row.campaign_id, row]));

      const summaries: CampaignSummary[] = campaigns.map((campaign) => {
        const hasProfile = profileSet.has(campaign.id);
        const hasRuntime = runtimeSet.has(campaign.id);
        let healthStatus: HealthStatus = "needs_migration";
        let healthDetail: string | null = null;
        if (hasProfile && hasRuntime) {
          healthStatus = "ready";
        } else if (!hasRuntime) {
          healthStatus = "broken";
          healthDetail = "Missing active runtime";
        } else {
          healthStatus = "needs_migration";
          healthDetail = "Missing world profile";
        }

        return {
          ...campaign,
          member_count: memberCounts[campaign.id] ?? 0,
          is_owner: campaign.owner_id === user.userId,
          is_dm_member: membershipMap.get(campaign.id)?.is_dm ?? false,
          health_status: healthStatus,
          health_detail: healthDetail,
        };
      });

      return new Response(JSON.stringify({
        ok: true,
        campaigns: summaries,
        degraded,
        warnings,
        requestId: ctx.requestId,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to list campaigns";
      return new Response(JSON.stringify({ ok: false, error: message, code: "list_failed", requestId: ctx.requestId }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
