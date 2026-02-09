import { useCallback, useState } from "react";
import { toast } from "sonner";
import { callEdgeFunction } from "@/lib/edge";

export function useMythicCombat() {
  const [isStarting, setIsStarting] = useState(false);

  const startCombat = useCallback(async (campaignId: string) => {
    setIsStarting(true);
    try {
      const { data, error } = await callEdgeFunction<{ ok: boolean; combat_session_id: string }>("mythic-combat-start", {
        requireAuth: true,
        body: { campaignId },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error("Combat start failed");
      toast.success("Combat started");
      return data.combat_session_id;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to start combat";
      toast.error(msg);
      return null;
    } finally {
      setIsStarting(false);
    }
  }, []);

  return {
    isStarting,
    startCombat,
  };
}
