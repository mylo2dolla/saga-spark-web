import { callEdgeFunction } from "@/lib/edge";

export type CampaignHealthStatus = "ready" | "needs_migration" | "broken";

export interface MythicCampaign {
  id: string;
  name: string;
  description: string | null;
  invite_code: string;
  owner_id: string;
  is_active: boolean;
  updated_at: string;
}

export interface MythicCampaignSummary extends MythicCampaign {
  member_count: number;
  is_owner: boolean;
  is_dm_member: boolean;
  health_status: CampaignHealthStatus;
  health_detail: string | null;
}

export interface CreateCampaignInput {
  name: string;
  description: string;
  templateKey: string;
}

export interface CreateCampaignResult {
  campaign: MythicCampaign;
  warnings: string[];
}

export interface JoinCampaignResult {
  campaign: MythicCampaign;
  already_member: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 2;

const withAbortTimeout = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ms);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${ms}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const isRetryableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const text = error.message.toLowerCase();
  return (
    text.includes("timed out")
    || text.includes("abort")
    || text.includes("networkerror")
    || text.includes("failed to fetch")
    || text.includes("edge_fetch_failed")
    || text.includes("temporary")
  );
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const invokeEdgeWithRetry = async <T>(
  label: string,
  timeoutMs: number,
  run: () => Promise<T>,
): Promise<T> => {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES || !isRetryableError(error)) {
        throw error;
      }
      await sleep(300 * attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
};

export async function listMythicCampaigns(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<MythicCampaignSummary[]> {
  const { data, error } = await invokeEdgeWithRetry("Campaign list", timeoutMs, () =>
    withAbortTimeout(
      (signal) => callEdgeFunction<{ ok: boolean; campaigns?: MythicCampaignSummary[]; error?: string }>(
      "mythic-list-campaigns",
      { requireAuth: true, body: {}, signal, timeoutMs },
    ),
      timeoutMs,
      "Campaign list",
    ));
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error ?? "Failed to list campaigns");
  return Array.isArray(data.campaigns) ? data.campaigns : [];
}

export async function createMythicCampaign(input: CreateCampaignInput, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CreateCampaignResult> {
  const { data, error } = await invokeEdgeWithRetry("Campaign create", timeoutMs, () =>
    withAbortTimeout(
      (signal) => callEdgeFunction<{ ok: boolean; campaign?: MythicCampaign; warnings?: string[]; error?: string }>(
      "mythic-create-campaign",
      {
        requireAuth: true,
        signal,
        timeoutMs,
        body: {
          name: input.name,
          description: input.description,
          templateKey: input.templateKey,
        },
      },
    ),
      timeoutMs,
      "Campaign create",
    ));
  if (error) throw error;
  if (!data?.ok || !data.campaign) {
    throw new Error(data?.error ?? "Campaign creation failed");
  }
  return {
    campaign: data.campaign,
    warnings: Array.isArray(data.warnings) ? data.warnings : [],
  };
}

export async function joinMythicCampaign(inviteCode: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<JoinCampaignResult> {
  const { data, error } = await invokeEdgeWithRetry("Campaign join", timeoutMs, () =>
    withAbortTimeout(
      (signal) => callEdgeFunction<{ ok: boolean; campaign?: MythicCampaign; already_member?: boolean; error?: string; code?: string }>(
      "mythic-join-campaign",
      {
        requireAuth: true,
        signal,
        timeoutMs,
        body: { inviteCode },
      },
    ),
      timeoutMs,
      "Campaign join",
    ));
  if (error) throw error;
  if (!data?.ok || !data.campaign) {
    throw new Error(data?.error ?? "Failed to join campaign");
  }
  return {
    campaign: data.campaign,
    already_member: Boolean(data.already_member),
  };
}
