import { useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { InventoryItem, EquipmentSlots, ItemStatModifiers, CharacterStats } from "@/types/game";

interface UseInventoryProps {
  characterId: string | undefined;
  initialBackpack?: InventoryItem[];
  initialEquipment?: EquipmentSlots;
}

const DEFAULT_EQUIPMENT: EquipmentSlots = {
  weapon: null,
  armor: null,
  shield: null,
  helmet: null,
  boots: null,
  gloves: null,
  ring1: null,
  ring2: null,
  trinket1: null,
  trinket2: null,
  trinket3: null,
};

export function useInventory({ characterId, initialBackpack = [], initialEquipment }: UseInventoryProps) {
  const [backpack, setBackpack] = useState<InventoryItem[]>(initialBackpack);
  const [equipment, setEquipment] = useState<EquipmentSlots>(initialEquipment || DEFAULT_EQUIPMENT);
  const [isUpdating, setIsUpdating] = useState(false);

  // Calculate stat bonuses from all equipped items
  const equipmentBonuses = useMemo((): ItemStatModifiers => {
    const bonuses: ItemStatModifiers = {
      strength: 0,
      dexterity: 0,
      constitution: 0,
      intelligence: 0,
      wisdom: 0,
      charisma: 0,
      ac: 0,
      hp: 0,
    };

    Object.values(equipment).forEach(item => {
      if (item?.statModifiers) {
        Object.entries(item.statModifiers).forEach(([key, value]) => {
          if (typeof value === "number" && key in bonuses) {
            (bonuses as Record<string, number>)[key] += value;
          }
        });
      }
    });

    return bonuses;
  }, [equipment]);

  // Get effective stats with equipment bonuses
  const getEffectiveStats = useCallback((baseStats: CharacterStats): CharacterStats => {
    return {
      strength: baseStats.strength + (equipmentBonuses.strength || 0),
      dexterity: baseStats.dexterity + (equipmentBonuses.dexterity || 0),
      constitution: baseStats.constitution + (equipmentBonuses.constitution || 0),
      intelligence: baseStats.intelligence + (equipmentBonuses.intelligence || 0),
      wisdom: baseStats.wisdom + (equipmentBonuses.wisdom || 0),
      charisma: baseStats.charisma + (equipmentBonuses.charisma || 0),
    };
  }, [equipmentBonuses]);

  const saveToDatabase = useCallback(async (newBackpack: InventoryItem[], newEquipment: EquipmentSlots) => {
    if (!characterId) return;

    setIsUpdating(true);
    try {
      const { error } = await supabase
        .from("characters")
        .update({
          backpack: JSON.parse(JSON.stringify(newBackpack)),
          equipment: JSON.parse(JSON.stringify(newEquipment)),
        })
        .eq("id", characterId);

      if (error) throw error;
    } catch (error) {
      console.error("Error saving inventory:", error);
      toast.error("Failed to save inventory");
    } finally {
      setIsUpdating(false);
    }
  }, [characterId]);

  const addToBackpack = useCallback(async (item: InventoryItem) => {
    const newBackpack = [...backpack, item];
    setBackpack(newBackpack);
    await saveToDatabase(newBackpack, equipment);
    toast.success(`Added ${item.name} to backpack`);
  }, [backpack, equipment, saveToDatabase]);

  const removeFromBackpack = useCallback(async (itemId: string) => {
    const item = backpack.find(i => i.id === itemId);
    const newBackpack = backpack.filter(i => i.id !== itemId);
    setBackpack(newBackpack);
    await saveToDatabase(newBackpack, equipment);
    if (item) toast.success(`Removed ${item.name} from backpack`);
  }, [backpack, equipment, saveToDatabase]);

  const equipItem = useCallback(async (item: InventoryItem) => {
    if (!item.slot) {
      toast.error("This item cannot be equipped");
      return;
    }

    // Determine which slot to use
    let slotKey: keyof EquipmentSlots = item.slot as keyof EquipmentSlots;
    
    // Handle rings and trinkets (multiple slots)
    if (item.slot === "ring") {
      slotKey = equipment.ring1 === null ? "ring1" : "ring2";
    } else if (item.slot === "trinket") {
      if (equipment.trinket1 === null) slotKey = "trinket1";
      else if (equipment.trinket2 === null) slotKey = "trinket2";
      else slotKey = "trinket3";
    }

    // Check if slot is occupied
    const currentItem = equipment[slotKey];
    
    // Remove item from backpack
    const newBackpack = backpack.filter(i => i.id !== item.id);
    
    // If slot was occupied, put old item in backpack
    if (currentItem) {
      newBackpack.push(currentItem);
    }
    
    // Update equipment
    const newEquipment = { ...equipment, [slotKey]: item };
    
    setBackpack(newBackpack);
    setEquipment(newEquipment);
    await saveToDatabase(newBackpack, newEquipment);
    
    toast.success(`Equipped ${item.name}`);
  }, [backpack, equipment, saveToDatabase]);

  const unequipItem = useCallback(async (slotKey: keyof EquipmentSlots) => {
    const item = equipment[slotKey];
    if (!item) return;

    const newEquipment = { ...equipment, [slotKey]: null };
    const newBackpack = [...backpack, item];
    
    setEquipment(newEquipment);
    setBackpack(newBackpack);
    await saveToDatabase(newBackpack, newEquipment);
    
    toast.success(`Unequipped ${item.name}`);
  }, [backpack, equipment, saveToDatabase]);

  const useConsumable = useCallback(async (itemId: string): Promise<InventoryItem | null> => {
    const item = backpack.find(i => i.id === itemId);
    if (!item || item.itemType !== "consumable") {
      toast.error("Item cannot be used");
      return null;
    }

    // Handle quantity
    if (item.quantity && item.quantity > 1) {
      const newBackpack = backpack.map(i => 
        i.id === itemId ? { ...i, quantity: (i.quantity || 1) - 1 } : i
      );
      setBackpack(newBackpack);
      await saveToDatabase(newBackpack, equipment);
    } else {
      const newBackpack = backpack.filter(i => i.id !== itemId);
      setBackpack(newBackpack);
      await saveToDatabase(newBackpack, equipment);
    }

    toast.success(`Used ${item.name}`);
    return item;
  }, [backpack, equipment, saveToDatabase]);

  return {
    backpack,
    equipment,
    equipmentBonuses,
    isUpdating,
    getEffectiveStats,
    addToBackpack,
    removeFromBackpack,
    equipItem,
    unequipItem,
    useConsumable,
    setBackpack,
    setEquipment,
  };
}
