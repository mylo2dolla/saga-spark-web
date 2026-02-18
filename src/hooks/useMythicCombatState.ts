import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type { Database, Json } from "@/integrations/supabase/types";

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
  statuses: Json;
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

type CombatSessionSelectRow = Pick<
  Database["mythic"]["Tables"]["combat_sessions"]["Row"],
  "id" | "campaign_id" | "seed" | "status" | "current_turn_index" | "scene_json" | "updated_at"
>;
type CombatantDbRow = Database["mythic"]["Tables"]["combatants"]["Row"];
type TurnOrderDbRow = Database["mythic"]["Tables"]["turn_order"]["Row"];
type ActionEventDbRow = Database["mythic"]["Tables"]["action_events"]["Row"];

const toRecord = (value: Json): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const toEntityType = (value: string): MythicCombatantRow["entity_type"] => {
  if (value === "player" || value === "npc" || value === "summon") return value;
  return "npc";
};

const mapSessionRow = (row: CombatSessionSelectRow): MythicCombatSessionRow => ({
  id: row.id,
  campaign_id: row.campaign_id,
  seed: row.seed,
  status: row.status,
  current_turn_index: row.current_turn_index,
  scene_json: toRecord(row.scene_json),
  updated_at: row.updated_at,
});

const mapCombatantRow = (row: CombatantDbRow): MythicCombatantRow => ({
  id: row.id,
  combat_session_id: row.combat_session_id,
  entity_type: toEntityType(row.entity_type),
  player_id: row.player_id,
  character_id: row.character_id,
  name: row.name,
  x: row.x,
  y: row.y,
  hp: row.hp,
  hp_max: row.hp_max,
  power: row.power,
  power_max: row.power_max,
  armor: row.armor,
  resist: row.resist,
  initiative: row.initiative,
  statuses: row.statuses,
  is_alive: row.is_alive,
  updated_at: row.updated_at,
});

const mapTurnOrderRow = (row: TurnOrderDbRow): MythicTurnOrderRow => ({
  combat_session_id: row.combat_session_id,
  turn_index: row.turn_index,
  combatant_id: row.combatant_id,
});

const mapActionEventRow = (row: ActionEventDbRow): MythicActionEventRow => ({
  id: row.id,
  combat_session_id: row.combat_session_id,
  turn_index: row.turn_index,
  actor_combatant_id: row.actor_combatant_id,
  event_type: row.event_type,
  payload: toRecord(row.payload),
  created_at: row.created_at,
});

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
        setSession(s ? mapSessionRow(s) : null);
        setCombatants((c ?? []).map(mapCombatantRow));
        setTurnOrder((t ?? []).map(mapTurnOrderRow));
        setEvents((e ?? []).map(mapActionEventRow));
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
