import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useWorldGenerator } from "@/hooks/useWorldGenerator";
import { formatError, isAbortError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/useDiagnostics";
import { useDbHealth } from "@/ui/data/useDbHealth";
import { recordCampaignsRead } from "@/ui/data/networkHealth";
import { callEdgeFunction } from "@/lib/edge";
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
  const NETWORK_TIMEOUT_MS = 15000;
  const CREATE_TIMEOUT_MS = 30000;
  const WORLD_GENERATION_TIMEOUT_MS = 8000;
  const CONTENT_PERSIST_TIMEOUT_MS = 8000;

  const { user, session, isLoading: authLoading } = useAuth();
  const { generateInitialWorld, isGenerating } = useWorldGenerator();
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
  const [nameTouched, setNameTouched] = useState(false);
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
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

  const buildFallbackWorld = (seed: { title: string; description: string }): GeneratedWorld => ({
    factions: [],
    locations: [
      {
        id: "starting_location",
        name: "Town Square",
        description: `A quiet gathering place that marks the beginning of ${seed.title}.`,
        type: "settlement",
      },
    ],
    startingLocationId: "starting_location",
    npcs: [],
    initialQuest: {
      title: "A Fresh Start",
      description: "Gather your bearings and learn about the world around you.",
      briefDescription: "Explore your surroundings.",
      importance: "main",
      objectives: [
        {
          type: "explore",
          description: "Take in the sights and sounds of your starting location.",
          required: 1,
        },
      ],
      rewards: {
        xp: 25,
        gold: 10,
        items: [],
        storyFlags: [],
      },
    },
    worldHooks: [],
  });

  const persistGeneratedContent = useCallback(async (
    campaignId: string,
    content: Array<{
      campaign_id: string;
      content_type: string;
      content_id: string;
      content: Json;
      generation_context: Json;
    }>
  ) => {
    const edgeResult = await callEdgeFunction<{ error?: string }>(
      "world-content-writer",
      {
        body: {
          campaignId,
          content,
        },
        requireAuth: true,
        accessToken: activeAccessToken,
      }
    );

    if (!edgeResult.error && !edgeResult.data?.error && !edgeResult.skipped) {
      return;
    }

    console.warn("[campaigns] edge writer failed, falling back to direct insert", {
      campaignId,
      edgeError: edgeResult.error?.message ?? null,
      edgeMessage: edgeResult.data?.error ?? null,
      skipped: edgeResult.skipped,
    });

    const fallbackResult = await supabase
      .from("ai_generated_content")
      .insert(content);

    if (fallbackResult.error) {
      if (edgeResult.error) {
        throw edgeResult.error;
      }
      if (edgeResult.data?.error) {
        throw new Error(edgeResult.data.error);
      }
      throw fallbackResult.error;
    }
  }, [activeAccessToken]);

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

  const restSelect = useCallback(async <T,>(
    table: string,
    query: string,
    accessToken: string | null,
    label: string,
  ): Promise<T[]> => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase env is not configured");
    }
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${query}`, {
      method: "GET",
      headers: {
        apikey: supabaseAnonKey,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${label} REST failed: ${res.status} ${text}`);
    }
    return (await res.json()) as T[];
  }, []);

  const callEdgeDirect = useCallback(async <T,>(
    name: string,
    body: unknown,
    accessToken: string | null,
    timeoutMs: number,
  ): Promise<T> => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase env is not configured");
    }
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(tid);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Edge ${name} failed: ${res.status} ${text}`);
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Edge ${name} returned invalid JSON`);
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
      }
      return;
    }
    if (fetchInFlightRef.current) {
      return;
    }
    if (lastLoadedUserIdRef.current === loadUserId) {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
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
      let ownedData: Campaign[] = [];
      let ownedError: Error | null = null;
      try {
        if (activeAccessToken) {
          ownedData = await restSelect<Campaign>(
            "campaigns",
            `select=*&owner_id=eq.${loadUserId}`,
            activeAccessToken,
            "Owned campaigns"
          );
        } else {
          throw new Error("Missing access token for REST fetch");
        }
      } catch (err) {
        ownedError = err as Error;
        try {
          const result = await withTimeout(
            supabase
              .from("campaigns")
              .select("*")
              .eq("owner_id", loadUserId),
            NETWORK_TIMEOUT_MS,
            "Owned campaigns fetch"
          );
          ownedData = (result.data ?? []) as Campaign[];
          if (result.error) throw result.error;
          ownedError = null;
        } catch (fallbackErr) {
          ownedError = fallbackErr as Error;
        }
      }

      if (fetchRequestIdRef.current !== requestId) return;
      if (ownedError) {
        const message = formatError(ownedError, "Failed to load owned campaigns");
        if (isMountedRef.current) {
          setError(message);
          setLastError(message);
        }
      }

      let memberCampaignIds: string[] = [];
      try {
        if (activeAccessToken) {
          const rows = await restSelect<{ campaign_id: string }>(
            "campaign_members",
            `select=campaign_id&user_id=eq.${loadUserId}`,
            activeAccessToken,
            "Campaign membership"
          );
          memberCampaignIds = rows.map(r => r.campaign_id).filter(Boolean);
        } else {
          throw new Error("Missing access token for membership fetch");
        }
      } catch (memberErr) {
        try {
          const { data: memberData, error: memberError } = await withTimeout(
            supabase
              .from("campaign_members")
              .select("campaign_id")
              .eq("user_id", loadUserId),
            NETWORK_TIMEOUT_MS,
            "Campaign members fetch"
          );
          if (memberError) throw memberError;
          memberCampaignIds = memberData?.map(member => member.campaign_id).filter(Boolean) ?? [];
        } catch (fallbackErr) {
          const message = formatError(fallbackErr, "Failed to load campaign membership");
          if (isMountedRef.current) {
            setMembersError(message);
          }
        }
      }
      if (fetchRequestIdRef.current !== requestId) return;

      let memberCampaigns: Campaign[] = [];
      if (memberCampaignIds.length > 0) {
        try {
          if (activeAccessToken) {
            const ids = memberCampaignIds.map(id => `"${id}"`).join(",");
            memberCampaigns = await restSelect<Campaign>(
              "campaigns",
              `select=*&id=in.(${ids})`,
              activeAccessToken,
              "Member campaigns"
            );
          } else {
            throw new Error("Missing access token for member campaign fetch");
          }
        } catch (memberCampaignErr) {
          try {
            const { data, error: memberCampaignsError } = await withTimeout(
              supabase
                .from("campaigns")
                .select("*")
                .in("id", memberCampaignIds),
              NETWORK_TIMEOUT_MS,
              "Member campaigns fetch"
            );

            if (memberCampaignsError) throw memberCampaignsError;
            memberCampaigns = data ?? [];
          } catch (fallbackErr) {
            const message = formatError(fallbackErr, "Failed to load member campaigns");
            if (isMountedRef.current) {
              setMembersError(message);
            }
          }
        }
      }

      const combined = new Map<string, Campaign>();
      [...(ownedData ?? []), ...memberCampaigns].forEach(campaign => {
        combined.set(campaign.id, campaign);
      });

      recordCampaignsRead();
      const campaignsList = Array.from(combined.values());
      if (isMountedRef.current && fetchRequestIdRef.current === requestId) {
        setCampaigns(campaignsList);
      }

      if (campaignsList.length > 0) {
        void (async () => {
          try {
            const ids = campaignsList.map(campaign => campaign.id);
            const { data, error: membersFetchError } = await withTimeout(
              supabase
                .from("campaign_members")
                .select("campaign_id")
                .in("campaign_id", ids),
              NETWORK_TIMEOUT_MS,
              "Campaign members batch fetch"
            );
            if (membersFetchError) throw membersFetchError;
            const grouped: Record<string, number> = {};
            (data ?? []).forEach(member => {
              const id = member.campaign_id;
              grouped[id] = (grouped[id] ?? 0) + 1;
            });
            if (isMountedRef.current && fetchRequestIdRef.current === requestId) {
              setMembersByCampaign(grouped);
            }
          } catch (membersErr) {
            const message = formatError(membersErr, "Failed to load campaign members");
            if (isMountedRef.current && fetchRequestIdRef.current === requestId) {
              setMembersError(message);
            }
          }
        })();
      }
    } catch (err) {
      if (isAbortError(err)) {
        return;
      }
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
  }, [activeAccessToken, authLoading, loadUserId, restSelect, setLastError, withTimeout]);

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
      setCreateStatus("Starting campaign creation...");
    }

    let createdCampaignId: string | null = null;
    const createTimeoutId = setTimeout(() => {
      if (!creatingRef.current || !isMountedRef.current) return;
      creatingRef.current = false;
      setIsCreating(false);
      setCreateError("Campaign creation timed out. Try again.");
      setCreateStatus(null);
    }, CREATE_TIMEOUT_MS);
    try {
      setCreateStatus("Checking session...");
      const accessToken = activeAccessToken;
      setCreateStatus("Creating campaign record...");
      let createdCampaign: Campaign | null = null;
      try {
        const edgePayload = await callEdgeDirect<{ ok: boolean; campaign: Campaign; error?: string }>(
          "mythic-create-campaign",
          { name: trimmedName, description: trimmedDescription },
          accessToken,
          12000,
        );
        if (edgePayload.ok && edgePayload.campaign?.id) {
          createdCampaign = edgePayload.campaign;
        } else {
          throw new Error(edgePayload.error ?? "Failed to create campaign");
        }
      } catch (edgeErr) {
        console.warn("[campaigns] edge create failed, falling back to direct insert", edgeErr);
      }

      if (!createdCampaign) {
        setCreateStatus("Creating campaign record (direct)...");
        const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const { data: directCampaign, error: directError } = await withTimeout(
          supabase
            .from("campaigns")
            .insert({
              name: trimmedName,
              description: trimmedDescription,
              owner_id: activeUser.id,
              invite_code: inviteCode,
              is_active: true,
            })
            .select()
            .single(),
          NETWORK_TIMEOUT_MS,
          "Direct campaign insert"
        );
        if (directError) throw directError;
        createdCampaign = directCampaign as Campaign;

        await withTimeout(
          supabase.from("campaign_members").insert({
            campaign_id: createdCampaign.id,
            user_id: activeUser.id,
            is_dm: true,
          }),
          NETWORK_TIMEOUT_MS,
          "Direct campaign member insert"
        );

        await withTimeout(
          supabase.from("combat_state").insert({ campaign_id: createdCampaign.id }),
          NETWORK_TIMEOUT_MS,
          "Direct combat state insert"
        );
      }

      if (!createdCampaign?.id) {
        throw new Error("Campaign insert returned no id");
      }
      createdCampaignId = createdCampaign.id;

      setCreateStatus("Ensuring campaign access...");
      const { error: memberEnsureError } = await withTimeout(
        supabase
          .from("campaign_members")
          .upsert(
            {
              campaign_id: createdCampaign.id,
              user_id: activeUser.id,
              is_dm: true,
            },
            { onConflict: "campaign_id,user_id", ignoreDuplicates: true },
          ),
        NETWORK_TIMEOUT_MS,
        "Ensure campaign membership",
      );
      if (memberEnsureError) throw memberEnsureError;

      const { error: combatEnsureError } = await withTimeout(
        supabase
          .from("combat_state")
          .upsert({ campaign_id: createdCampaign.id }, { onConflict: "campaign_id", ignoreDuplicates: true }),
        NETWORK_TIMEOUT_MS,
        "Ensure combat state",
      );
      if (combatEnsureError) throw combatEnsureError;

      setCreateStatus("Generating world...");
      let generatedWorld: GeneratedWorld | null = null;
      try {
        generatedWorld = await withTimeout(
          generateInitialWorld({
            title: trimmedName,
            description: trimmedDescription,
            themes: [],
          }),
          WORLD_GENERATION_TIMEOUT_MS,
          "World generation"
        );
      } catch (err) {
        console.warn("[campaigns] world generation timeout/failure, using fallback", err);
      }
      const fallbackWorld = buildFallbackWorld({
        title: trimmedName,
        description: trimmedDescription,
      });
      if (!generatedWorld) {
        setCreateStatus("Using starter world fallback...");
        toast({
          title: "Using fallback world",
          description: "World generation failed, so a starter world was created instead.",
        });
      }

      const safeWorld = generatedWorld ?? fallbackWorld;
      const factions = Array.isArray(safeWorld.factions) ? safeWorld.factions : [];
      const npcs = Array.isArray(safeWorld.npcs) ? safeWorld.npcs : [];
      const locations = Array.isArray(safeWorld.locations) ? safeWorld.locations : [];
      const worldHooks = Array.isArray(safeWorld.worldHooks) ? safeWorld.worldHooks : [];
      const initialQuest = safeWorld.initialQuest ?? fallbackWorld.initialQuest;

      const rawLocations = locations.length > 0 ? locations : fallbackWorld.locations;
      const normalizedLocations = normalizeLocations(rawLocations);
      const startingLocationId = safeWorld.startingLocationId ?? fallbackWorld.startingLocationId;
      const resolvedStartingId =
        normalizedLocations.find(loc => loc.id === startingLocationId)?.id
        ?? normalizedLocations[0]?.id
        ?? null;

      const contentToStore = [
        ...factions.map(f => ({
          campaign_id: createdCampaign.id,
          content_type: "faction",
          content_id: f.id,
          content: JSON.parse(JSON.stringify(f)) as Json,
          generation_context: { title: trimmedName, description: trimmedDescription, themes: [] } as Json,
        })),
        ...npcs.map((npc, i) => ({
          campaign_id: createdCampaign.id,
          content_type: "npc",
          content_id: `npc_initial_${i}`,
          content: JSON.parse(JSON.stringify(npc)) as Json,
          generation_context: { title: newCampaignName.trim(), description: newCampaignDescription.trim(), themes: [] } as Json,
        })),
        ...(initialQuest
          ? [{
            campaign_id: createdCampaign.id,
            content_type: "quest",
            content_id: "initial_quest",
            content: JSON.parse(JSON.stringify(initialQuest)) as Json,
            generation_context: { title: trimmedName, description: trimmedDescription, themes: [] } as Json,
          }]
          : []),
        ...normalizedLocations.map((location) => ({
          campaign_id: createdCampaign.id,
          content_type: "location",
          content_id: location.id,
          content: JSON.parse(JSON.stringify(location)) as Json,
          generation_context: { title: trimmedName, description: trimmedDescription, themes: [] } as Json,
        })),
        ...worldHooks.map((hook, index) => ({
          campaign_id: createdCampaign.id,
          content_type: "world_hooks",
          content_id: `world_hook_${index}`,
          content: JSON.parse(JSON.stringify([hook])) as Json,
          generation_context: { title: trimmedName, description: trimmedDescription, themes: [] } as Json,
        })),
      ];

      try {
        setCreateStatus("Saving world content...");
        await withTimeout(
          persistGeneratedContent(createdCampaign.id, contentToStore),
          CONTENT_PERSIST_TIMEOUT_MS,
          "Persist generated content"
        );
      } catch (err) {
        console.warn("[campaigns] persistGeneratedContent failed, continuing", err);
      }

      if (resolvedStartingId) {
        const sceneName = normalizedLocations.find(loc => loc.id === resolvedStartingId)?.name ?? normalizedLocations[0]?.name;
        if (sceneName) {
          try {
            setCreateStatus("Finalizing scene...");
            await withTimeout(
              supabase
                .from("campaigns")
                .update({ current_scene: sceneName })
                .eq("id", createdCampaign.id),
              NETWORK_TIMEOUT_MS,
              "Scene update"
            );
          } catch {
            // Non-blocking: scene update can be patched later.
          }
        }
      }

      setCreateStatus("Campaign ready.");
      toast({
        title: "Campaign created",
        description: `${createdCampaign.name} is ready.`,
      });

      if (isMountedRef.current) {
        setNewCampaignName("");
        setNewCampaignDescription("");
        setNameTouched(false);
        setDescriptionTouched(false);
        setSubmitAttempted(false);
        setCampaigns(prev => [createdCampaign as Campaign, ...prev]);
      }
      fetchCampaigns();
      navigate(`/mythic/${createdCampaign.id}/create-character`);
    } catch (err) {
      if (createdCampaignId) {
        try {
          await supabase.from("campaigns").delete().eq("id", createdCampaignId);
        } catch {
          // Best effort only.
        }
      }
      const message = formatError(err, "Failed to create campaign");
      if (isMountedRef.current) {
        setLastError(message);
        setCreateError(message);
      }
      setCreateStatus(null);
      toast({ title: "Failed to create campaign", description: message, variant: "destructive" });
    } finally {
      clearTimeout(createTimeoutId);
      if (isMountedRef.current) {
        setIsCreating(false);
      }
      creatingRef.current = false;
      setCreateStatus(null);
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
        user_id: activeUser.id,
        is_dm: false,
      });

      toast({ title: "Joined campaign", description: campaign.name });
      if (isMountedRef.current) {
        setInviteCode("");
      }
      fetchCampaigns();
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
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigate(`/mythic/${campaign.id}`)}>Open</Button>
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
    handleRetry,
    isDeleting,
    isLoading,
    membersByCampaign,
    membersError,
    navigate,
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-base">Campaigns</CardTitle>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleDeleteAll}
              disabled={isDeleting || campaigns.length === 0}
            >
              {isDeleting ? "Deleting..." : "Delete All"}
            </Button>
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
              <Input
                placeholder="Campaign name"
                value={newCampaignName}
                onChange={e => setNewCampaignName(e.target.value)}
                onBlur={() => setNameTouched(true)}
              />
              {showNameError ? (
                <div className="text-xs text-destructive">Campaign name is required.</div>
              ) : null}
              <Textarea
                placeholder="Campaign description"
                value={newCampaignDescription}
                onChange={e => setNewCampaignDescription(e.target.value)}
                onBlur={() => setDescriptionTouched(true)}
              />
              {showDescriptionError ? (
                <div className="text-xs text-destructive">Campaign description is required.</div>
              ) : null}
              {createError ? (
                <div className="text-xs text-destructive">{createError}</div>
              ) : null}
              {createStatus ? (
                <div className="text-xs text-muted-foreground">{createStatus}</div>
              ) : null}
              <Button onClick={handleCreate} disabled={authLoading || isCreating || isGenerating || !isCreateValid}>
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
