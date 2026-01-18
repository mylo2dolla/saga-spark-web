import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useWorldGenerator } from "@/hooks/useWorldGenerator";
import { formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/diagnostics";
import { recordCampaignMembersRead, recordCampaignsRead } from "@/ui/data/networkHealth";
import type { Json } from "@/integrations/supabase/types";
import type { GeneratedWorld } from "@/hooks/useWorldGenerator";

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
  const { generateInitialWorld, isGenerating } = useWorldGenerator();
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
  const creatingRef = useRef(false);

  const toKebab = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const hashString = (value: string): number => {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  };

  const createDeterministicPosition = (seed: string): { x: number; y: number } => {
    const hashed = hashString(seed);
    return {
      x: 50 + (hashed % 400),
      y: 50 + ((hashed >>> 16) % 400),
    };
  };

  const normalizeLocations = (locations: GeneratedWorld["locations"]) => {
    const seenIds = new Set<string>();
    return locations.map((location, index) => {
      const baseName = location.name?.trim() || `location-${index + 1}`;
      let id = location.id?.trim() || toKebab(baseName);
      if (!id || id === "starting_location") {
        id = `location-${index + 1}`;
      }
      let uniqueId = id;
      let suffix = 1;
      while (seenIds.has(uniqueId)) {
        uniqueId = `${id}-${suffix}`;
        suffix += 1;
      }
      seenIds.add(uniqueId);
      const position = location.position?.x !== undefined && location.position?.y !== undefined
        ? { x: location.position.x, y: location.position.y }
        : createDeterministicPosition(uniqueId);
      return {
        ...location,
        id: uniqueId,
        position,
      };
    });
  };

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
      const memberData = await supabase
        .from("campaign_members")
        .select("campaign_id")
        .eq("user_id", user.id);

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

      const ownedData = await supabase
        .from("campaigns")
        .select("id, name, description, invite_code, owner_id, is_active, updated_at")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false });

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
        const memberCampaignsData = await supabase
          .from("campaigns")
          .select("id, name, description, invite_code, owner_id, is_active, updated_at")
          .in("id", memberCampaignIds)
          .order("updated_at", { ascending: false });

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
      recordCampaignsRead();

      const combined = [...(ownedData.data ?? []), ...memberCampaigns];
      const unique = combined.filter(
        (c, i, self) => self.findIndex(x => x.id === c.id) === i,
      );

      setCampaigns(unique);
    } catch (err) {
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
    if (!user || !newCampaignName.trim() || !newCampaignDescription.trim()) {
      toast({ title: "Missing info", description: "Name and description are required", variant: "destructive" });
      return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;
    setIsCreating(true);
    setLastError(null);

    let createdCampaignId: string | null = null;
    try {
      const inviteCodeValue = Math.random().toString(36).substring(2, 8).toUpperCase();
      const insertResult = await supabase
        .from("campaigns")
        .insert({
          name: newCampaignName.trim(),
          description: newCampaignDescription || null,
          owner_id: user.id,
          invite_code: inviteCodeValue,
          is_active: true,
        })
        .select("id, name, description, invite_code, owner_id, is_active, updated_at")
        .single();

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

      await supabase.from("campaign_members").insert({
        campaign_id: insertResult.data.id,
        user_id: user.id,
        is_dm: true,
      });

      await supabase.from("combat_state").insert({ campaign_id: insertResult.data.id });
      createdCampaignId = insertResult.data.id;

      const generatedWorld = await generateInitialWorld({
        title: newCampaignName.trim(),
        description: newCampaignDescription.trim(),
        themes: [],
      });
      if (!generatedWorld) {
        throw new Error("World generation failed");
      }
      if (!Array.isArray(generatedWorld.locations) || generatedWorld.locations.length === 0) {
        throw new Error("World generation returned no locations");
      }

      const normalizedLocations = normalizeLocations(generatedWorld.locations);
      const startingLocationId = generatedWorld.startingLocationId;
      const resolvedStartingId =
        normalizedLocations.find(loc => loc.id === startingLocationId)?.id
        ?? normalizedLocations[0]?.id
        ?? null;

      const contentToStore = [
        ...generatedWorld.factions.map(f => ({
          campaign_id: insertResult.data.id,
          content_type: "faction",
          content_id: f.id,
          content: JSON.parse(JSON.stringify(f)) as Json,
          generation_context: { title: newCampaignName.trim(), description: newCampaignDescription.trim(), themes: [] } as Json,
        })),
        ...generatedWorld.npcs.map((npc, i) => ({
          campaign_id: insertResult.data.id,
          content_type: "npc",
          content_id: `npc_initial_${i}`,
          content: JSON.parse(JSON.stringify(npc)) as Json,
          generation_context: { title: newCampaignName.trim(), description: newCampaignDescription.trim(), themes: [] } as Json,
        })),
        {
          campaign_id: insertResult.data.id,
          content_type: "quest",
          content_id: "initial_quest",
          content: JSON.parse(JSON.stringify(generatedWorld.initialQuest)) as Json,
          generation_context: { title: newCampaignName.trim(), description: newCampaignDescription.trim(), themes: [] } as Json,
        },
        ...normalizedLocations.map((location) => ({
          campaign_id: insertResult.data.id,
          content_type: "location",
          content_id: location.id,
          content: JSON.parse(JSON.stringify(location)) as Json,
          generation_context: { title: newCampaignName.trim(), description: newCampaignDescription.trim(), themes: [] } as Json,
        })),
        ...(generatedWorld.worldHooks ?? []).map((hook, index) => ({
          campaign_id: insertResult.data.id,
          content_type: "world_hooks",
          content_id: `world_hook_${index}`,
          content: JSON.parse(JSON.stringify([hook])) as Json,
          generation_context: { title: newCampaignName.trim(), description: newCampaignDescription.trim(), themes: [] } as Json,
        })),
      ];

      const contentResult = await supabase.functions.invoke("world-content-writer", {
        body: {
          campaignId: insertResult.data.id,
          content: contentToStore,
        },
      });
      if (contentResult.error) {
        throw contentResult.error;
      }
      if (contentResult.data?.error) {
        throw new Error(contentResult.data.error);
      }

      if (resolvedStartingId) {
        const sceneName = normalizedLocations.find(loc => loc.id === resolvedStartingId)?.name ?? normalizedLocations[0]?.name;
        if (sceneName) {
          const sceneResult = await supabase
            .from("campaigns")
            .update({ current_scene: sceneName })
            .eq("id", insertResult.data.id);
          if (sceneResult.error) throw sceneResult.error;
        }
      }

      toast({
        title: "Campaign created",
        description: `${insertResult.data.name} is ready.`,
      });

      setNewCampaignName("");
      setNewCampaignDescription("");
      setCampaigns(prev => [insertResult.data as Campaign, ...prev]);
      navigate(`/game/${insertResult.data.id}/create-character`);
    } catch (err) {
      if (createdCampaignId) {
        await supabase.from("campaigns").delete().eq("id", createdCampaignId);
      }
      const message = formatError(err, "Failed to create campaign");
      setLastError(message);
      toast({ title: "Failed to create campaign", description: message, variant: "destructive" });
    } finally {
      setIsCreating(false);
      creatingRef.current = false;
    }
  };

  const handleJoin = async () => {
    if (!user || !inviteCode.trim()) return;
    setIsJoining(true);
    setLastError(null);

    try {
      const response = await supabase.rpc("get_campaign_by_invite_code", { _invite_code: inviteCode.trim() });

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

      await supabase.from("campaign_members").insert({
        campaign_id: campaign.id,
        user_id: user.id,
        is_dm: false,
      });

      toast({ title: "Joined campaign", description: campaign.name });
      setInviteCode("");
      fetchCampaigns();
    } catch (err) {
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
                placeholder="Campaign description"
                value={newCampaignDescription}
                onChange={e => setNewCampaignDescription(e.target.value)}
              />
              <Button onClick={handleCreate} disabled={isCreating || isGenerating || !newCampaignName.trim() || !newCampaignDescription.trim()}>
                {isCreating || isGenerating ? "Creating..." : "Create"}
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
