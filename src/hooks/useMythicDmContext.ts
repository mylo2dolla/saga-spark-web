import { useCallback, useEffect, useRef, useState } from "react";
import { callEdgeFunction } from "@/lib/edge";
import { formatError } from "@/ui/data/async";
import type { MythicDmContextResponse } from "@/types/mythic";
import { publishMythicDebugSnapshot } from "@/lib/mythicDebugStore";

interface UseMythicDmContextOptions {
  boardUpdatedAt?: string | null;
  refreshSignal?: number;
  pollMsVisible?: number;
}

export function useMythicDmContext(
  campaignId: string | undefined,
  options: UseMythicDmContextOptions = {},
) {
  const [context, setContext] = useState<MythicDmContextResponse | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const requestSeqRef = useRef(0);
  const activeSeqRef = useRef(0);
  const hasLoadedOnceRef = useRef(false);
  const isMountedRef = useRef(true);
  const campaignRef = useRef<string | undefined>(campaignId);
  const lastBoardUpdatedAtRef = useRef<string | null>(null);

  const fetchContext = useCallback(async () => {
    if (!campaignId) {
      if (isMountedRef.current) {
        setContext(null);
        setError(null);
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
      hasLoadedOnceRef.current = false;
      lastBoardUpdatedAtRef.current = null;
      return;
    }

    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    activeSeqRef.current = requestSeq;
    const requestCampaignId = campaignId;

    try {
      inFlightRef.current = true;
      pendingRef.current = false;
      if (isMountedRef.current) {
        if (hasLoadedOnceRef.current) {
          setIsRefreshing(true);
        } else {
          setIsInitialLoading(true);
        }
        setError(null);
      }

      const { data, error: edgeError } = await callEdgeFunction<MythicDmContextResponse>("mythic-dm-context", {
        requireAuth: true,
        timeoutMs: 20_000,
        maxRetries: 1,
        body: { campaignId },
      });
      if (edgeError) throw edgeError;
      if (!data?.ok) {
        throw new Error("DM context request returned an invalid payload.");
      }

      const isLatest = requestSeq === activeSeqRef.current;
      const sameCampaign = campaignRef.current === requestCampaignId;
      if (isMountedRef.current && isLatest && sameCampaign) {
        publishMythicDebugSnapshot({
          capturedAt: new Date().toISOString(),
          campaignId: requestCampaignId,
          context: data,
        });
        setContext(data);
      }
    } catch (err) {
      const message = formatError(err, "Failed to load DM context");
      const isLatest = requestSeq === activeSeqRef.current;
      const sameCampaign = campaignRef.current === requestCampaignId;
      if (isMountedRef.current && isLatest && sameCampaign) {
        setError(message);
      }
    } finally {
      inFlightRef.current = false;
      const isLatest = requestSeq === activeSeqRef.current;
      const sameCampaign = campaignRef.current === requestCampaignId;
      if (isLatest && sameCampaign) {
        hasLoadedOnceRef.current = true;
      }
      if (isMountedRef.current && isLatest && sameCampaign) {
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
      if (pendingRef.current && campaignRef.current === requestCampaignId) {
        pendingRef.current = false;
        void fetchContext();
      }
    }
  }, [campaignId]);

  useEffect(() => {
    isMountedRef.current = true;
    campaignRef.current = campaignId;
    if (campaignId) {
      hasLoadedOnceRef.current = false;
      setIsInitialLoading(true);
      setIsRefreshing(false);
    }
    void fetchContext();
    return () => {
      isMountedRef.current = false;
    };
  }, [campaignId, fetchContext]);

  useEffect(() => {
    if (!campaignId) return;
    const incoming = options.boardUpdatedAt ?? null;
    if (!incoming) return;
    if (lastBoardUpdatedAtRef.current === incoming) return;
    lastBoardUpdatedAtRef.current = incoming;
    if (!hasLoadedOnceRef.current) return;
    void fetchContext();
  }, [campaignId, fetchContext, options.boardUpdatedAt]);

  useEffect(() => {
    if (!campaignId) return;
    if (!hasLoadedOnceRef.current) return;
    void fetchContext();
  }, [campaignId, fetchContext, options.refreshSignal]);

  useEffect(() => {
    if (!campaignId) return;
    const pollMs = Math.max(4_000, Math.min(60_000, Math.floor(options.pollMsVisible ?? 12_000)));
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void fetchContext();
    }, pollMs);
    return () => clearInterval(interval);
  }, [campaignId, fetchContext, options.pollMsVisible]);

  return {
    context,
    isInitialLoading,
    isRefreshing,
    error,
    refetch: fetchContext,
  };
}
