import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/useDiagnostics";
import { useDbHealth } from "@/ui/data/useDbHealth";
import { callEdgeFunction } from "@/lib/edge";
import { toFriendlyEdgeError } from "@/lib/edgeError";
import { PromptAssistField } from "@/components/PromptAssistField";
import { runOperation } from "@/lib/ops/runOperation";
import type { OperationState } from "@/lib/ops/operationState";
import { createLogger } from "@/lib/observability/logger";
import { AsyncStateCard } from "@/ui/components/AsyncStateCard";

type HealthStatus = "ready" | "needs_migration" | "broken";

type TemplateKey =
  | "custom"
  | "graphic_novel_fantasy"
  | "sci_fi_ruins"
  | "post_apoc_warlands"
  | "gothic_horror"
  | "mythic_chaos";

interface CampaignSummary {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  owner_id: string;
  is_active: boolean;
  updated_at: string;
  member_count: number;
  is_owner: boolean;
  is_dm_member: boolean;
  health_status: HealthStatus;
  health_detail: string | null;
}

const TEMPLATE_OPTIONS: Array<{ key: TemplateKey; label: string; description: string }> = [
  { key: "custom", label: "Custom", description: "Use your own seed and let Mythic adapt." },
  { key: "graphic_novel_fantasy", label: "Graphic Novel Fantasy", description: "Heroic pulp, factions, and brutal adventure." },
  { key: "sci_fi_ruins", label: "Sci-Fi Ruins", description: "Fallen megacities, relic tech, and hard survival." },
  { key: "post_apoc_warlands", label: "Post-Apoc Warlands", description: "Warlords, scavenging, and resource conflict." },
  { key: "gothic_horror", label: "Gothic Horror", description: "Dread, omens, and cursed strongholds." },
  { key: "mythic_chaos", label: "Mythic Chaos", description: "High-power instability and escalating danger." },
];

const HEALTH_BADGE: Record<HealthStatus, { label: string; className: string }> = {
  ready: {
    label: "Mythic Ready",
    className: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  },
  needs_migration: {
    label: "Needs Migration",
    className: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  },
  broken: {
    label: "Broken (Repair)",
    className: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  },
};

function inferJoinErrorCode(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("invalid invite") || lower.includes("invalid")) return "invalid";
  if (lower.includes("inactive")) return "inactive";
  if (lower.includes("already")) return "already_member";
  return "join_failed";
}

