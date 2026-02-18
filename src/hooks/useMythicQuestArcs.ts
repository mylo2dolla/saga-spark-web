import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type { MythicQuestArc, MythicQuestArcRow, MythicQuestObjectiveRow } from "@/types/mythicDm";
import { getMythicE2EQuestArcs, isMythicE2E } from "@/ui/e2e/mythicState";

export function useMythicQuestArcs(campaignId: string | undefined) {
  const [arcs, setArcs] = useState<MythicQuestArc[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchArcs = useCallback(async () => {
    if (!campaignId) {
      if (isMountedRef.current) {
        setArcs([]);
        setError(null);
        setIsLoading(false);
      }
      return;
    }

    if (isMythicE2E(campaignId)) {
      if (isMountedRef.current) {
        setArcs(getMythicE2EQuestArcs(campaignId));
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

      const { data: arcRows, error: arcsError } = await supabase
        .schema("mythic")
        .from("quest_arcs")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("priority", { ascending: false })
        .order("updated_at", { ascending: false });
      if (arcsError) throw arcsError;

      const { data: objectiveRows, error: objectivesError } = await supabase
        .schema("mythic")
        .from("quest_objectives")
        .select("*")
        .eq("campaign_id", campaignId)
        .order("sort_order", { ascending: true })
        .order("updated_at", { ascending: false });
      if (objectivesError) throw objectivesError;

      const objectivesByArc = new Map<string, MythicQuestObjectiveRow[]>();
      for (const objective of objectiveRows ?? []) {
        const current = objectivesByArc.get(objective.arc_id) ?? [];
        current.push(objective);
        objectivesByArc.set(objective.arc_id, current);
      }

      const nextArcs: MythicQuestArc[] = (arcRows ?? []).map((arc: MythicQuestArcRow) => ({
        ...arc,
        objectives: objectivesByArc.get(arc.id) ?? [],
      }));

      if (isMountedRef.current) {
        setArcs(nextArcs);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError(formatError(e, "Failed to load quest arcs"));
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [campaignId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchArcs();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchArcs]);

  return {
    arcs,
    isLoading,
    error,
    refetch: fetchArcs,
  };
}
