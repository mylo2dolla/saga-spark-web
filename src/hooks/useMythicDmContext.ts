import { useCallback, useEffect, useRef, useState } from "react";
import { callEdgeFunction } from "@/lib/edge";
import { formatError } from "@/ui/data/async";

export interface MythicDmContextPayload {
  ok: boolean;
  campaign_id: string;
  player_id: string;
  board: unknown;
  character: unknown;
  combat: unknown;
  rules: unknown;
  script: unknown;
  dm_campaign_state: unknown;
  dm_world_tension: unknown;
}

export function useMythicDmContext(campaignId: string | undefined, enabled = true) {
  const [data, setData] = useState<MythicDmContextPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const fetchOnce = useCallback(async () => {
    if (!campaignId || !enabled) {
      if (isMountedRef.current) {
        setData(null);
        setIsLoading(false);
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

      const res = await callEdgeFunction<MythicDmContextPayload>("mythic-dm-context", {
        requireAuth: true,
        body: { campaignId },
      });

      if (res.error) throw res.error;
      if (!res.data?.ok) throw new Error("mythic-dm-context returned not ok");

      if (isMountedRef.current) setData(res.data);
    } catch (e) {
      if (isMountedRef.current) setError(formatError(e, "Failed to load mythic DM context"));
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [campaignId, enabled]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchOnce();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchOnce]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchOnce,
  };
}
