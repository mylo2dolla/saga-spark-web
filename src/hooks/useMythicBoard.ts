import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type { MythicBoardType } from "@/types/mythic";
import type { Database, Json } from "@/integrations/supabase/types";

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

type MythicBoardDbRow = Database["mythic"]["Tables"]["boards"]["Row"];
type MythicTransitionDbRow = Database["mythic"]["Tables"]["board_transitions"]["Row"];

const toRecord = (value: Json): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const toBoardStatus = (value: string): MythicBoardRow["status"] => {
  if (value === "active" || value === "archived" || value === "paused") return value;
  return "active";
};

const mapBoardRow = (row: MythicBoardDbRow): MythicBoardRow => ({
  id: row.id,
  campaign_id: row.campaign_id,
  board_type: row.board_type as MythicBoardType,
  status: toBoardStatus(row.status),
  state_json: toRecord(row.state_json),
  ui_hints_json: toRecord(row.ui_hints_json),
  active_scene_id: row.active_scene_id,
  combat_session_id: row.combat_session_id,
  updated_at: row.updated_at,
});

const mapTransitionRow = (row: MythicTransitionDbRow): MythicBoardTransitionRow => ({
  id: row.id,
  campaign_id: row.campaign_id,
  from_board_type: row.from_board_type as MythicBoardType | null,
  to_board_type: row.to_board_type as MythicBoardType,
  reason: row.reason,
  animation: row.animation,
  payload_json: toRecord(row.payload_json),
  created_at: row.created_at,
});

export function useMythicBoard(campaignId: string | undefined) {
  const [board, setBoard] = useState<MythicBoardRow | null>(null);
  const [recentTransitions, setRecentTransitions] = useState<MythicBoardTransitionRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);

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

    if (inFlightRef.current) return;
    try {
      inFlightRef.current = true;
      if (isMountedRef.current) {
        setIsLoading(true);
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
        setBoard(b ? mapBoardRow(b) : null);
        setRecentTransitions((t ?? []).map(mapTransitionRow));
      }
    } catch (e) {
      const msg = formatError(e, "Failed to load mythic board");
      if (isMountedRef.current) setError(msg);
    } finally {
      inFlightRef.current = false;
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
