import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { formatError } from "@/ui/data/async";
import type { Tables } from "@/integrations/supabase/types";
import type { MythicCharacterBundle, MythicInventoryRow } from "@/types/mythic";
import { getMythicE2ECharacterBundle, isMythicE2E } from "@/ui/e2e/mythicState";

type MythicCharacterRow = Tables<{ schema: "mythic" }, "characters">;
type MythicInventoryDbRow = Tables<{ schema: "mythic" }, "inventory">;
type MythicItemRow = Tables<{ schema: "mythic" }, "items">;

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

    if (isMythicE2E(campaignId)) {
      if (isMountedRef.current) {
        setBundle(getMythicE2ECharacterBundle(campaignId));
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
        .eq("character_id", character.id)
        .order("created_at", { ascending: true });

      if (skillsError) throw skillsError;

      const { data: inventoryRows, error: invError } = await supabase
        .schema("mythic")
        .from("inventory")
        .select("id, container, equip_slot, quantity, equipped_at, item_id")
        .eq("character_id", character.id)
        .order("created_at", { ascending: true });

      if (invError) throw invError;

      const itemIds = Array.from(
        new Set((inventoryRows ?? []).map((row) => row.item_id).filter((id): id is string => typeof id === "string")),
      );
      let itemsById = new Map<string, MythicItemRow>();
      if (itemIds.length > 0) {
        const { data: itemRows, error: itemError } = await supabase
          .schema("mythic")
          .from("items")
          .select("*")
          .in("id", itemIds);
        if (itemError) throw itemError;
        itemsById = new Map((itemRows ?? []).map((row) => [row.id, row]));
      }

      const normalizedInventory: MythicInventoryRow[] = (inventoryRows ?? []).map((row: MythicInventoryDbRow) => ({
        id: row.id,
        container: row.container,
        equip_slot: row.equip_slot,
        quantity: row.quantity,
        equipped_at: row.equipped_at,
        item: itemsById.get(row.item_id) ?? null,
      }));

      if (isMountedRef.current) {
        setBundle({
          character,
          skills: skills ?? [],
          items: normalizedInventory,
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
