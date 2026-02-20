import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type { MythicBoardType, MythicBoardState, MythicBoardTransitionPayload } from "@/types/mythic";

export interface MythicBoardRow {
  id: string;
  campaign_id: string;
  mode: MythicBoardType;
  board_type: MythicBoardType;
  status: "active" | "archived" | "paused";
  state_json: MythicBoardState;
  ui_hints_json: Record<string, unknown>;
  active_scene_id: string | null;
  combat_session_id: string | null;
  updated_at: string;
}

export interface MythicBoardTransitionRow {
  id: string;
  campaign_id: string;
  from_mode: MythicBoardType | null;
  to_mode: MythicBoardType;
  from_board_type: MythicBoardType | null;
  to_board_type: MythicBoardType;
  reason: string;
  animation: string;
  payload_json: MythicBoardTransitionPayload;
  created_at: string;
}

export function useMythicBoard(campaignId: string | undefined) {
  const [board, setBoard] = useState<MythicBoardRow | null>(null);
  const [recentTransitions, setRecentTransitions] = useState<MythicBoardTransitionRow[]>([]);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const hasLoadedOnceRef = useRef(false);

  const fetchState = useCallback(async () => {
    if (!campaignId) {
      if (isMountedRef.current) {
        setIsInitialLoading(false);
        setIsRefreshing(false);
        setBoard(null);
        setRecentTransitions([]);
        setError(null);
      }
      hasLoadedOnceRef.current = false;
      return;
    }

    if (inFlightRef.current) return;
    try {
      inFlightRef.current = true;
      if (isMountedRef.current) {
        if (hasLoadedOnceRef.current) {
          setIsRefreshing(true);
        } else {
          setIsInitialLoading(true);
        }
        setError(null);
      }

      const mythic = supabase.schema("mythic") as any;

      const { data: b, error: bErr } = await mythic
        .from("campaign_runtime")
        .select("id,campaign_id,mode,status,state_json,ui_hints_json,combat_session_id,updated_at")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (bErr) throw bErr;

      const { data: t, error: tErr } = await mythic
        .from("runtime_events")
        .select("id,campaign_id,from_mode,to_mode,reason,payload_json,created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (tErr) throw tErr;

      if (isMountedRef.current) {
        const runtime = (b ?? null) as Record<string, unknown> | null;
        setBoard(runtime ? {
          id: String(runtime.id),
          campaign_id: String(runtime.campaign_id),
          mode: (runtime.mode as MythicBoardType) ?? "town",
          board_type: (runtime.mode as MythicBoardType) ?? "town",
          status: (runtime.status as MythicBoardRow["status"]) ?? "active",
          state_json: (runtime.state_json as MythicBoardState) ?? {},
          ui_hints_json: (runtime.ui_hints_json as Record<string, unknown>) ?? {},
          active_scene_id: null,
          combat_session_id: typeof runtime.combat_session_id === "string" ? runtime.combat_session_id : null,
          updated_at: typeof runtime.updated_at === "string" ? runtime.updated_at : new Date().toISOString(),
        } : null);
        setRecentTransitions(
          ((t ?? []) as Array<Record<string, unknown>>).map((row) => ({
            id: String(row.id),
            campaign_id: String(row.campaign_id),
            from_mode: (row.from_mode as MythicBoardType | null) ?? null,
            to_mode: (row.to_mode as MythicBoardType) ?? "town",
            from_board_type: (row.from_mode as MythicBoardType | null) ?? null,
            to_board_type: (row.to_mode as MythicBoardType) ?? "town",
            reason: typeof row.reason === "string" ? row.reason : "Story Progression",
            animation: "page_turn",
            payload_json: (row.payload_json as MythicBoardTransitionPayload) ?? {},
            created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
          })),
        );
      }
    } catch (e) {
      const msg = formatError(e, "Failed to load mythic board");
      if (isMountedRef.current) setError(msg);
    } finally {
      inFlightRef.current = false;
      hasLoadedOnceRef.current = true;
      if (isMountedRef.current) {
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [campaignId]);

  useEffect(() => {
    isMountedRef.current = true;
    if (campaignId) {
      hasLoadedOnceRef.current = false;
      setIsInitialLoading(true);
      setIsRefreshing(false);
    }
    fetchState();
    return () => {
      isMountedRef.current = false;
    };
  }, [campaignId, fetchState]);

  return {
    board,
    recentTransitions,
    isInitialLoading,
    isRefreshing,
    isLoading: isInitialLoading,
    error,
    refetch: fetchState,
  };
}
