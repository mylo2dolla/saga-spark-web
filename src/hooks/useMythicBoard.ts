import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type { MythicBoardType, MythicBoardState, MythicBoardTransitionPayload } from "@/types/mythic";

export interface MythicBoardRow {
  id: string;
  campaign_id: string;
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

      const { data: b, error: bErr } = await supabase
        .schema("mythic")
        .from("boards")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (bErr) throw bErr;

      const { data: t, error: tErr } = await supabase
        .schema("mythic")
        .from("board_transitions")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (tErr) throw tErr;

      if (isMountedRef.current) {
        setBoard((b ?? null) as unknown as MythicBoardRow | null);
        setRecentTransitions((t ?? []) as unknown as MythicBoardTransitionRow[]);
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
