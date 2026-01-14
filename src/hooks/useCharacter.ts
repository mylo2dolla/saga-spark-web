import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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

export interface CreateCharacterData {
  name: string;
  class: string;
  stats: CharacterStats;
  campaign_id: string;
}

// Class definitions with starting stats and abilities
export const CHARACTER_CLASSES = {
  Fighter: {
    name: "Fighter",
    description: "A master of martial combat, skilled with a variety of weapons and armor.",
    hitDie: 10,
    baseAC: 16,
    primaryStats: ["strength", "constitution"],
    startingAbilities: [
      { id: "fighter-1", name: "Strike", type: "attack" as const, description: "A powerful melee attack", damage: "1d8+3", range: 1 },
      { id: "fighter-2", name: "Second Wind", type: "heal" as const, description: "Recover 1d10+level HP", manaCost: 0 },
      { id: "fighter-3", name: "Shield Block", type: "defense" as const, description: "Increase AC by 2 until next turn", manaCost: 0 },
    ],
  },
  Wizard: {
    name: "Wizard",
    description: "A scholarly magic-user wielding arcane spells of devastating power.",
    hitDie: 6,
    baseAC: 12,
    primaryStats: ["intelligence", "wisdom"],
    startingAbilities: [
      { id: "wizard-1", name: "Fire Bolt", type: "spell" as const, description: "Hurl a bolt of fire", damage: "2d10", range: 12, manaCost: 5 },
      { id: "wizard-2", name: "Magic Missile", type: "spell" as const, description: "Three darts of magical force", damage: "3d4+3", range: 12, manaCost: 5 },
      { id: "wizard-3", name: "Shield", type: "defense" as const, description: "Magical barrier grants +5 AC", manaCost: 10 },
    ],
  },
  Rogue: {
    name: "Rogue",
    description: "A skilled assassin striking from the shadows with deadly precision.",
    hitDie: 8,
    baseAC: 14,
    primaryStats: ["dexterity", "charisma"],
    startingAbilities: [
      { id: "rogue-1", name: "Sneak Attack", type: "attack" as const, description: "Strike from stealth for extra damage", damage: "2d6+3", range: 1 },
      { id: "rogue-2", name: "Dash", type: "utility" as const, description: "Double your movement speed", manaCost: 0 },
      { id: "rogue-3", name: "Evasion", type: "defense" as const, description: "Dodge incoming attacks", manaCost: 0 },
    ],
  },
  Cleric: {
    name: "Cleric",
    description: "A priestly champion wielding divine magic in service of a higher power.",
    hitDie: 8,
    baseAC: 15,
    primaryStats: ["wisdom", "constitution"],
    startingAbilities: [
      { id: "cleric-1", name: "Sacred Flame", type: "spell" as const, description: "Radiant flame descends on foe", damage: "2d8", range: 6, manaCost: 5 },
      { id: "cleric-2", name: "Cure Wounds", type: "heal" as const, description: "Restore 2d8+3 HP to ally", manaCost: 10 },
      { id: "cleric-3", name: "Shield of Faith", type: "defense" as const, description: "Grant +2 AC to ally", manaCost: 5 },
    ],
  },
  Barbarian: {
    name: "Barbarian",
    description: "A fierce warrior fueled by primal rage and unstoppable fury.",
    hitDie: 12,
    baseAC: 14,
    primaryStats: ["strength", "constitution"],
    startingAbilities: [
      { id: "barb-1", name: "Reckless Attack", type: "attack" as const, description: "Attack with advantage, enemies get advantage on you", damage: "1d12+4", range: 1 },
      { id: "barb-2", name: "Rage", type: "utility" as const, description: "Enter rage for bonus damage and resistance", manaCost: 0 },
      { id: "barb-3", name: "Brutal Critical", type: "attack" as const, description: "Extra damage on critical hits", damage: "2d12+4", range: 1 },
    ],
  },
  Ranger: {
    name: "Ranger",
    description: "A warrior of the wilderness, expert hunter and tracker.",
    hitDie: 10,
    baseAC: 14,
    primaryStats: ["dexterity", "wisdom"],
    startingAbilities: [
      { id: "ranger-1", name: "Longbow Shot", type: "attack" as const, description: "Precise ranged attack", damage: "1d8+3", range: 15 },
      { id: "ranger-2", name: "Hunter's Mark", type: "utility" as const, description: "Mark target for extra damage", manaCost: 5 },
      { id: "ranger-3", name: "Cure Wounds", type: "heal" as const, description: "Minor healing magic", manaCost: 10 },
    ],
  },
} as const;

export type CharacterClassName = keyof typeof CHARACTER_CLASSES;

// Calculate modifier from stat
export function getModifier(stat: number): number {
  return Math.floor((stat - 10) / 2);
}

// Calculate HP based on class and constitution
export function calculateHP(className: CharacterClassName, constitution: number, level: number = 1): number {
  const classData = CHARACTER_CLASSES[className];
  const conMod = getModifier(constitution);
  return classData.hitDie + conMod + (level - 1) * (Math.floor(classData.hitDie / 2) + 1 + conMod);
}

// Calculate AC based on class and dexterity
export function calculateAC(className: CharacterClassName, dexterity: number): number {
  const classData = CHARACTER_CLASSES[className];
  const dexMod = getModifier(dexterity);
  return classData.baseAC + Math.min(dexMod, 2); // Cap dex bonus at +2 for most armors
}

export function useCharacter(campaignId: string | undefined) {
  const [character, setCharacter] = useState<Character | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchCharacter = useCallback(async () => {
    if (!campaignId) {
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("characters")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setCharacter({
          ...data,
          stats: (data.stats as unknown as CharacterStats) || { strength: 10, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
          abilities: (data.abilities as unknown as CharacterAbility[]) || [],
          inventory: (data.inventory as unknown as Record<string, unknown>[]) || [],
          position: data.position as unknown as { x: number; y: number } | null,
        });
      }
    } catch (error) {
      console.error("Error fetching character:", error);
    } finally {
      setIsLoading(false);
    }
  }, [campaignId]);

  const createCharacter = useCallback(async (data: CreateCharacterData): Promise<Character> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const className = data.class as CharacterClassName;
    const classData = CHARACTER_CLASSES[className];
    
    const hp = calculateHP(className, data.stats.constitution);
    const ac = calculateAC(className, data.stats.dexterity);

    const characterData = {
      name: data.name,
      class: data.class,
      campaign_id: data.campaign_id,
      user_id: user.id,
      level: 1,
      hp,
      max_hp: hp,
      ac,
      xp: 0,
      xp_to_next: 300,
      stats: JSON.parse(JSON.stringify(data.stats)),
      abilities: JSON.parse(JSON.stringify(classData.startingAbilities)),
      inventory: JSON.parse(JSON.stringify([])),
      status_effects: [] as string[],
      is_active: true,
    };

    const { data: created, error } = await supabase
      .from("characters")
      .insert([characterData])
      .select()
      .single();

    if (error) throw error;

    const newCharacter: Character = {
      ...created,
      stats: data.stats,
      abilities: [...classData.startingAbilities] as CharacterAbility[],
      inventory: [],
      position: null,
    };

    setCharacter(newCharacter);
    toast.success(`${data.name} the ${data.class} is ready for adventure!`);
    return newCharacter;
  }, []);

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
    createCharacter,
    updateCharacter,
    deleteCharacter,
    refetch: fetchCharacter,
  };
}
