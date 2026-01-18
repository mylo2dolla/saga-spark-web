import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { withTimeout, isAbortError, formatError } from "@/ui/data/async";

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

export function useCharacter(campaignId: string | undefined) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCharacter = useCallback(async () => {
    if (!campaignId) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const { data: { user }, error: userError } = await withTimeout(supabase.auth.getUser(), 20000);
      if (userError) {
        console.error("[character] supabase error", {
          message: userError.message,
          code: userError.code,
          details: userError.details,
          hint: userError.hint,
          status: userError.status,
        });
        throw userError;
      }
      if (!user) {
        setIsLoading(false);
        return;
      }

      const { data, error } = await withTimeout(
        supabase
          .from("characters")
          .select("*")
          .eq("campaign_id", campaignId)
          .eq("user_id", user.id)
          .eq("is_active", true)
          .maybeSingle(),
        20000,
      );

      if (error) {
        console.error("[character] supabase error", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          status: error.status,
        });
        throw error;
      }

      if (data) {
        if (!data.stats) {
          throw new Error("Character stats missing");
        }
        setCharacter({
          ...data,
          stats: data.stats as unknown as CharacterStats,
          abilities: (data.abilities as unknown as CharacterAbility[]) ?? [],
          inventory: (data.inventory as unknown as Record<string, unknown>[]) ?? [],
          position: data.position as unknown as { x: number; y: number } | null,
        });
      }
    } catch (error) {
      if (isAbortError(error)) {
        setError("Request canceled/timeout");
        return;
      }
      const status = (error as { status?: number })?.status;
      const baseMessage = formatError(error, "Failed to fetch character");
      const message = status === 401 || status === 403
        ? `Unauthorized (${status}): ${baseMessage}`
        : baseMessage;
      setError(message);
      console.error("[character] fetch error", { message, status });
    } finally {
      setIsLoading(false);
    }
  }, [campaignId]);

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

  useEffect(() => {
    fetchCharacter();
  }, [fetchCharacter]);

  return {
    character,
    isLoading,
    error,
    updateCharacter,
    deleteCharacter,
    refetch: fetchCharacter,
  };
}
