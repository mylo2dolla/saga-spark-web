import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type { MythicStoryBeat } from "@/types/mythicDm";
import { getMythicE2EStoryBeats, isMythicE2E } from "@/ui/e2e/mythicState";

export function useMythicStoryTimeline(campaignId: string | undefined, limit = 30) {
  const [beats, setBeats] = useState<MythicStoryBeat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchBeats = useCallback(async () => {
    if (!campaignId) {
      if (isMountedRef.current) {
        setBeats([]);
        setError(null);
        setIsLoading(false);
      }
      return;
    }

    if (isMythicE2E(campaignId)) {
      if (isMountedRef.current) {
        setBeats(getMythicE2EStoryBeats(campaignId));
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

      const { data, error: fetchError } = await supabase
        .schema("mythic")
        .from("story_beats")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (fetchError) throw fetchError;
      if (isMountedRef.current) {
        setBeats((data ?? []) as MythicStoryBeat[]);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError(formatError(e, "Failed to load story timeline"));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [campaignId, limit]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchBeats();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchBeats]);

  return {
    beats,
    isLoading,
    error,
    refetch: fetchBeats,
  };
}