export default function DashboardScreen() {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { setLastError, recordOperation } = useDiagnostics();
  const logger = useMemo(() => createLogger("dashboard-screen"), []);

  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignDescription, setNewCampaignDescription] = useState("");
  const [templateKey, setTemplateKey] = useState<TemplateKey>("custom");

  const [inviteCode, setInviteCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);

  const [createError, setCreateError] = useState<string | null>(null);
  const [createErrorCode, setCreateErrorCode] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinErrorCode, setJoinErrorCode] = useState<string | null>(null);
  const [createWarning, setCreateWarning] = useState<string | null>(null);
  const [lastCreatedCampaignId, setLastCreatedCampaignId] = useState<string | null>(null);
  const [loadOp, setLoadOp] = useState<OperationState | null>(null);
  const [createOp, setCreateOp] = useState<OperationState | null>(null);
  const [joinOp, setJoinOp] = useState<OperationState | null>(null);
  const createAbortRef = useRef<AbortController | null>(null);
  const joinAbortRef = useRef<AbortController | null>(null);

  const activeSession = session ?? null;
  const activeUser = user ?? null;
  const activeUserId = session?.user?.id ?? user?.id ?? null;
  const activeAccessToken = activeSession?.access_token ?? null;
  const dbEnabled = Boolean(activeUserId);
  const { status: dbStatus, lastError: dbError } = useDbHealth(dbEnabled);

  const loadCampaigns = useCallback(async () => {
    if (!activeAccessToken) {
      setCampaigns([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const { result } = await runOperation({
        name: "dashboard.load_campaigns",
        timeoutMs: 10_000,
        maxRetries: 2,
        onUpdate: (state) => {
          setLoadOp(state);
          recordOperation(state);
        },
        run: async ({ signal }) => {
          const { data, error } = await callEdgeFunction<{ ok: boolean; campaigns: CampaignSummary[] }>(
            "mythic-list-campaigns",
            { requireAuth: true, accessToken: activeAccessToken, body: {}, signal },
          );
          if (error) {
            throw error;
          }
          if (!data?.ok || !Array.isArray(data.campaigns)) {
            throw new Error("Failed to list campaigns");
          }
          return data.campaigns;
        },
      });
      setCampaigns(result);
    } catch (err) {
      const message = formatError(err, "Failed to load campaigns");
      setError(message);
      setLastError(message);
      logger.error("dashboard.load_campaigns.failed", err);
    } finally {
      setIsLoading(false);
    }
  }, [activeAccessToken, logger, recordOperation, setLastError]);

  useEffect(() => {
    void loadCampaigns();
  }, [loadCampaigns]);

  const repairCampaign = useCallback(async (campaignId: string) => {
    setIsRepairing(true);
    try {
      const { result } = await runOperation({
        name: "dashboard.repair_campaign",
        timeoutMs: 15_000,
        maxRetries: 1,
        onUpdate: (state) => recordOperation(state),
        run: async ({ signal }) => {
          const { data, error: edgeError } = await callEdgeFunction<{ ok: boolean; warnings?: string[] }>("mythic-bootstrap", {
            requireAuth: true,
            body: { campaignId },
            signal,
          });
          if (edgeError) throw edgeError;
          if (!data?.ok) throw new Error("Campaign repair failed");
          return data;
        },
      });
      const warningText = Array.isArray(result.warnings) && result.warnings.length > 0
        ? ` (${result.warnings.join("; ")})`
        : "";
      toast({ title: "Campaign repaired", description: `Mythic runtime synchronized${warningText}` });
      await loadCampaigns();
    } catch (err) {
      const message = formatError(err, "Failed to repair campaign");
      setError(message);
      toast({ title: "Repair failed", description: message, variant: "destructive" });
    } finally {
      setIsRepairing(false);
    }
  }, [loadCampaigns, recordOperation, toast]);

  const handleCreate = async () => {
    const name = newCampaignName.trim();
    const description = newCampaignDescription.trim();

    if (!activeUser || !activeAccessToken) {
      setCreateError("You must be signed in to create a campaign.");
      setCreateErrorCode("auth_required");
      return;
    }
    if (!name || !description) {
      setCreateError("Campaign name and description are required.");
      setCreateErrorCode("invalid_request");
      return;
    }

    createAbortRef.current?.abort();
    const controller = new AbortController();
    createAbortRef.current = controller;
    setIsCreating(true);
    setCreateError(null);
    setCreateErrorCode(null);
    setCreateWarning(null);
    setLastError(null);

    try {
      const { result: data } = await runOperation({
        name: "dashboard.create_campaign",
        signal: controller.signal,
        timeoutMs: 16_000,
        maxRetries: 1,
        onUpdate: (state) => {
          setCreateOp(state);
          recordOperation(state);
        },
        run: async ({ signal }) => {
          const { data, error } = await callEdgeFunction<{
            ok: boolean;
            campaign: CampaignSummary;
            world_seed_status?: string;
            warnings?: string[];
          }>(
            "mythic-create-campaign",
            {
              requireAuth: true,
              accessToken: activeAccessToken,
              signal,
              idempotencyKey: `${activeUser.id}:${name}:${description}`,
              body: {
                name,
                description,
                template_key: templateKey,
              },
            },
          );
          if (error) throw error;
          if (!data?.ok || !data.campaign?.id) throw new Error("Failed to create campaign");
          return data;
        },
      });

      const seedStatus = String(data.world_seed_status ?? "seeded");
      const warningList = Array.isArray(data.warnings) ? data.warnings : [];
      if (seedStatus !== "seeded" || warningList.length > 0) {
        setLastCreatedCampaignId(data.campaign.id);
        setCreateWarning(`World seed status: ${seedStatus}${warningList.length ? ` (${warningList.join("; ")})` : ""}`);
      } else {
        setLastCreatedCampaignId(null);
      }

      toast({
        title: "Campaign created",
        description: `${data.campaign.name} is ready in Mythic mode.`,
      });

      setNewCampaignName("");
      setNewCampaignDescription("");
      void loadCampaigns();
      navigate(`/mythic/${data.campaign.id}/create-character`);
    } catch (err) {
      const parsed = toFriendlyEdgeError(err, "Failed to create campaign");
      setCreateError(parsed.description);
      setCreateErrorCode(parsed.code);
      setLastError(parsed.description);
      toast({ title: "Failed to create campaign", description: parsed.description, variant: "destructive" });
    } finally {
      createAbortRef.current = null;
      setIsCreating(false);
    }
  };

  const handleJoin = async () => {
    const code = inviteCode.trim();
    if (!activeUser || !activeAccessToken) {
      setJoinError("You must be signed in to join a campaign.");
      setJoinErrorCode("auth_required");
      return;
    }
    if (!code) {
      setJoinError("Invite code is required.");
      setJoinErrorCode("invalid");
      return;
    }

    joinAbortRef.current?.abort();
    const controller = new AbortController();
    joinAbortRef.current = controller;
    setIsJoining(true);
    setJoinError(null);
    setJoinErrorCode(null);
    setLastError(null);

    try {
      const { result: data } = await runOperation({
        name: "dashboard.join_campaign",
        signal: controller.signal,
        timeoutMs: 18_000,
        maxRetries: 1,
        onUpdate: (state) => {
          setJoinOp(state);
          recordOperation(state);
        },
        run: async ({ signal }) => {
          const { data, error } = await callEdgeFunction<{ ok: boolean; campaign: CampaignSummary; already_member?: boolean }>(
            "mythic-join-campaign",
            {
              requireAuth: true,
              accessToken: activeAccessToken,
              signal,
              idempotencyKey: `${activeUser.id}:${code}`,
              body: { inviteCode: code },
            },
          );
          if (error) throw error;
          if (!data?.ok || !data.campaign) {
            throw new Error("Failed to join campaign");
          }
          return data;
        },
      });

      toast({
        title: data.already_member ? "Already in campaign" : "Joined campaign",
        description: data.campaign.name,
      });
      setInviteCode("");
      void loadCampaigns();
      navigate(`/mythic/${data.campaign.id}`);
    } catch (err) {
      const parsed = toFriendlyEdgeError(err, "Failed to join campaign");
      setJoinError(parsed.description);
      setJoinErrorCode(parsed.code ?? inferJoinErrorCode(parsed.description));
      setLastError(parsed.description);
      toast({ title: "Failed to join campaign", description: parsed.description, variant: "destructive" });
    } finally {
      joinAbortRef.current = null;
      setIsJoining(false);
    }
  };

  const campaignCountLabel = useMemo(() => {
    if (isLoading) return "Loading campaigns...";
    if (campaigns.length === 0) return "No campaigns yet.";
    return `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"}`;
  }, [campaigns.length, isLoading]);

  const dbStatusLabel = dbEnabled ? dbStatus : "paused";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Mythic-only campaigns and access codes.</p>
        <div className="mt-2 text-xs text-muted-foreground">
          Auth: {activeSession ? "session" : "guest"} | userId: {activeUserId ?? "null"} | DB: {dbStatusLabel}
        </div>
        {loadOp?.status === "RUNNING" ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Campaign sync running (attempt {loadOp.attempt})
          </div>
        ) : null}
        {dbError ? <div className="mt-1 text-xs text-destructive">DB Error: {dbError}</div> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <AsyncStateCard
          title="Campaigns"
          state={
            error
              ? "error"
              : isLoading
                ? "loading"
                : campaigns.length === 0
                  ? "empty"
                  : "success"
          }
          message={
            error
              ? error
              : isLoading
                ? "Loading campaigns..."
                : campaigns.length === 0
                  ? "Create your first Mythic campaign."
                  : campaignCountLabel
          }
          actions={
            error
              ? [{ id: "retry-load", label: "Retry", onClick: () => void loadCampaigns() }]
              : []
          }
        >
          <div className="mb-3 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadCampaigns()} disabled={isLoading}>
              Refresh
            </Button>
          </div>
          <div className="space-y-3">
            {campaigns.map((campaign) => {
              const badge = HEALTH_BADGE[campaign.health_status];
              return (
                <Card key={campaign.id} className="border border-border">
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">{campaign.name}</div>
                        <div className="text-xs text-muted-foreground">Invite: {campaign.invite_code}</div>
                        <div className="text-xs text-muted-foreground">Members: {campaign.member_count}</div>
                        {campaign.health_detail ? (
                          <div className="text-xs text-muted-foreground">{campaign.health_detail}</div>
                        ) : null}
                      </div>
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[11px] ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => navigate(`/mythic/${campaign.id}`)}>Open</Button>
                      {campaign.health_status !== "ready" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void repairCampaign(campaign.id)}
                          disabled={isRepairing}
                        >
                          {isRepairing ? "Repairing..." : "Repair"}
                        </Button>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </AsyncStateCard>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Auth</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeSession ? (
                <div className="space-y-2 text-sm">
                  <div className="text-muted-foreground">Signed in as</div>
                  <div className="font-semibold">{activeSession.user.email}</div>
                  <div className="text-xs text-muted-foreground">{activeSession.user.id}</div>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await supabase.auth.signOut();
                      navigate("/login");
                    }}
                  >
                    Sign out
                  </Button>
                </div>
              ) : (
                <Button onClick={() => navigate("/login")}>Go to Login</Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create campaign</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <PromptAssistField
                value={newCampaignName}
                onChange={setNewCampaignName}
                fieldType="campaign_name"
                placeholder="Campaign name"
                maxLength={120}
                context={{
                  template_key: templateKey,
                }}
              />
              <PromptAssistField
                value={newCampaignDescription}
                onChange={setNewCampaignDescription}
                fieldType="campaign_description"
                placeholder="Campaign description"
                multiline
                minRows={5}
                maxLength={1000}
                context={{
                  template_key: templateKey,
                  campaign_name: newCampaignName,
                }}
              />
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="template-key">
                  World template
                </label>
                <select
                  id="template-key"
                  value={templateKey}
                  onChange={(event) => setTemplateKey(event.target.value as TemplateKey)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {TEMPLATE_OPTIONS.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <div className="text-xs text-muted-foreground">
                  {TEMPLATE_OPTIONS.find((option) => option.key === templateKey)?.description}
                </div>
              </div>

              {createError ? <div className="text-xs text-destructive">{createError}</div> : null}
              {createErrorCode ? (
                <div className="flex flex-wrap gap-2">
                  {createErrorCode === "auth_required" || createErrorCode === "auth_invalid" ? (
                    <Button size="sm" variant="outline" onClick={() => navigate("/login")}>
                      Sign in again
                    </Button>
                  ) : null}
                  {createErrorCode === "rate_limited" ? (
                    <Button size="sm" variant="outline" onClick={handleCreate} disabled={isCreating}>
                      Retry create
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {createOp?.status === "RUNNING" ? (
                <div className="text-xs text-muted-foreground">
                  Create pending (attempt {createOp.attempt}
                  {createOp.next_retry_at ? ` · retry ${new Date(createOp.next_retry_at).toLocaleTimeString()}` : ""})
                </div>
              ) : null}
              {createWarning ? (
                <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-200">
                  <div>{createWarning}</div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void loadCampaigns()} disabled={isLoading}>
                      Refresh list
                    </Button>
                    {lastCreatedCampaignId ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/mythic/${lastCreatedCampaignId}`)}
                        >
                          Open campaign
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void repairCampaign(lastCreatedCampaignId)}
                          disabled={isRepairing}
                        >
                          Repair campaign metadata
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void repairCampaign(lastCreatedCampaignId)}
                          disabled={isRepairing}
                        >
                          Re-seed world from title/description
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={handleCreate}
                  disabled={isCreating || !newCampaignName.trim() || !newCampaignDescription.trim()}
                >
                  {isCreating ? "Creating..." : "Create"}
                </Button>
                {isCreating ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      createAbortRef.current?.abort();
                      setIsCreating(false);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Join campaign</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Invite code"
                value={inviteCode}
                onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                maxLength={24}
              />
              {joinError ? <div className="text-xs text-destructive">{joinError}</div> : null}
              {joinOp?.status === "RUNNING" ? (
                <div className="text-xs text-muted-foreground">
                  Join pending (attempt {joinOp.attempt}
                  {joinOp.next_retry_at ? ` · retry ${new Date(joinOp.next_retry_at).toLocaleTimeString()}` : ""})
                </div>
              ) : null}
              {joinErrorCode ? (
                <div className="flex flex-wrap gap-2">
                  {joinErrorCode === "invalid" ? (
                    <Button size="sm" variant="outline" onClick={() => setInviteCode("")}>Clear code</Button>
                  ) : null}
                  {joinErrorCode === "inactive" ? (
                    <Button size="sm" variant="outline" onClick={() => navigate("/dashboard")}>Refresh campaigns</Button>
                  ) : null}
                  {joinErrorCode === "already_member" ? (
                    <Button size="sm" variant="outline" onClick={() => void loadCampaigns()}>Open from list</Button>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleJoin} disabled={isJoining || !inviteCode.trim()}>
                  {isJoining ? "Joining..." : "Join"}
                </Button>
                {isJoining ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      joinAbortRef.current?.abort();
                      setIsJoining(false);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
