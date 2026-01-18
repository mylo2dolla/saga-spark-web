import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { recordProfilesRead } from "@/ui/data/networkHealth";

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
  type: string;
  description: string;
  damage?: string;
  range?: number;
  manaCost?: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  type: string;
  description: string;
  equipped?: boolean;
}

export interface GameCharacter {
  id: string;
  campaign_id: string;
  user_id: string;
  name: string;
  class: string;
  level: number;
  hp: number;
  max_hp: number;
  ac: number;
  stats: CharacterStats;
  abilities: CharacterAbility[];
  inventory: InventoryItem[];
  xp: number;
  xp_to_next: number;
  position: { x: number; y: number };
  status_effects: string[];
  avatar_url: string | null;
  is_active: boolean;
  profile?: {
    display_name: string;
  };
}

export interface CombatEnemy {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  initiative: number;
  position: { x: number; y: number };
}

export interface CombatState {
  id: string;
  campaign_id: string;
  is_active: boolean;
  round_number: number;
  current_turn_index: number;
  initiative_order: string[];
  enemies: CombatEnemy[];
  updated_at: string;
}

export function useRealtimeCharacters(campaignId: string | undefined) {
  const [characters, setCharacters] = useState<GameCharacter[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Helper to parse character data
  const parseCharacter = (data: unknown, profile?: { display_name: string }): GameCharacter => {
    const char = data as Record<string, unknown>;
    return {
      id: char.id as string,
      campaign_id: char.campaign_id as string,
      user_id: char.user_id as string,
      name: char.name as string,
      class: char.class as string,
      level: char.level as number,
      hp: char.hp as number,
      max_hp: char.max_hp as number,
      ac: char.ac as number,
      stats: (char.stats || { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 }) as CharacterStats,
      abilities: (char.abilities || []) as CharacterAbility[],
      inventory: (char.inventory || []) as InventoryItem[],
      xp: char.xp as number,
      xp_to_next: char.xp_to_next as number,
      position: (char.position || { x: 0, y: 0 }) as { x: number; y: number },
      status_effects: (char.status_effects || []) as string[],
      avatar_url: char.avatar_url as string | null,
      is_active: char.is_active as boolean,
      profile
    };
  };

  // Fetch initial characters
  useEffect(() => {
    if (!campaignId) return;

    const fetchCharacters = async () => {
      try {
        setIsLoading(true);
        const { data: charsData, error } = await supabase
          .from("characters")
          .select("*")
          .eq("campaign_id", campaignId)
          .eq("is_active", true);

        if (error) throw error;

        // Fetch profiles
        const userIds = charsData?.map(c => c.user_id) || [];
        const uniqueUserIds = [...new Set(userIds)];
        
        let profilesData: Array<{ user_id: string; display_name: string }> = [];
        if (uniqueUserIds.length > 0) {
          const { data } = await supabase
            .from("profiles")
            .select("user_id, display_name")
            .in("user_id", uniqueUserIds);
          profilesData = data || [];
          recordProfilesRead();
        }

        const parsedChars = (charsData || []).map(char => 
          parseCharacter(char, profilesData.find(p => p.user_id === char.user_id))
        );

        setCharacters(parsedChars);
      } catch (error) {
        console.error("Error fetching characters:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCharacters();
  }, [campaignId]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!campaignId) return;

    const channel: RealtimeChannel = supabase
      .channel(`characters:${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "characters",
          filter: `campaign_id=eq.${campaignId}`,
        },
        async (payload) => {
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const { data: profileData } = await supabase
              .from("profiles")
              .select("display_name")
              .eq("user_id", (payload.new as { user_id: string }).user_id)
              .single();
            recordProfilesRead();

            const parsedChar = parseCharacter(payload.new, profileData || undefined);

            if (payload.eventType === "INSERT") {
              setCharacters(prev => [...prev, parsedChar]);
            } else {
              setCharacters(prev => prev.map(c => c.id === parsedChar.id ? parsedChar : c));
            }
          } else if (payload.eventType === "DELETE") {
            setCharacters(prev => prev.filter(c => c.id !== (payload.old as { id: string }).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const createCharacter = useCallback(async (
    characterData: Omit<GameCharacter, "id" | "campaign_id" | "user_id" | "is_active" | "profile">
  ) => {
    if (!campaignId) throw new Error("No campaign ID");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("characters")
        .insert({
          name: characterData.name,
          class: characterData.class,
          level: characterData.level,
          hp: characterData.hp,
          max_hp: characterData.max_hp,
          ac: characterData.ac,
          stats: JSON.parse(JSON.stringify(characterData.stats)),
          abilities: JSON.parse(JSON.stringify(characterData.abilities)),
          inventory: JSON.parse(JSON.stringify(characterData.inventory)),
          xp: characterData.xp,
          xp_to_next: characterData.xp_to_next,
          position: JSON.parse(JSON.stringify(characterData.position)),
          status_effects: characterData.status_effects,
          avatar_url: characterData.avatar_url,
          campaign_id: campaignId,
          user_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      toast.success(`${characterData.name} has joined the adventure!`);
      return parseCharacter(data);
    } catch (error) {
      console.error("Error creating character:", error);
      toast.error("Failed to create character");
      throw error;
    }
  }, [campaignId]);

  const updateCharacter = useCallback(async (
    characterId: string,
    updates: Partial<GameCharacter>
  ) => {
    try {
      // Convert to Supabase-compatible format
      const dbUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.class !== undefined) dbUpdates.class = updates.class;
      if (updates.level !== undefined) dbUpdates.level = updates.level;
      if (updates.hp !== undefined) dbUpdates.hp = updates.hp;
      if (updates.max_hp !== undefined) dbUpdates.max_hp = updates.max_hp;
      if (updates.ac !== undefined) dbUpdates.ac = updates.ac;
      if (updates.xp !== undefined) dbUpdates.xp = updates.xp;
      if (updates.xp_to_next !== undefined) dbUpdates.xp_to_next = updates.xp_to_next;
      if (updates.avatar_url !== undefined) dbUpdates.avatar_url = updates.avatar_url;
      if (updates.is_active !== undefined) dbUpdates.is_active = updates.is_active;
      if (updates.status_effects !== undefined) dbUpdates.status_effects = updates.status_effects;
      if (updates.stats !== undefined) dbUpdates.stats = updates.stats;
      if (updates.abilities !== undefined) dbUpdates.abilities = updates.abilities;
      if (updates.inventory !== undefined) dbUpdates.inventory = updates.inventory;
      if (updates.position !== undefined) dbUpdates.position = updates.position;

      const { error } = await supabase
        .from("characters")
        .update(dbUpdates)
        .eq("id", characterId);

      if (error) throw error;
    } catch (error) {
      console.error("Error updating character:", error);
      throw error;
    }
  }, []);

  return {
    characters,
    isLoading,
    createCharacter,
    updateCharacter,
  };
}

export function useRealtimeCombat(campaignId: string | undefined) {
  const [combatState, setCombatState] = useState<CombatState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const parseCombatState = (data: unknown): CombatState => {
    const state = data as Record<string, unknown>;
    return {
      id: state.id as string,
      campaign_id: state.campaign_id as string,
      is_active: state.is_active as boolean,
      round_number: state.round_number as number,
      current_turn_index: state.current_turn_index as number,
      initiative_order: (state.initiative_order || []) as string[],
      enemies: (state.enemies || []) as CombatEnemy[],
      updated_at: state.updated_at as string,
    };
  };

  // Fetch initial combat state
  useEffect(() => {
    if (!campaignId) return;

    const fetchCombatState = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await supabase
          .from("combat_state")
          .select("*")
          .eq("campaign_id", campaignId)
          .maybeSingle();

        if (error) throw error;
        setCombatState(data ? parseCombatState(data) : null);
      } catch (error) {
        console.error("Error fetching combat state:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchCombatState();
  }, [campaignId]);

  // Subscribe to realtime updates
  useEffect(() => {
    if (!campaignId) return;

    const channel: RealtimeChannel = supabase
      .channel(`combat:${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "combat_state",
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE" || payload.eventType === "INSERT") {
            setCombatState(parseCombatState(payload.new));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [campaignId]);

  const startCombat = useCallback(async (
    enemies: CombatEnemy[],
    initiativeOrder: string[]
  ) => {
    if (!campaignId) return;

    try {
      const { error } = await supabase
        .from("combat_state")
        .update({
          is_active: true,
          round_number: 1,
          current_turn_index: 0,
          enemies: JSON.parse(JSON.stringify(enemies)),
          initiative_order: initiativeOrder,
        })
        .eq("campaign_id", campaignId);

      if (error) throw error;
      toast.success("Combat has begun!");
    } catch (error) {
      console.error("Error starting combat:", error);
      throw error;
    }
  }, [campaignId]);

  const endCombat = useCallback(async () => {
    if (!campaignId) return;

    try {
      const { error } = await supabase
        .from("combat_state")
        .update({
          is_active: false,
          enemies: JSON.parse(JSON.stringify([])),
          initiative_order: [],
        })
        .eq("campaign_id", campaignId);

      if (error) throw error;
      toast.success("Combat has ended!");
    } catch (error) {
      console.error("Error ending combat:", error);
      throw error;
    }
  }, [campaignId]);

  const nextTurn = useCallback(async () => {
    if (!combatState || !campaignId) return;

    const nextIndex = (combatState.current_turn_index + 1) % combatState.initiative_order.length;
    const newRound = nextIndex === 0 ? combatState.round_number + 1 : combatState.round_number;

    try {
      const { error } = await supabase
        .from("combat_state")
        .update({
          current_turn_index: nextIndex,
          round_number: newRound,
        })
        .eq("campaign_id", campaignId);

      if (error) throw error;
    } catch (error) {
      console.error("Error advancing turn:", error);
      throw error;
    }
  }, [campaignId, combatState]);

  const updateEnemies = useCallback(async (enemies: CombatEnemy[]) => {
    if (!campaignId) return;

    try {
      const { error } = await supabase
        .from("combat_state")
        .update({ enemies: JSON.parse(JSON.stringify(enemies)) })
        .eq("campaign_id", campaignId);

      if (error) throw error;
    } catch (error) {
      console.error("Error updating enemies:", error);
      throw error;
    }
  }, [campaignId]);

  return {
    combatState,
    isLoading,
    startCombat,
    endCombat,
    nextTurn,
    updateEnemies,
  };
}
