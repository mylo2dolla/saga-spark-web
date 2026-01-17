import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const DEV_DEBUG = import.meta.env.DEV;

export interface Campaign {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  owner_id: string;
  current_scene: string | null;
  game_state: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CampaignMember {
  id: string;
  campaign_id: string;
  user_id: string;
  is_dm: boolean;
  joined_at: string;
  profile?: {
    display_name: string;
    avatar_url: string | null;
  };
}

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCampaigns = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      // Get campaigns where user is a member
      const { data: memberData } = await supabase
        .from("campaign_members")
        .select("campaign_id")
        .eq("user_id", user.id);

      const memberCampaignIds = memberData?.map(m => m.campaign_id) || [];

      // Get owned campaigns
      const { data: ownedData } = await supabase
        .from("campaigns")
        .select("*")
        .eq("owner_id", user.id);

      // Get member campaigns
      let memberCampaigns: Campaign[] = [];
      if (memberCampaignIds.length > 0) {
        const { data } = await supabase
          .from("campaigns")
          .select("*")
          .in("id", memberCampaignIds);
        memberCampaigns = (data || []) as unknown as Campaign[];
      }

      // Combine and dedupe
      const allCampaigns = [...(ownedData || []), ...memberCampaigns] as unknown as Campaign[];
      const uniqueCampaigns = allCampaigns.filter(
        (c, i, self) => self.findIndex(x => x.id === c.id) === i
      );

      setCampaigns(uniqueCampaigns);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        return;
      }
      console.error("Error fetching campaigns:", error);
      toast.error("Failed to load campaigns");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const createCampaign = useCallback(async (name: string, description?: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (DEV_DEBUG) {
        console.info("DEV_DEBUG campaigns create start", { name });
      }

      const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const { data, error } = await supabase
        .from("campaigns")
        .insert({ name, description, owner_id: user.id, invite_code: inviteCode, is_active: true })
        .select()
        .single();

      if (error) throw error;

      // Add owner as DM member
      await supabase
        .from("campaign_members")
        .insert({ campaign_id: data.id, user_id: user.id, is_dm: true });

      // Create combat state for campaign
      await supabase
        .from("combat_state")
        .insert({ campaign_id: data.id });

      const campaign = data as unknown as Campaign;
      setCampaigns(prev => [...prev, campaign]);
      toast.success("Campaign created!");
      if (DEV_DEBUG) {
        console.info("DEV_DEBUG campaigns create success", { campaignId: data.id });
      }
      return campaign;
    } catch (error) {
      console.error("Error creating campaign:", error);
      toast.error("Failed to create campaign");
      throw error;
    }
  }, []);

  const joinCampaign = useCallback(async (inviteCode: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (DEV_DEBUG) {
        console.info("DEV_DEBUG campaigns join start", { inviteCode });
      }

      // Find campaign by invite code
      const { data: campaignsData, error: findError } = await supabase
        .rpc("get_campaign_by_invite_code", { _invite_code: inviteCode });

      if (findError) throw findError;
      if (!campaignsData || campaignsData.length === 0) {
        throw new Error("Invalid invite code");
      }

      const campaign = campaignsData[0];

      // Check if already a member
      const { data: existing } = await supabase
        .from("campaign_members")
        .select("id")
        .eq("campaign_id", campaign.id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (existing) {
        toast.info("You're already in this campaign!");
        return campaign;
      }

      // Join as player
      const { error: joinError } = await supabase
        .from("campaign_members")
        .insert({ campaign_id: campaign.id, user_id: user.id, is_dm: false });

      if (joinError) throw joinError;

      await fetchCampaigns();
      toast.success(`Joined "${campaign.name}"!`);
      if (DEV_DEBUG) {
        console.info("DEV_DEBUG campaigns join success", { campaignId: campaign.id });
      }
      return campaign;
    } catch (error) {
      console.error("Error joining campaign:", error);
      toast.error(error instanceof Error ? error.message : "Failed to join campaign");
      throw error;
    }
  }, [fetchCampaigns]);

  const deleteCampaign = useCallback(async (campaignId: string) => {
    try {
      const { error } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", campaignId);

      if (error) throw error;

      setCampaigns(prev => prev.filter(c => c.id !== campaignId));
      toast.success("Campaign deleted");
    } catch (error) {
      console.error("Error deleting campaign:", error);
      toast.error("Failed to delete campaign");
      throw error;
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  return {
    campaigns,
    isLoading,
    createCampaign,
    joinCampaign,
    deleteCampaign,
    refetch: fetchCampaigns,
  };
}

export function useCampaignMembers(campaignId: string | undefined) {
  const [members, setMembers] = useState<CampaignMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!campaignId) return;

    const fetchMembers = async () => {
      try {
        setIsLoading(true);
        
        // Fetch members without the join since the relation might not exist
        const { data: membersData, error } = await supabase
          .from("campaign_members")
          .select("*")
          .eq("campaign_id", campaignId);

        if (error) throw error;

        // Fetch profiles separately
        const userIds = membersData?.map(m => m.user_id) || [];
        const { data: profilesData } = await supabase
          .from("profiles")
          .select("*")
          .in("user_id", userIds);

        // Combine data
        const membersWithProfiles = (membersData || []).map(member => ({
          ...member,
          profile: profilesData?.find(p => p.user_id === member.user_id)
        })) as CampaignMember[];

        setMembers(membersWithProfiles);
      } catch (error) {
        console.error("Error fetching members:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchMembers();
  }, [campaignId]);

  return { members, isLoading };
}
