import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { formatError } from "@/ui/data/async";
import { getSupabaseErrorInfo } from "@/lib/supabaseError";

export interface CharacterStats {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export interface CharacterAbility {
  id: string;
  name: string;
  type: "attack" | "spell" | "defense" | "heal" | "utility";
  description: string;
  damage?: string;
  range?: number;
  manaCost?: number;
  cooldown?: number;
}

export interface Character {
  id: string;
  name: string;
  class: string;
  level: number;
  hp: number;
  max_hp: number;
  ac: number;
  xp: number;
  xp_to_next: number;
  stats: CharacterStats;
  abilities: CharacterAbility[];
  inventory: Record<string, unknown>[];
  status_effects: string[];
  avatar_url: string | null;
  position: { x: number; y: number } | null;
  campaign_id: string;
  user_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

type CharacterRow = Database["public"]["Tables"]["characters"]["Row"];
type CharacterInsert = Database["public"]["Tables"]["characters"]["Insert"];

export interface CharacterPayload {
  name: string;
  class: string;
  class_description?: string | null;
  campaign_id: string;
  user_id: string;
  level: number;
  hp: number;
  max_hp: number;
  ac: number;
  stats: CharacterStats;
  resources: Record<string, unknown>;
  passives: Record<string, unknown>[];
  abilities: Record<string, unknown>[];
  xp: number;
  xp_to_next: number;
  position: { x: number; y: number };
  status_effects: string[];
  is_active: boolean;
  equipment: Record<string, unknown>;
  backpack: Record<string, unknown>[];
}

const defaultStats: CharacterStats = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

const asObject = (value: Json | null): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asArray = (value: Json | null): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

const toStats = (value: Json | null): CharacterStats => {
  const raw = asObject(value);
  return {
    strength: typeof raw.strength === "number" ? raw.strength : defaultStats.strength,
    dexterity: typeof raw.dexterity === "number" ? raw.dexterity : defaultStats.dexterity,
    constitution: typeof raw.constitution === "number" ? raw.constitution : defaultStats.constitution,
    intelligence: typeof raw.intelligence === "number" ? raw.intelligence : defaultStats.intelligence,
    wisdom: typeof raw.wisdom === "number" ? raw.wisdom : defaultStats.wisdom,
    charisma: typeof raw.charisma === "number" ? raw.charisma : defaultStats.charisma,
  };
};

const toPosition = (value: Json | null): { x: number; y: number } | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const x = (value as { x?: number }).x;
  const y = (value as { y?: number }).y;
  if (typeof x === "number" && typeof y === "number") {
    return { x, y };
  }
  return null;
};

const mapCharacterRow = (data: CharacterRow): Character => ({
  id: data.id,
  name: data.name,
  class: data.class,
  level: data.level,
  hp: data.hp,
  max_hp: data.max_hp,
  ac: data.ac,
  xp: data.xp,
  xp_to_next: data.xp_to_next,
  stats: toStats(data.stats),
  abilities: asArray(data.abilities) as unknown as CharacterAbility[],
  inventory: asArray(data.inventory),
  status_effects: data.status_effects ?? [],
  avatar_url: data.avatar_url,
  position: toPosition(data.position),
  campaign_id: data.campaign_id,
  user_id: data.user_id,
  is_active: data.is_active,
  created_at: data.created_at,
  updated_at: data.updated_at,
});

export function useCharacter(campaignId: string | undefined) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMountedRef = useRef(true);
  const E2E_BYPASS_AUTH = import.meta.env.VITE_E2E_BYPASS_AUTH === "true";

  const fetchCharacter = useCallback(async () => {
    if (E2E_BYPASS_AUTH) {
      if (isMountedRef.current) {
        setIsLoading(false);
        setError(null);
        setCharacter(null);
      }
      return;
    }
    if (!campaignId) {
      if (isMountedRef.current) {
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
      if (userError) {
        const errorInfo = getSupabaseErrorInfo(userError, "Failed to read current user");
        console.error("[character] supabase error", {
          message: errorInfo.message,
          code: errorInfo.code,
          details: errorInfo.details,
          hint: errorInfo.hint,
          status: errorInfo.status,
        });
        throw userError;
      }
      if (!user) {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("characters")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (error) {
        const errorInfo = getSupabaseErrorInfo(error, "Failed to fetch character");
        console.error("[character] supabase error", {
          message: errorInfo.message,
          code: errorInfo.code,
          details: errorInfo.details,
          hint: errorInfo.hint,
          status: errorInfo.status,
        });
        throw error;
      }

      if (data) {
        if (!data.stats) {
          throw new Error("Character stats missing");
        }
        if (isMountedRef.current) {
          setCharacter(mapCharacterRow(data));
        }
        if (import.meta.env.DEV) {
          console.info("[character]", {
            step: "loaded_from_db",
            campaignId,
            characterId: data.id,
            userId: user.id,
          });
        }
      }
    } catch (error) {
      const status = getSupabaseErrorInfo(error, "Failed to fetch character").status;
      const baseMessage = formatError(error, "Failed to fetch character");
      const message = status === 401 || status === 403
        ? `Unauthorized (${status}): ${baseMessage}`
        : baseMessage;
      if (isMountedRef.current) {
        setError(message);
      }
      console.error("[character] fetch error", { message, status });
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [E2E_BYPASS_AUTH, campaignId]);

  const updateCharacter = useCallback(async (updates: Partial<Character>) => {
    if (!character) throw new Error("No character loaded");

    // Convert to database-compatible format
    const dbUpdates = { ...(updates as unknown as Database["public"]["Tables"]["characters"]["Update"]) };
    if (updates.stats) dbUpdates.stats = updates.stats as unknown as Json;
    if (updates.abilities) dbUpdates.abilities = updates.abilities as unknown as Json;
    if (updates.inventory) dbUpdates.inventory = updates.inventory as unknown as Json;

    const { error } = await supabase
      .from("characters")
      .update(dbUpdates as Database["public"]["Tables"]["characters"]["Update"])
      .eq("id", character.id);

    if (error) throw error;

    setCharacter(prev => prev ? { ...prev, ...updates } : null);
  }, [character]);

  const deleteCharacter = useCallback(async () => {
    if (!character) throw new Error("No character loaded");

    const { error } = await supabase
      .from("characters")
      .update({ is_active: false })
      .eq("id", character.id);

    if (error) throw error;

    setCharacter(null);
    toast.success("Character retired");
  }, [character]);

  const saveCharacter = useCallback(async (payload: CharacterPayload, existingId?: string) => {
    const dbPayload: CharacterInsert = {
      ...payload,
      stats: payload.stats as unknown as Json,
      resources: payload.resources as unknown as Json,
      passives: payload.passives as unknown as Json,
      abilities: payload.abilities as unknown as Json,
      position: payload.position as unknown as Json,
      equipment: payload.equipment as unknown as Json,
      backpack: payload.backpack as unknown as Json,
      status_effects: payload.status_effects,
    };

    const query = existingId
      ? supabase.from("characters").update(dbPayload).eq("id", existingId)
      : supabase.from("characters").insert(dbPayload);

    const { data, error } = await query.select("*").maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error("Character save returned no data");
    }
    const next = mapCharacterRow(data);
    setCharacter(next);
    return next;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchCharacter();
    return () => {
      isMountedRef.current = false;
    };
  }, [fetchCharacter]);

  return {
    character,
    isLoading,
    error,
    updateCharacter,
    deleteCharacter,
    saveCharacter,
    refetch: fetchCharacter,
  };
}
