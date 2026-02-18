import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";

export interface MythicCombatSessionRow {
  id: string;
  campaign_id: string;
  seed: number;
  status: string;
  current_turn_index: number;
  scene_json: Record<string, unknown>;
  updated_at: string;
}

export interface MythicCombatantRow {
  id: string;
  combat_session_id: string;
  entity_type: "player" | "npc" | "summon";
  player_id: string | null;
  character_id: string | null;
  name: string;
  x: number;
  y: number;
  hp: number;
  hp_max: number;
  power: number;
  power_max: number;
  armor: number;
  resist: number;
  initiative: number;
  statuses: unknown;
  is_alive: boolean;
  updated_at: string;
}

export interface MythicTurnOrderRow {
  combat_session_id: string;
  turn_index: number;
  combatant_id: string;
}

export interface MythicActionEventRow {
  id: string;
  combat_session_id: string;
  turn_index: number;
  actor_combatant_id: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function useMythicCombatState(campaignId: string | undefined, combatSessionId: string | null | undefined) {
  const [session, setSession] = useState<MythicCombatSessionRow | null>(null);
  const [combatants, setCombatants] = useState<MythicCombatantRow[]>([]);
  const [turnOrder, setTurnOrder] = useState<MythicTurnOrderRow[]>([]);
  const [events, setEvents] = useState<MythicActionEventRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const activeTurnCombatantId = useMemo(() => {
    if (!session) return null;
    const row = turnOrder.find((t) => t.turn_index === session.current_turn_index);
    return row?.combatant_id ?? null;
  }, [session, turnOrder]);

  const fetchState = useCallback(async () => {
    if (!campaignId || !combatSessionId) {
      if (isMountedRef.current) {
        setSession(null);
        setCombatants([]);
        setTurnOrder([]);
        setEvents([]);
        setError(null);
        setIsLoading(false);
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

      const [{ data: s, error: sErr }, { data: c, error: cErr }, { data: t, error: tErr }, { data: e, error: eErr }] =
        await Promise.all([
          supabase
            .schema("mythic")
            .from("combat_sessions")
            .select("id,campaign_id,seed,status,current_turn_index,scene_json,updated_at")
            .eq("id", combatSessionId)
            .eq("campaign_id", campaignId)
            .maybeSingle(),
          supabase
            .schema("mythic")
            .from("combatants")
            .select("*")
            .eq("combat_session_id", combatSessionId)
            .order("initiative", { ascending: false })
            .order("name", { ascending: true }),
          supabase
            .schema("mythic")
            .from("turn_order")
            .select("*")
            .eq("combat_session_id", combatSessionId)
            .order("turn_index", { ascending: true }),
          supabase
            .schema("mythic")
            .from("action_events")
            .select("*")
            .eq("combat_session_id", combatSessionId)
            .order("created_at", { ascending: true })
            .limit(500),
        ]);

      if (sErr) throw sErr;
      if (cErr) throw cErr;
      if (tErr) throw tErr;
      if (eErr) throw eErr;

      if (isMountedRef.current) {
        setSession((s ?? null) as unknown as MythicCombatSessionRow | null);
        setCombatants((c ?? []) as unknown as MythicCombatantRow[]);
        setTurnOrder((t ?? []) as unknown as MythicTurnOrderRow[]);
        setEvents((e ?? []) as unknown as MythicActionEventRow[]);
      }
    } catch (e) {
      const msg = formatError(e, "Failed to load combat state");
      if (isMountedRef.current) setError(msg);
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [campaignId, combatSessionId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchState();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchState]);

  useEffect(() => {
    if (!campaignId || !combatSessionId) return;
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void fetchState();
    }, 1800);
    return () => clearInterval(interval);
  }, [campaignId, combatSessionId, fetchState]);

  return {
    session,
    combatants,
    turnOrder,
    events,
    activeTurnCombatantId,
    isLoading,
    error,
    refetch: fetchState,
  };
}
