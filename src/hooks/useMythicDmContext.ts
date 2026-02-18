import { useCallback, useEffect, useRef, useState } from "react";
import { callEdgeFunction } from "@/lib/edge";
import { formatError } from "@/ui/data/async";
import type { MythicDmContextPayload } from "@/types/mythicDm";
import { getMythicE2EDmContext, isMythicE2E } from "@/ui/e2e/mythicState";

export function useMythicDmContext(campaignId: string | undefined, enabled = true) {
  const [data, setData] = useState<MythicDmContextPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchOnce = useCallback(async () => {
    if (!campaignId || !enabled) {
      if (isMountedRef.current) {
        setData(null);
        setIsLoading(false);
        setError(null);
      }
      return;
    }

    if (isMythicE2E(campaignId)) {
      if (isMountedRef.current) {
        setData(getMythicE2EDmContext(campaignId));
        setIsLoading(false);
        setError(null);
      }
      return;
    }

    try {
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
