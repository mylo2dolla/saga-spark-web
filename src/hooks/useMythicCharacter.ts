import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type {
  MythicCharacterBundle,
  MythicCharacterLoadoutRow,
  MythicCharacterRow,
  MythicProgressionEventRow,
  MythicSkill,
} from "@/types/mythic";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

      const [{ data: loadouts, error: loadoutsError }, { data: progressionEvents, error: progressionError }] =
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
        ]);

      if (loadoutsError) throw loadoutsError;
      if (progressionError) throw progressionError;

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
    loadoutSlotCap: bundle?.loadoutSlotCap ?? 2,
    isLoading,
    error,
    refetch: fetchBundle,
  };
}
