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
import { PromptAssistField } from "@/components/PromptAssistField";
import {
  createMythicCampaign,
  joinMythicCampaign,
  listMythicCampaigns,
  type MythicCampaign,
} from "@/lib/mythicCampaigns";

type Campaign = MythicCampaign;

type CampaignHealthStatus = "ready" | "needs_migration" | "broken";

interface CampaignHealth {
  status: CampaignHealthStatus;
  detail?: string;
}

const CAMPAIGN_TEMPLATES = [
  { key: "custom", label: "Custom" },
  { key: "graphic_novel_fantasy", label: "Graphic Novel Fantasy" },
  { key: "sci_fi_ruins", label: "Sci-Fi Ruins" },
  { key: "dark_mythic_horror", label: "Dark Mythic Horror" },
  { key: "post_apocalypse", label: "Post-Apocalypse" },
] as const;

type CampaignTemplateKey = typeof CAMPAIGN_TEMPLATES[number]["key"];

export default function DashboardScreen() {
  const NETWORK_TIMEOUT_MS = 30000;

  const { user, session, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { setLastError } = useDiagnostics();

  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [membersByCampaign, setMembersByCampaign] = useState<Record<string, number>>({});
  const [membersError, setMembersError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignDescription, setNewCampaignDescription] = useState("");
  const [newCampaignTemplate, setNewCampaignTemplate] = useState<CampaignTemplateKey>("custom");
  const [nameTouched, setNameTouched] = useState(false);
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [repairingCampaignId, setRepairingCampaignId] = useState<string | null>(null);
  const [isRepairingAll, setIsRepairingAll] = useState(false);
  const [mythicHealthByCampaign, setMythicHealthByCampaign] = useState<Record<string, CampaignHealth>>({});
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const fetchInFlightRef = useRef(false);
  const fetchRequestIdRef = useRef(0);
  const lastLoadedUserIdRef = useRef<string | null>(null);
  const creatingRef = useRef(false);
  const isMountedRef = useRef(true);

  const activeSession = session ?? null;
  const activeUser = user ?? null;
  const activeUserId = session?.user?.id ?? user?.id ?? null;
  const activeAccessToken = activeSession?.access_token ?? null;
  const loadUserId = authLoading ? null : (session?.user?.id ?? null);
  const dbEnabled = !authLoading && Boolean(activeUserId);
  const { status: dbStatus, lastError: dbError } = useDbHealth(dbEnabled, activeAccessToken);

  const withTimeout = useCallback(async <T,>(
    promise: Promise<T>,
    ms: number,
    label: string
  ): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchCampaigns = useCallback(async () => {
    if (authLoading || !loadUserId) {
      if (isMountedRef.current) {
        setIsLoading(false);
        setCampaigns([]);
        setMembersByCampaign({});
        setMythicHealthByCampaign({});
      }
      return;
    }
    if (fetchInFlightRef.current) {
      return;
    }
    fetchInFlightRef.current = true;
    const requestId = fetchRequestIdRef.current + 1;
    fetchRequestIdRef.current = requestId;
    if (isMountedRef.current) {
      setIsLoading(true);
      setError(null);
      setLastError(null);
      setMembersError(null);
    }

    try {
      const summaries = await listMythicCampaigns(NETWORK_TIMEOUT_MS);
      if (fetchRequestIdRef.current !== requestId) return;

      const nextCampaigns: Campaign[] = summaries.map((summary) => ({
        id: summary.id,
        name: summary.name,
        description: summary.description,
        invite_code: summary.invite_code,
        owner_id: summary.owner_id,
        is_active: summary.is_active,
        updated_at: summary.updated_at,
      }));

      const nextMembers: Record<string, number> = {};
      const nextHealth: Record<string, CampaignHealth> = {};
      for (const summary of summaries) {
        nextMembers[summary.id] = Number.isFinite(summary.member_count) ? Math.max(0, summary.member_count) : 0;
        nextHealth[summary.id] = {
          status: summary.health_status,
          detail: summary.health_detail ?? undefined,
        };
      }

      if (isMountedRef.current && fetchRequestIdRef.current === requestId) {
        setCampaigns(nextCampaigns);
        setMembersByCampaign(nextMembers);
        setMythicHealthByCampaign(nextHealth);
        setMembersError(null);
      }
    } catch (err) {
      console.error("Failed to load campaigns", err);
      const message = formatError(err, "Failed to load campaigns");
      if (isMountedRef.current && fetchRequestIdRef.current === requestId) {
        setError(message);
        setLastError(message);
      }
    } finally {
      if (isMountedRef.current && fetchRequestIdRef.current === requestId) {
        setIsLoading(false);
      }
      if (fetchRequestIdRef.current === requestId) {
        fetchInFlightRef.current = false;
        lastLoadedUserIdRef.current = loadUserId;
      }
    }
  }, [NETWORK_TIMEOUT_MS, authLoading, loadUserId, setLastError]);

  const handleRetry = useCallback(() => {
    lastLoadedUserIdRef.current = null;
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleForceRefresh = useCallback(() => {
    lastLoadedUserIdRef.current = null;
    fetchRequestIdRef.current += 1;
    fetchInFlightRef.current = false;
    fetchCampaigns();
  }, [fetchCampaigns]);

  useEffect(() => {
    if (authLoading || !loadUserId) {
      setCampaigns([]);
      setIsLoading(false);
      setError(null);
      return;
    }
    fetchCampaigns();
  }, [authLoading, fetchCampaigns, loadUserId]);

  useEffect(() => {
    if (!isLoading) return;
    const timeoutId = setTimeout(() => {
      if (!isMountedRef.current) return;
      setIsLoading(false);
      setError(prev => prev ?? "Campaigns load timed out. Use Retry to try again.");
    }, 15000);
    return () => clearTimeout(timeoutId);
  }, [isLoading]);

  const trimmedName = newCampaignName.trim();
  const trimmedDescription = newCampaignDescription.trim();
  const isNameValid = trimmedName.length > 0;
  const isDescriptionValid = trimmedDescription.length > 0;
  const showNameError = (nameTouched || submitAttempted) && !isNameValid;
  const showDescriptionError = (descriptionTouched || submitAttempted) && !isDescriptionValid;
  const isCreateValid = isNameValid && isDescriptionValid;

  const handleCreate = async () => {
    if (!activeUser || !isCreateValid) {
      setSubmitAttempted(true);
      if (!activeUser) {
        setCreateError("You must be signed in to create a campaign.");
      }
      return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;
    if (isMountedRef.current) {
      setIsCreating(true);
      setLastError(null);
      setCreateError(null);
      setCreateStatus("Creating campaign...");
    }

    try {
      const { campaign: createdCampaign, warnings } = await createMythicCampaign(
        {
          name: trimmedName,
          description: trimmedDescription,
          templateKey: newCampaignTemplate,
        },
        NETWORK_TIMEOUT_MS,
      );

      if (warnings.length > 0) {
        toast({
          title: "Campaign created with warnings",
          description: warnings.join(" | "),
          variant: "destructive",
        });
      }

      setCreateStatus("Campaign ready.");
      toast({
        title: "Campaign created",
        description: `${createdCampaign.name} is ready.`,
      });

      if (isMountedRef.current) {
        setNewCampaignName("");
        setNewCampaignDescription("");
        setNewCampaignTemplate("custom");
        setNameTouched(false);
        setDescriptionTouched(false);
        setSubmitAttempted(false);
        setCampaigns(prev => [createdCampaign as Campaign, ...prev]);
      }
      void fetchCampaigns();
      navigate(`/mythic/${createdCampaign.id}/create-character`);
    } catch (err) {
      const message = formatError(err, "Failed to create campaign");
      if (isMountedRef.current) {
        setLastError(message);
        setCreateError(message);
      }
      setCreateStatus(null);
      toast({ title: "Failed to create campaign", description: message, variant: "destructive" });
    } finally {
      if (isMountedRef.current) {
        setIsCreating(false);
      }
      creatingRef.current = false;
    }
  };

  const handleSignIn = async () => {
    if (!authEmail.trim() || !authPassword) {
      setAuthError("Email and password are required.");
      return;
    }
    if (authBusy) return;
    if (isMountedRef.current) {
      setAuthBusy(true);
      setAuthError(null);
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) throw error;
      // Auth state is managed by useAuth() subscription.
    } catch (err) {
      const message = formatError(err, "Sign in failed");
      if (isMountedRef.current) {
        setAuthError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setAuthBusy(false);
      }
    }
  };

  const handleSignUp = async () => {
    if (!authEmail.trim() || !authPassword) {
      setAuthError("Email and password are required.");
      return;
    }
    if (authBusy) return;
    if (isMountedRef.current) {
      setAuthBusy(true);
      setAuthError(null);
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        email: authEmail.trim(),
        password: authPassword,
      });
      if (error) throw error;
      // Auth state is managed by useAuth() subscription.
    } catch (err) {
      const message = formatError(err, "Sign up failed");
      if (isMountedRef.current) {
        setAuthError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setAuthBusy(false);
      }
    }
  };

  const handleSignOut = async () => {
    if (authBusy) return;
    if (isMountedRef.current) {
      setAuthBusy(true);
      setAuthError(null);
    }
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      // Auth state is managed by useAuth() subscription.
    } catch (err) {
      const message = formatError(err, "Sign out failed");
      if (isMountedRef.current) {
        setAuthError(message);
      }
    } finally {
      if (isMountedRef.current) {
        setAuthBusy(false);
      }
    }
  };

  const handleJoin = async () => {
    if (!activeUser || !inviteCode.trim()) {
      if (!activeUser) {
        setJoinError("You must be signed in to join a campaign.");
      }
      return;
    }
    if (isMountedRef.current) {
      setIsJoining(true);
      setLastError(null);
      setJoinError(null);
    }

    try {
      const { campaign, already_member } = await joinMythicCampaign(inviteCode.trim(), NETWORK_TIMEOUT_MS);
      toast({
        title: already_member ? "Already joined campaign" : "Joined campaign",
        description: campaign.name,
      });
      if (isMountedRef.current) {
        setInviteCode("");
      }
      await fetchCampaigns();
    } catch (err) {
      const message = formatError(err, "Failed to join campaign");
      if (isMountedRef.current) {
        setLastError(message);
        setJoinError(message);
      }
      toast({ title: "Failed to join campaign", description: message, variant: "destructive" });
    } finally {
      if (isMountedRef.current) {
        setIsJoining(false);
      }
    }
  };

  const handleDeleteCampaign = useCallback(async (campaign: Campaign) => {
    if (!activeUserId) {
      toast({ title: "Sign in required", description: "You must be signed in to delete campaigns.", variant: "destructive" });
      return;
    }
    if (campaign.owner_id !== activeUserId) {
      toast({ title: "Not allowed", description: "Only the campaign owner can delete this campaign.", variant: "destructive" });
      return;
    }
    const confirmed = window.confirm(`Delete campaign "${campaign.name}"? This cannot be undone.`);
    if (!confirmed) return;
    if (isDeleting) return;
    setIsDeleting(true);
    setLastError(null);
    try {
      const { error: deleteError } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", campaign.id);
      if (deleteError) throw deleteError;
      if (isMountedRef.current) {
        setCampaigns(prev => prev.filter(c => c.id !== campaign.id));
      }
      toast({ title: "Campaign deleted", description: campaign.name });
      fetchCampaigns();
    } catch (err) {
      const message = formatError(err, "Failed to delete campaign");
      if (isMountedRef.current) {
        setLastError(message);
      }
      toast({ title: "Failed to delete campaign", description: message, variant: "destructive" });
    } finally {
      if (isMountedRef.current) {
        setIsDeleting(false);
      }
    }
  }, [activeUserId, fetchCampaigns, isDeleting, setLastError, toast]);

  const handleDeleteAll = async () => {
    if (!activeUserId) {
      toast({ title: "Sign in required", description: "You must be signed in to delete campaigns.", variant: "destructive" });
      return;
    }
    const owned = campaigns.filter(c => c.owner_id === activeUserId);
    if (owned.length === 0) {
      toast({ title: "No owned campaigns", description: "You don't own any campaigns to delete." });
      return;
    }
    const confirmed = window.confirm(`Delete all ${owned.length} owned campaign(s)? This cannot be undone.`);
    if (!confirmed) return;
    if (isDeleting) return;
    setIsDeleting(true);
    setLastError(null);
    try {
      const ids = owned.map(c => c.id);
      const { error: deleteError } = await supabase
        .from("campaigns")
        .delete()
        .in("id", ids);
      if (deleteError) throw deleteError;
      if (isMountedRef.current) {
        setCampaigns(prev => prev.filter(c => !ids.includes(c.id)));
      }
      toast({ title: "Campaigns deleted", description: `Deleted ${owned.length} campaign(s).` });
      fetchCampaigns();
    } catch (err) {
      const message = formatError(err, "Failed to delete campaigns");
      if (isMountedRef.current) {
        setLastError(message);
      }
      toast({ title: "Failed to delete campaigns", description: message, variant: "destructive" });
    } finally {
      if (isMountedRef.current) {
        setIsDeleting(false);
      }
    }
  };

  const handleRepairCampaign = useCallback(async (campaignId: string) => {
    if (!activeUserId) {
      toast({ title: "Sign in required", description: "You must be signed in to repair campaigns.", variant: "destructive" });
      return;
    }
    setRepairingCampaignId(campaignId);
    setLastError(null);
    try {
      const { data, error } = await withTimeout(
        callEdgeFunction<{ ok: boolean; warnings?: string[] }>("mythic-bootstrap", {
          requireAuth: true,
          body: { campaignId },
        }),
        NETWORK_TIMEOUT_MS,
        "Campaign repair",
      );
      if (error) throw error;
      if (!data?.ok) throw new Error("Repair failed");
      if (Array.isArray(data.warnings) && data.warnings.length > 0) {
        toast({
          title: "Campaign repaired with warnings",
          description: data.warnings.join(" | "),
          variant: "destructive",
        });
      } else {
        toast({ title: "Campaign repaired", description: "Mythic runtime restored." });
      }
      await fetchCampaigns();
    } catch (err) {
      const message = formatError(err, "Failed to repair campaign");
      setLastError(message);
      toast({ title: "Repair failed", description: message, variant: "destructive" });
    } finally {
      if (isMountedRef.current) {
        setRepairingCampaignId(null);
      }
    }
  }, [NETWORK_TIMEOUT_MS, activeUserId, fetchCampaigns, setLastError, toast, withTimeout]);

  const handleRepairAll = useCallback(async () => {
    if (!activeUserId) {
      toast({ title: "Sign in required", description: "You must be signed in to repair campaigns.", variant: "destructive" });
      return;
    }
    const pending = campaigns.filter((campaign) => (mythicHealthByCampaign[campaign.id]?.status ?? "needs_migration") !== "ready");
    if (pending.length === 0) {
      toast({ title: "All campaigns healthy", description: "No campaigns need migration/repair." });
      return;
    }
    if (isRepairingAll) return;

    setIsRepairingAll(true);
    setLastError(null);
    try {
      let repaired = 0;
      for (const campaign of pending) {
        const { data, error } = await withTimeout(
          callEdgeFunction<{ ok: boolean; warnings?: string[] }>("mythic-bootstrap", {
            requireAuth: true,
            body: { campaignId: campaign.id },
          }),
          NETWORK_TIMEOUT_MS,
          "Campaign repair",
        );
        if (error || !data?.ok) {
          throw error ?? new Error(`Repair failed for ${campaign.name}`);
        }
        repaired += 1;
      }
      toast({ title: "Repair complete", description: `Repaired ${repaired} campaign(s).` });
      await fetchCampaigns();
    } catch (err) {
      const message = formatError(err, "Failed to repair all campaigns");
      setLastError(message);
      toast({ title: "Repair failed", description: message, variant: "destructive" });
    } finally {
      if (isMountedRef.current) {
        setIsRepairingAll(false);
      }
    }
  }, [
    NETWORK_TIMEOUT_MS,
    activeUserId,
    campaigns,
    fetchCampaigns,
    isRepairingAll,
    mythicHealthByCampaign,
    setLastError,
    toast,
    withTimeout,
  ]);

  const healthBadge = useCallback((health: CampaignHealth | undefined) => {
    const status = health?.status ?? "needs_migration";
    if (status === "ready") {
      return { label: "Mythic Ready", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" };
    }
    if (status === "broken") {
      return { label: "Broken (Repair)", className: "bg-red-500/15 text-red-300 border-red-500/40" };
    }
    return { label: "Needs Migration", className: "bg-amber-500/15 text-amber-300 border-amber-500/40" };
  }, []);

  const content = useMemo(() => {
    if (isLoading) {
      return (
        <div className="space-y-2 text-sm text-muted-foreground">
          <div>Loading campaigns...</div>
          <Button size="sm" variant="outline" onClick={handleForceRefresh}>
            Force Refresh
          </Button>
        </div>
      );
    }
    if (error) {
      return (
        <div className="space-y-2 text-sm">
          <div className="text-destructive">{error}</div>
          <Button variant="outline" onClick={handleRetry}>Retry</Button>
        </div>
      );
    }
    if (campaigns.length === 0) {
      return <div className="text-sm text-muted-foreground">No campaigns yet.</div>;
    }

    return (
      <div className="space-y-3">
        {membersError ? (
          <div className="text-xs text-muted-foreground">
            Members unavailable: <span className="text-destructive">{membersError}</span>
          </div>
        ) : null}
        {campaigns.map(campaign => (
          <Card key={campaign.id} className="border border-border">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="text-sm font-semibold">{campaign.name}</div>
                <div className="text-xs text-muted-foreground">Invite: {campaign.invite_code}</div>
                {membersByCampaign[campaign.id] != null ? (
                  <div className="text-xs text-muted-foreground">
                    Members: {membersByCampaign[campaign.id]}
                  </div>
                ) : null}
                {(() => {
                  const health = mythicHealthByCampaign[campaign.id];
                  const badge = healthBadge(health);
                  return (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded border px-2 py-1 text-[11px] ${badge.className}`}>
                        {badge.label}
                      </span>
                      {health?.detail ? (
                        <span className="text-[11px] text-muted-foreground">{health.detail}</span>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigate(`/mythic/${campaign.id}`)}>Open</Button>
                {mythicHealthByCampaign[campaign.id]?.status !== "ready" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRepairCampaign(campaign.id)}
                    disabled={repairingCampaignId === campaign.id}
                  >
                    {repairingCampaignId === campaign.id ? "Repairing..." : "Repair"}
                  </Button>
                ) : null}
                {campaign.owner_id === activeUserId ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDeleteCampaign(campaign)}
                    disabled={isDeleting}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }, [
    activeUserId,
    campaigns,
    error,
    handleDeleteCampaign,
    handleForceRefresh,
    handleRepairCampaign,
    handleRetry,
    healthBadge,
    isDeleting,
    isLoading,
    membersByCampaign,
    membersError,
    mythicHealthByCampaign,
    navigate,
    repairingCampaignId,
  ]);

  const dbStatusLabel = dbEnabled ? dbStatus : "paused";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your campaigns and access codes.</p>
        <div className="mt-2 text-xs text-muted-foreground">
          Auth: {authLoading ? "loading" : (activeSession ? "session" : "guest")} | userId: {activeUserId ?? "null"} | DB: {dbStatusLabel}
        </div>
        {dbError ? (
          <div className="mt-1 text-xs text-destructive">DB Error: {dbError}</div>
        ) : null}
        {dbStatusLabel === "error" ? (
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={handleForceRefresh}>
              Force Refresh Campaigns
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Card id="campaigns">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Campaigns</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRepairAll}
                disabled={isRepairingAll || campaigns.length === 0}
              >
                {isRepairingAll ? "Repairing..." : "Migrate All"}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleDeleteAll}
                disabled={isDeleting || campaigns.length === 0}
              >
                {isDeleting ? "Deleting..." : "Delete All"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>{content}</CardContent>
        </Card>

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
                  <Button variant="outline" onClick={handleSignOut} disabled={authBusy}>
                    {authBusy ? "Signing out..." : "Sign out"}
                  </Button>
                </div>
              ) : (
                <>
                  <Input
                    placeholder="Email"
                    value={authEmail}
                    onChange={e => setAuthEmail(e.target.value)}
                  />
                  <Input
                    placeholder="Password"
                    type="password"
                    value={authPassword}
                    onChange={e => setAuthPassword(e.target.value)}
                  />
                  {authError ? (
                    <div className="text-xs text-destructive">{authError}</div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={handleSignIn} disabled={authBusy || !authEmail.trim() || !authPassword}>
                      {authBusy ? "Signing in..." : "Sign in"}
                    </Button>
                    <Button variant="outline" onClick={handleSignUp} disabled={authBusy || !authEmail.trim() || !authPassword}>
                      Sign up
                    </Button>
                  </div>
                </>
              )}
              {authError && activeSession ? (
                <div className="text-xs text-destructive">{authError}</div>
              ) : null}
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
                onBlur={() => setNameTouched(true)}
                disabled={isCreating}
                maxLength={80}
              />
              {showNameError ? (
                <div className="text-xs text-destructive">Campaign name is required.</div>
              ) : null}
              <PromptAssistField
                value={newCampaignDescription}
                onChange={setNewCampaignDescription}
                fieldType="campaign_description"
                placeholder="Campaign description"
                multiline
                minRows={5}
                disabled={isCreating}
                onBlur={() => setDescriptionTouched(true)}
                maxLength={2000}
              />
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">World template</div>
                <div className="flex flex-wrap gap-2">
                  {CAMPAIGN_TEMPLATES.map((template) => (
                    <Button
                      key={template.key}
                      type="button"
                      size="sm"
                      variant={newCampaignTemplate === template.key ? "default" : "secondary"}
                      onClick={() => setNewCampaignTemplate(template.key)}
                      disabled={isCreating}
                    >
                      {template.label}
                    </Button>
                  ))}
                </div>
              </div>
              {showDescriptionError ? (
                <div className="text-xs text-destructive">Campaign description is required.</div>
              ) : null}
              {createError ? (
                <div className="text-xs text-destructive">{createError}</div>
              ) : null}
              {createStatus ? (
                <div className="text-xs text-muted-foreground">{createStatus}</div>
              ) : null}
              <Button onClick={handleCreate} disabled={authLoading || isCreating || !isCreateValid}>
                {isCreating ? "Creating..." : "Create"}
              </Button>
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
                onChange={e => setInviteCode(e.target.value)}
              />
              {joinError ? (
                <div className="text-xs text-destructive">{joinError}</div>
              ) : null}
              <Button onClick={handleJoin} disabled={isJoining || !inviteCode.trim()}>
                {isJoining ? "Joining..." : "Join"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
