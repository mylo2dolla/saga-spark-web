import type { SupabaseClient } from "@supabase/supabase-js";

export class AuthzError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "AuthzError";
    this.code = code;
    this.status = status;
  }
}

export async function assertCampaignAccess(
  svc: SupabaseClient,
  campaignId: string,
  userId: string,
): Promise<{ campaignId: string; isDm: boolean }> {
  const { data: campaign, error: campaignError } = await svc
    .from("campaigns")
    .select("id, owner_id")
    .eq("id", campaignId)
    .maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign) {
    throw new AuthzError("campaign_not_found", "Campaign not found", 404);
  }

  // Owners always have access.
  if (campaign.owner_id === userId) {
    return { campaignId: campaign.id, isDm: true };
  }

  const { data: member, error: memberError } = await svc
    .from("campaign_members")
    .select("id, is_dm")
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();
  if (memberError) throw memberError;
  if (!member) {
    // Preserve Supabase edge semantics: campaign exists but caller lacks membership.
    throw new AuthzError("campaign_access_denied", "Not authorized for this campaign", 403);
  }

  return { campaignId, isDm: Boolean(member.is_dm) };
}

export async function assertCharacterAccess(
  svc: SupabaseClient,
  args: { characterId: string; campaignId: string; userId: string },
): Promise<{ characterId: string }> {
  const { data: character, error } = await svc
    .schema("mythic")
    .from("characters")
    .select("id, campaign_id, player_id")
    .eq("id", args.characterId)
    .maybeSingle();
  if (error) throw error;
  if (!character) {
    throw new AuthzError("character_not_found", "Character not found", 404);
  }
  if (character.campaign_id !== args.campaignId) {
    throw new AuthzError("character_campaign_mismatch", "Character does not belong to this campaign", 403);
  }
  if (character.player_id !== args.userId) {
    throw new AuthzError("character_access_denied", "Not authorized for this character", 403);
  }
  return { characterId: character.id };
}
