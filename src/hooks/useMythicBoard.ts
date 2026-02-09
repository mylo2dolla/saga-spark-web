import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type { MythicBoardType } from "@/types/mythic";

export interface MythicBoardRow {
  id: string;
  campaign_id: string;
  board_type: MythicBoardType;
  status: "active" | "archived" | "paused";
  state_json: Record<string, unknown>;
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
  payload_json: Record<string, unknown>;
  created_at: string;
}

export function useMythicBoard(campaignId: string | undefined) {
  const [board, setBoard] = useState<MythicBoardRow | null>(null);
  const [recentTransitions, setRecentTransitions] = useState<MythicBoardTransitionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchState = useCallback(async () => {
    if (!campaignId) {
      if (isMountedRef.current) {
        setIsLoading(false);
        setBoard(null);
        setRecentTransitions([]);
        setError(null);
      }
      return;
    }

    try {
      if (isMountedRef.current) {
        setIsLoading(true);
        setError(null);
      }

      const { data: b, error: bErr } = await supabase
        .from("mythic.boards")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("status", "active")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (bErr) throw bErr;

      const { data: t, error: tErr } = await supabase
        .from("mythic.board_transitions")
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
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchState();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchState]);

  return {
    board,
    recentTransitions,
    isLoading,
    error,
    refetch: fetchState,
  };
}
