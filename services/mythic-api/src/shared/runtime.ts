import { createServiceClient } from "./supabase.js";

export type MythicRuntimeMode = "town" | "travel" | "dungeon" | "combat";

export type MythicRuntimeRow = {
  id: string;
  campaign_id: string;
  mode: MythicRuntimeMode;
  status: "active" | "archived" | "paused";
  state_json: Record<string, unknown>;
  ui_hints_json: Record<string, unknown>;
  combat_session_id: string | null;
  updated_at: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeRuntimeMode(value: unknown): MythicRuntimeMode {
  if (value === "town" || value === "travel" || value === "dungeon" || value === "combat") {
    return value;
  }
  return "town";
}

export async function ensureCampaignRuntime(
  svc: ReturnType<typeof createServiceClient>,
  campaignId: string,
  options?: {
    preferredMode?: MythicRuntimeMode;
    stateOverride?: Record<string, unknown>;
    uiHintsOverride?: Record<string, unknown>;
    combatSessionId?: string | null;
  },
): Promise<MythicRuntimeRow> {
  const existing = await svc
    .schema("mythic")
    .from("campaign_runtime")
    .select("id,campaign_id,mode,status,state_json,ui_hints_json,combat_session_id,updated_at")
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (existing.error) throw existing.error;

  if (existing.data) {
    const row = existing.data as Record<string, unknown>;
    return {
      id: String(row.id),
      campaign_id: String(row.campaign_id),
      mode: normalizeRuntimeMode(row.mode),
      status: (row.status as MythicRuntimeRow["status"]) ?? "active",
      state_json: asRecord(row.state_json),
      ui_hints_json: asRecord(row.ui_hints_json),
      combat_session_id: typeof row.combat_session_id === "string" ? row.combat_session_id : null,
      updated_at: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
    };
  }

  const mode = options?.preferredMode ?? "town";
  const state = options?.stateOverride ?? {};
  const uiHints = options?.uiHintsOverride ?? { camera: { x: 0, y: 0, zoom: 1 } };
  const combatSessionId = options?.combatSessionId ?? null;

  const inserted = await svc
    .schema("mythic")
    .from("campaign_runtime")
    .insert({
      campaign_id: campaignId,
      mode,
      status: "active",
      state_json: state,
      ui_hints_json: uiHints,
      combat_session_id: combatSessionId,
    })
    .select("id,campaign_id,mode,status,state_json,ui_hints_json,combat_session_id,updated_at")
    .single();
  if (inserted.error) throw inserted.error;

  const row = inserted.data as Record<string, unknown>;
  return {
    id: String(row.id),
    campaign_id: String(row.campaign_id),
    mode: normalizeRuntimeMode(row.mode),
    status: (row.status as MythicRuntimeRow["status"]) ?? "active",
    state_json: asRecord(row.state_json),
    ui_hints_json: asRecord(row.ui_hints_json),
    combat_session_id: typeof row.combat_session_id === "string" ? row.combat_session_id : null,
    updated_at: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
  };
}

export async function appendRuntimeEvent(args: {
  svc: ReturnType<typeof createServiceClient>;
  campaignId: string;
  runtimeId: string;
  fromMode: MythicRuntimeMode | null;
  toMode: MythicRuntimeMode;
  reason: string;
  payload: Record<string, unknown>;
}) {
  const insert = await args.svc
    .schema("mythic")
    .from("runtime_events")
    .insert({
      campaign_id: args.campaignId,
      runtime_id: args.runtimeId,
      from_mode: args.fromMode,
      to_mode: args.toMode,
      reason: args.reason,
      payload_json: args.payload,
    });
  if (insert.error) throw insert.error;
}

export async function updateRuntimeState(args: {
  svc: ReturnType<typeof createServiceClient>;
  runtimeId: string;
  mode?: MythicRuntimeMode;
  state: Record<string, unknown>;
  uiHints?: Record<string, unknown>;
  combatSessionId?: string | null;
}) {
  const patch: Record<string, unknown> = {
    state_json: args.state,
    updated_at: new Date().toISOString(),
  };
  if (args.mode) patch.mode = args.mode;
  if (args.uiHints) patch.ui_hints_json = args.uiHints;
  if (args.combatSessionId !== undefined) patch.combat_session_id = args.combatSessionId;

  const update = await args.svc
    .schema("mythic")
    .from("campaign_runtime")
    .update(patch)
    .eq("id", args.runtimeId);
  if (update.error) throw update.error;
}

export async function loadRecentRuntimeEvents(
  svc: ReturnType<typeof createServiceClient>,
  campaignId: string,
  limit = 20,
) {
  const query = await svc
    .schema("mythic")
    .from("runtime_events")
    .select("id,from_mode,to_mode,reason,payload_json,created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (query.error) throw query.error;
  return (query.data ?? []) as Array<Record<string, unknown>>;
}

export { asRecord, normalizeRuntimeMode };
