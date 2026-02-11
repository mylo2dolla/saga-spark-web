import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type { MythicCharacterBundle, MythicCharacterRow, MythicSkill } from "@/types/mythic";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function useMythicCharacter(campaignId: string | undefined) {
  const [bundle, setBundle] = useState<MythicCharacterBundle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  const fetchBundle = useCallback(async () => {
    if (!campaignId || !isUuid(campaignId)) {
      if (isMountedRef.current) {
        setIsLoading(false);
        setBundle(null);
        setError(null);
      }
      return;
    }

    try {
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

      const items = (inv ?? []).map((row) => row);

      if (isMountedRef.current) {
        setBundle({
          character: character as MythicCharacterRow,
          skills: (skills ?? []) as unknown as MythicSkill[],
          items: items as unknown as Array<Record<string, unknown>>,
        });
      }
    } catch (e) {
      const msg = formatError(e, "Failed to load mythic character");
      if (isMountedRef.current) setError(msg);
    } finally {
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
    isLoading,
    error,
    refetch: fetchBundle,
  };
}
