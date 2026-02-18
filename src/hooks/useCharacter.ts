import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { formatError } from "@/ui/data/async";

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

type CharacterRow = Database["public"]["Tables"]["characters"]["Row"];

const DEFAULT_STATS: CharacterStats = {
  strength: 10,
  dexterity: 10,
  constitution: 10,
  intelligence: 10,
  wisdom: 10,
  charisma: 10,
};

const readObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const mapCharacterRow = (data: CharacterRow): Character => {
  const statsObj = readObject(data.stats);
  const positionObj = readObject(data.position);
  return {
    ...data,
    stats: {
      strength: Number(statsObj.strength ?? DEFAULT_STATS.strength),
      dexterity: Number(statsObj.dexterity ?? DEFAULT_STATS.dexterity),
      constitution: Number(statsObj.constitution ?? DEFAULT_STATS.constitution),
      intelligence: Number(statsObj.intelligence ?? DEFAULT_STATS.intelligence),
      wisdom: Number(statsObj.wisdom ?? DEFAULT_STATS.wisdom),
      charisma: Number(statsObj.charisma ?? DEFAULT_STATS.charisma),
    },
    abilities: Array.isArray(data.abilities) ? (data.abilities as unknown as CharacterAbility[]) : [],
    inventory: Array.isArray(data.inventory) ? (data.inventory as unknown as Record<string, unknown>[]) : [],
    status_effects: Array.isArray(data.status_effects) ? data.status_effects : [],
    position:
      typeof positionObj.x === "number" && typeof positionObj.y === "number"
        ? { x: positionObj.x, y: positionObj.y }
        : null,
  };
};

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
        console.error("[character] supabase error", {
          message: userError.message,
          code: userError.code,
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
        console.error("[character] supabase error", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
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
      const status = (error as { status?: number })?.status;
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
    const dbUpdates: Record<string, unknown> = { ...updates };
    if (updates.stats) dbUpdates.stats = updates.stats as unknown as Record<string, unknown>;
    if (updates.abilities) dbUpdates.abilities = updates.abilities as unknown as Record<string, unknown>[];
    if (updates.inventory) dbUpdates.inventory = updates.inventory as unknown as Record<string, unknown>[];

    const { error } = await supabase
      .from("characters")
      .update(dbUpdates)
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
    const dbPayload: Record<string, unknown> = {
      ...payload,
      stats: payload.stats as unknown as Record<string, unknown>,
      resources: payload.resources as unknown as Record<string, unknown>,
      passives: payload.passives as unknown as Record<string, unknown>[],
      abilities: payload.abilities as unknown as Record<string, unknown>[],
      position: payload.position as unknown as Record<string, unknown>,
      equipment: payload.equipment as unknown as Record<string, unknown>,
      backpack: payload.backpack as unknown as Record<string, unknown>[],
      status_effects: payload.status_effects,
    };

    const query = existingId
      ? supabase.from("characters").update(dbPayload as Database["public"]["Tables"]["characters"]["Update"]).eq("id", existingId)
      : supabase.from("characters").insert(dbPayload as Database["public"]["Tables"]["characters"]["Insert"]);

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
