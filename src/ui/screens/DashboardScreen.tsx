import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { withTimeout, isAbortError, formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/diagnostics";
import { recordCampaignMembersRead } from "@/ui/data/networkHealth";

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  owner_id: string;
  is_active: boolean;
  updated_at: string;
}

export default function DashboardScreen() {
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { setLastError } = useDiagnostics();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newCampaignName, setNewCampaignName] = useState("");
  const [newCampaignDescription, setNewCampaignDescription] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const fetchInFlightRef = useRef(false);
  const lastFetchAtRef = useRef<number | null>(null);

  const fetchCampaigns = useCallback(async (force = false) => {
    if (!user) return;
    const now = Date.now();
    if (!force && lastFetchAtRef.current && now - lastFetchAtRef.current < 15000) {
      return;
    }
    if (fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    setIsLoading(true);
    setError(null);
    setLastError(null);

    try {
      const memberData = await withTimeout(
        supabase
          .from("campaign_members")
          .select("campaign_id")
          .eq("user_id", user.id),
        25000,
      );

      if (memberData.error) {
        console.error("[campaigns] supabase error", {
          message: memberData.error.message,
          code: memberData.error.code,
          details: memberData.error.details,
          hint: memberData.error.hint,
          status: memberData.error.status,
        });
        throw memberData.error;
      }

      recordCampaignMembersRead();
      lastFetchAtRef.current = now;
      const memberCampaignIds = memberData.data?.map(row => row.campaign_id) ?? [];

      const ownedData = await withTimeout(
        supabase
          .from("campaigns")
          .select("id, name, description, invite_code, owner_id, is_active, updated_at")
          .eq("owner_id", user.id)
          .order("updated_at", { ascending: false }),
        25000,
      );

      if (ownedData.error) {
        console.error("[campaigns] supabase error", {
          message: ownedData.error.message,
          code: ownedData.error.code,
          details: ownedData.error.details,
          hint: ownedData.error.hint,
          status: ownedData.error.status,
        });
        throw ownedData.error;
      }

      let memberCampaigns: Campaign[] = [];
      if (memberCampaignIds.length) {
        const memberCampaignsData = await withTimeout(
          supabase
            .from("campaigns")
            .select("id, name, description, invite_code, owner_id, is_active, updated_at")
            .in("id", memberCampaignIds)
            .order("updated_at", { ascending: false }),
          25000,
        );

        if (memberCampaignsData.error) {
          console.error("[campaigns] supabase error", {
            message: memberCampaignsData.error.message,
            code: memberCampaignsData.error.code,
            details: memberCampaignsData.error.details,
            hint: memberCampaignsData.error.hint,
            status: memberCampaignsData.error.status,
          });
          throw memberCampaignsData.error;
        }

        memberCampaigns = (memberCampaignsData.data ?? []) as Campaign[];
      }

      const combined = [...(ownedData.data ?? []), ...memberCampaigns];
      const unique = combined.filter(
        (c, i, self) => self.findIndex(x => x.id === c.id) === i,
      );

      setCampaigns(unique);
    } catch (err) {
      if (isAbortError(err)) {
        setError("Request canceled/timeout");
        setLastError("Request canceled/timeout");
        return;
      }
      const message = formatError(err, "Failed to load campaigns");
      setError(message);
      setLastError(message);
      toast({ title: "Failed to load campaigns", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
      fetchInFlightRef.current = false;
    }
  }, [user, toast, setLastError]);

  useEffect(() => {
    const hasSession = Boolean(user);
    if (authLoading) {
      console.info("[auth] log", {
        step: "auth_guard",
        path: "/dashboard",
        hasSession,
        userId: user?.id ?? null,
        isLoading: authLoading,
        reason: "auth_loading",
      });
      return;
    }
    if (!user) {
      console.info("[auth] log", {
        step: "auth_guard",
        path: "/dashboard",
        hasSession: false,
        userId: null,
        isLoading: authLoading,
        reason: "no_user",
      });
      navigate("/login");
      return;
    }
    console.info("[auth] log", {
      step: "auth_guard",
      path: "/dashboard",
      hasSession: true,
      userId: user.id,
      isLoading: authLoading,
      reason: "ok",
    });
    fetchCampaigns();
  }, [authLoading, user, navigate, fetchCampaigns]);

  const handleCreate = async () => {
    if (!user || !newCampaignName.trim()) return;
    setIsCreating(true);
    setLastError(null);

    try {
      const inviteCodeValue = Math.random().toString(36).substring(2, 8).toUpperCase();
      const insertResult = await withTimeout(
        supabase
          .from("campaigns")
          .insert({
            name: newCampaignName.trim(),
            description: newCampaignDescription || null,
            owner_id: user.id,
            invite_code: inviteCodeValue,
            is_active: true,
          })
          .select("id, name, description, invite_code, owner_id, is_active, updated_at")
          .single(),
        25000,
      );

      if (insertResult.error) {
        console.error("[createCampaign] supabase error", {
          message: insertResult.error.message,
          code: insertResult.error.code,
          details: insertResult.error.details,
          hint: insertResult.error.hint,
          status: insertResult.error.status,
        });
        throw insertResult.error;
      }

      await withTimeout(
        supabase.from("campaign_members").insert({
          campaign_id: insertResult.data.id,
          user_id: user.id,
          is_dm: true,
        }),
        25000,
      );

      await withTimeout(
        supabase.from("combat_state").insert({ campaign_id: insertResult.data.id }),
        25000,
      );

      toast({
        title: "Campaign created",
        description: `${insertResult.data.name} is ready.`,
      });

      setNewCampaignName("");
      setNewCampaignDescription("");
      setCampaigns(prev => [insertResult.data as Campaign, ...prev]);
    } catch (err) {
      if (isAbortError(err)) {
        toast({ title: "Request canceled/timeout", description: "Please retry.", variant: "destructive" });
        setLastError("Request canceled/timeout");
        return;
      }
      const message = formatError(err, "Failed to create campaign");
      setLastError(message);
      toast({ title: "Failed to create campaign", description: message, variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoin = async () => {
    if (!user || !inviteCode.trim()) return;
    setIsJoining(true);
    setLastError(null);

    try {
      const response = await withTimeout(
        supabase.rpc("get_campaign_by_invite_code", { _invite_code: inviteCode.trim() }),
        25000,
      );

      if (response.error) {
        console.error("[campaigns] supabase error", {
          message: response.error.message,
          code: response.error.code,
          details: response.error.details,
          hint: response.error.hint,
          status: response.error.status,
        });
        throw response.error;
      }

      if (!response.data || response.data.length === 0) {
        throw new Error("Invalid invite code");
      }

      const campaign = response.data[0] as Campaign;

      await withTimeout(
        supabase.from("campaign_members").insert({
          campaign_id: campaign.id,
          user_id: user.id,
          is_dm: false,
        }),
        25000,
      );

      toast({ title: "Joined campaign", description: campaign.name });
      setInviteCode("");
      fetchCampaigns();
    } catch (err) {
      if (isAbortError(err)) {
        toast({ title: "Request canceled/timeout", description: "Please retry.", variant: "destructive" });
        setLastError("Request canceled/timeout");
        return;
      }
      const message = formatError(err, "Failed to join campaign");
      setLastError(message);
      toast({ title: "Failed to join campaign", description: message, variant: "destructive" });
    } finally {
      setIsJoining(false);
    }
  };

  const content = useMemo(() => {
    if (isLoading) {
      return <div className="text-sm text-muted-foreground">Loading campaigns...</div>;
    }
    if (error) {
      return (
        <div className="space-y-2 text-sm">
          <div className="text-destructive">{error}</div>
          <Button variant="outline" onClick={fetchCampaigns}>Retry</Button>
        </div>
      );
    }
    if (campaigns.length === 0) {
      return <div className="text-sm text-muted-foreground">No campaigns yet.</div>;
    }

    return (
      <div className="space-y-3">
        {campaigns.map(campaign => (
          <Card key={campaign.id} className="border border-border">
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <div className="text-sm font-semibold">{campaign.name}</div>
                <div className="text-xs text-muted-foreground">Invite: {campaign.invite_code}</div>
              </div>
              <Button size="sm" onClick={() => navigate(`/game/${campaign.id}`)}>Open</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }, [campaigns, error, fetchCampaigns, isLoading, navigate]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Your campaigns and access codes.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Campaigns</CardTitle>
          </CardHeader>
          <CardContent>{content}</CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create campaign</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                placeholder="Campaign name"
                value={newCampaignName}
                onChange={e => setNewCampaignName(e.target.value)}
              />
              <Textarea
                placeholder="Description (optional)"
                value={newCampaignDescription}
                onChange={e => setNewCampaignDescription(e.target.value)}
              />
              <Button onClick={handleCreate} disabled={isCreating || !newCampaignName.trim()}>
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
