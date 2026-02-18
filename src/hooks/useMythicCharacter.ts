import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type {
  MythicCharacterBundle,
  MythicCharacterLoadoutRow,
  MythicQuestThreadRow,
  MythicCharacterRow,
  MythicProgressionEventRow,
  MythicSkill,
} from "@/types/mythic";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function summarizePayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const raw = payload as Record<string, unknown>;
  const keys = ["summary", "description", "reason", "note", "objective", "type"];
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return "";
}

export function useMythicCharacter(campaignId: string | undefined) {
  const [bundle, setBundle] = useState<MythicCharacterBundle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const inFlightRef = useRef(false);

  const fetchBundle = useCallback(async () => {
    if (!campaignId || !isUuid(campaignId)) {
      if (isMountedRef.current) {
        setIsLoading(false);
        setBundle(null);
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

      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) {
        if (isMountedRef.current) {
          setIsLoading(false);
          setBundle(null);
        }
        return;
      }

      const { data: character, error: charError } = await supabase
        .schema("mythic")
        .from("characters")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("player_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (charError) throw charError;
      if (!character) {
        if (isMountedRef.current) {
          setBundle(null);
        }
        return;
      }

      const { data: skills, error: skillsError } = await supabase
        .schema("mythic")
        .from("skills")
        .select("*")
        .eq("character_id", (character as MythicCharacterRow).id)
        .order("created_at", { ascending: true });

      if (skillsError) throw skillsError;

      const { data: inv, error: invError } = await supabase
        .schema("mythic")
        .from("inventory")
        .select("id, container, equip_slot, quantity, equipped_at, item:items(*)")
        .eq("character_id", (character as MythicCharacterRow).id)
        .order("created_at", { ascending: true });

      if (invError) throw invError;

      const [
        { data: loadouts, error: loadoutsError },
        { data: progressionEvents, error: progressionError },
        { data: memoryEvents, error: memoryError },
        { data: boardTransitions, error: transitionsError },
        { data: lootDrops, error: lootError },
        { data: reputationEvents, error: reputationError },
        { data: factions, error: factionsError },
      ] =
        await Promise.all([
          supabase
            .schema("mythic")
            .from("character_loadouts")
            .select("*")
            .eq("character_id", (character as MythicCharacterRow).id)
            .order("updated_at", { ascending: false }),
          supabase
            .schema("mythic")
            .from("progression_events")
            .select("id,campaign_id,character_id,event_type,payload,created_at")
            .eq("character_id", (character as MythicCharacterRow).id)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .schema("mythic")
            .from("dm_memory_events")
            .select("id,category,severity,payload,created_at,player_id")
            .eq("campaign_id", campaignId)
            .or(`player_id.eq.${user.id},player_id.is.null`)
            .order("created_at", { ascending: false })
            .limit(30),
          supabase
            .schema("mythic")
            .from("board_transitions")
            .select("id,from_board_type,to_board_type,reason,payload_json,created_at")
            .eq("campaign_id", campaignId)
            .order("created_at", { ascending: false })
            .limit(30),
          supabase
            .schema("mythic")
            .from("loot_drops")
            .select("id,rarity,source,payload,created_at,item_ids")
            .eq("campaign_id", campaignId)
            .order("created_at", { ascending: false })
            .limit(24),
          supabase
            .schema("mythic")
            .from("reputation_events")
            .select("id,faction_id,severity,delta,evidence,occurred_at,player_id")
            .eq("campaign_id", campaignId)
            .or(`player_id.eq.${user.id},player_id.is.null`)
            .order("occurred_at", { ascending: false })
            .limit(24),
          supabase
            .schema("mythic")
            .from("factions")
            .select("id,name")
            .eq("campaign_id", campaignId),
        ]);

      if (loadoutsError) throw loadoutsError;
      if (progressionError) throw progressionError;
      if (memoryError) throw memoryError;
      if (transitionsError) throw transitionsError;
      if (lootError) throw lootError;
      if (reputationError) throw reputationError;
      if (factionsError) throw factionsError;

      const factionNameById = new Map<string, string>(
        (factions ?? [])
          .filter((row): row is { id: string; name: string } => typeof row.id === "string" && typeof row.name === "string")
          .map((row) => [row.id, row.name]),
      );

      const questThreads: MythicQuestThreadRow[] = [];

      for (const event of (memoryEvents ?? []) as Array<Record<string, unknown>>) {
        const id = safeString(event.id, crypto.randomUUID());
        const category = safeString(event.category, "memory");
        const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
        questThreads.push({
          id: `memory:${id}`,
          source: "dm_memory",
          event_type: category,
          title: safeString(payload.title, category.replace(/_/g, " ")),
          detail: summarizePayload(payload),
          severity: Number(event.severity ?? 1) || 1,
          created_at: safeString(event.created_at),
        });
      }

      for (const transition of (boardTransitions ?? []) as Array<Record<string, unknown>>) {
        const id = safeString(transition.id, crypto.randomUUID());
        const fromBoard = safeString(transition.from_board_type, "?").toUpperCase();
        const toBoard = safeString(transition.to_board_type, "?").toUpperCase();
        const payload = transition.payload_json && typeof transition.payload_json === "object"
          ? transition.payload_json as Record<string, unknown>
          : {};
        const detailParts: string[] = [];
        const reason = safeString(transition.reason);
        if (reason) detailParts.push(`Reason: ${reason}`);
        const travelGoal = safeString(payload.travel_goal);
        if (travelGoal) detailParts.push(`Goal: ${travelGoal.replace(/_/g, " ")}`);
        const searchTarget = safeString(payload.search_target);
        if (searchTarget) detailParts.push(`Target: ${searchTarget}`);
        questThreads.push({
          id: `transition:${id}`,
          source: "board_transition",
          event_type: "board_transition",
          title: `${fromBoard} -> ${toBoard}`,
          detail: detailParts.join(" · "),
          severity: 1,
          created_at: safeString(transition.created_at),
        });
      }

      for (const event of (progressionEvents ?? []) as Array<Record<string, unknown>>) {
        const id = safeString(event.id, crypto.randomUUID());
        const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : {};
        const eventType = safeString(event.event_type, "progression");
        questThreads.push({
          id: `progression:${id}`,
          source: "progression",
          event_type: eventType,
          title: eventType.replace(/_/g, " "),
          detail: summarizePayload(payload),
          severity: eventType === "level_up" ? 2 : 1,
          created_at: safeString(event.created_at),
        });
      }

      for (const drop of (lootDrops ?? []) as Array<Record<string, unknown>>) {
        const id = safeString(drop.id, crypto.randomUUID());
        const payload = drop.payload && typeof drop.payload === "object" ? drop.payload as Record<string, unknown> : {};
        const rarity = safeString(drop.rarity, "loot");
        const itemIds = Array.isArray(drop.item_ids) ? drop.item_ids.length : 0;
        questThreads.push({
          id: `loot:${id}`,
          source: "loot_drop",
          event_type: safeString(drop.source, "loot_drop"),
          title: `Loot Drop · ${rarity}`,
          detail: summarizePayload(payload) || `${itemIds} item${itemIds === 1 ? "" : "s"} added.`,
          severity: rarity === "mythic" || rarity === "legendary" ? 3 : 2,
          created_at: safeString(drop.created_at),
        });
      }

      for (const reputation of (reputationEvents ?? []) as Array<Record<string, unknown>>) {
        const id = safeString(reputation.id, crypto.randomUUID());
        const delta = Number(reputation.delta ?? 0);
        const factionId = safeString(reputation.faction_id);
        const factionName = factionNameById.get(factionId) ?? "Faction";
        const evidence = reputation.evidence && typeof reputation.evidence === "object"
          ? reputation.evidence as Record<string, unknown>
          : {};
        questThreads.push({
          id: `reputation:${id}`,
          source: "reputation",
          event_type: "reputation_shift",
          title: `${factionName}: ${delta >= 0 ? "+" : ""}${Math.floor(delta)}`,
          detail: summarizePayload(evidence),
          severity: Number(reputation.severity ?? 1) || 1,
          created_at: safeString(reputation.occurred_at),
        });
      }

      const sortedThreads = questThreads
        .filter((entry) => entry.created_at.length > 0)
        .sort((a, b) => {
          const bMs = Number.isFinite(new Date(b.created_at).getTime()) ? new Date(b.created_at).getTime() : 0;
          const aMs = Number.isFinite(new Date(a.created_at).getTime()) ? new Date(a.created_at).getTime() : 0;
          return bMs - aMs;
        })
        .slice(0, 80);

      let loadoutSlotCap = 2;
      try {
        const { data: slotCapData, error: slotCapError } = await supabase
          .rpc("mythic_loadout_slots_for_level", { lvl: (character as MythicCharacterRow).level });
        if (!slotCapError && Number.isFinite(Number(slotCapData))) {
          loadoutSlotCap = Math.max(1, Number(slotCapData));
        }
      } catch {
        // Keep fallback when function is missing in out-of-date environments.
      }

      if (isMountedRef.current) {
        setBundle({
          character: character as MythicCharacterRow,
          skills: (skills ?? []) as unknown as MythicSkill[],
          items: ((inv ?? []).map((row) => row)) as unknown as Array<Record<string, unknown>>,
          loadouts: (loadouts ?? []) as unknown as MythicCharacterLoadoutRow[],
          progressionEvents: (progressionEvents ?? []) as unknown as MythicProgressionEventRow[],
          questThreads: sortedThreads,
          loadoutSlotCap,
        });
      }
    } catch (e) {
      const msg = formatError(e, "Failed to load mythic character");
      if (isMountedRef.current) setError(msg);
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchBundle();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchBundle]);

  return {
    bundle,
    character: bundle?.character ?? null,
    skills: bundle?.skills ?? [],
    items: bundle?.items ?? [],
    loadouts: bundle?.loadouts ?? [],
    progressionEvents: bundle?.progressionEvents ?? [],
    questThreads: bundle?.questThreads ?? [],
    loadoutSlotCap: bundle?.loadoutSlotCap ?? 2,
    isLoading,
    error,
    refetch: fetchBundle,
  };
}
