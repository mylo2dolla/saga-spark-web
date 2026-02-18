import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { formatError } from "@/ui/data/async";
import { getMythicE2EBoard, isMythicE2E } from "@/ui/e2e/mythicState";
import { normalizeMythicBoardState } from "@/lib/mythicBoardState";
import type { MythicBoardStateV2 } from "@/types/mythicBoard";
export type MythicBoardRow = Tables<{ schema: "mythic" }, "boards">;
export type MythicBoardTransitionRow = Tables<{ schema: "mythic" }, "board_transitions">;

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

    if (isMythicE2E(campaignId)) {
      if (isMountedRef.current) {
        const e2e = getMythicE2EBoard(campaignId);
        setBoard(e2e.board);
        setRecentTransitions(e2e.transitions);
        setError(null);
        setIsLoading(false);
      }
      return;
    }

    try {
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
        setBoard(b ?? null);
        setRecentTransitions(t ?? []);
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

  const parsedBoard = useMemo(() => {
    if (!board) {
      return {
        boardStateV2: null as MythicBoardStateV2 | null,
        parseDiagnostics: [] as string[],
        parseError: null as string | null,
      };
    }
    try {
      const parsed = normalizeMythicBoardState(
        board.state_json,
        board.board_type as "town" | "travel" | "dungeon" | "combat",
        {
          campaignId: campaignId ?? undefined,
          boardId: board.id,
        },
      );
      return {
        boardStateV2: parsed.state,
        parseDiagnostics: parsed.diagnostics,
        parseError: null,
      };
    } catch (parseErr) {
      return {
        boardStateV2: null,
        parseDiagnostics: [] as string[],
        parseError: formatError(parseErr, "Failed to parse board state"),
      };
    }
  }, [board, campaignId]);

  return {
    board,
    recentTransitions,
    boardStateV2: parsedBoard.boardStateV2,
    chunkMeta: parsedBoard.boardStateV2?.chunk ?? null,
    biome: parsedBoard.boardStateV2?.chunk.biome ?? null,
    parseDiagnostics: parsedBoard.parseDiagnostics,
    parseError: parsedBoard.parseError,
    isLoading,
    error,
    refetch: fetchState,
  };
}
