/**
 * Inventory and Equipment UI component.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Backpack, 
  Sword, 
  Shield, 
  Shirt,
  Gem,
  Package,
  Coins,
  ChevronRight
} from "lucide-react";
import type { Item, Inventory, Equipment, EquipmentSlot, Rarity } from "@/engine/narrative/types";
import { getRarityColor } from "@/engine/narrative/Item";

interface InventoryPanelProps {
  inventory: Inventory;
  equipment: Equipment;
  items: ReadonlyMap<string, Item>;
  onEquip?: (itemId: string, slot: EquipmentSlot) => void;
  onUnequip?: (slot: EquipmentSlot) => void;
  onUse?: (itemId: string) => void;
}

export function InventoryPanel({ 
  inventory, 
  equipment, 
  items,
  onEquip,
  onUnequip,
  onUse,
}: InventoryPanelProps) {
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);

  const getItemFromInventory = (itemId: string) => items.get(itemId);

  const inventoryItems = inventory.slots.map(slot => ({
    ...slot,
    item: getItemFromInventory(slot.itemId),
  })).filter(s => s.item);

  const equippedItems: { slot: EquipmentSlot; item: Item | undefined }[] = [
    { slot: "main_hand", item: equipment.main_hand ? items.get(equipment.main_hand) : undefined },
    { slot: "off_hand", item: equipment.off_hand ? items.get(equipment.off_hand) : undefined },
    { slot: "head", item: equipment.head ? items.get(equipment.head) : undefined },
    { slot: "chest", item: equipment.chest ? items.get(equipment.chest) : undefined },
    { slot: "hands", item: equipment.hands ? items.get(equipment.hands) : undefined },
    { slot: "feet", item: equipment.feet ? items.get(equipment.feet) : undefined },
    { slot: "ring_1", item: equipment.ring_1 ? items.get(equipment.ring_1) : undefined },
    { slot: "ring_2", item: equipment.ring_2 ? items.get(equipment.ring_2) : undefined },
    { slot: "amulet", item: equipment.amulet ? items.get(equipment.amulet) : undefined },
  ];

  const slotIcons: Record<EquipmentSlot, typeof Sword> = {
    main_hand: Sword,
    off_hand: Shield,
    head: Gem,
    chest: Shirt,
    hands: Package,
    feet: Package,
    ring_1: Gem,
    ring_2: Gem,
    amulet: Gem,
  };

  const slotLabels: Record<EquipmentSlot, string> = {
    main_hand: "Main Hand",
    off_hand: "Off Hand",
    head: "Head",
    chest: "Chest",
    hands: "Hands",
    feet: "Feet",
    ring_1: "Ring",
    ring_2: "Ring",
    amulet: "Amulet",
  };

  return (
    <Card className="w-full max-w-md bg-card/95 backdrop-blur border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Backpack className="w-5 h-5 text-primary" />
            Inventory
          </CardTitle>
          <Badge variant="secondary" className="flex items-center gap-1">
            <Coins className="w-3 h-3" />
            {inventory.gold}
          </Badge>
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="inventory">
          <TabsList className="grid grid-cols-2 mb-4">
            <TabsTrigger value="inventory">Backpack</TabsTrigger>
            <TabsTrigger value="equipment">Equipment</TabsTrigger>
          </TabsList>

          <TabsContent value="inventory" className="mt-0">
            <ScrollArea className="h-64">
              {inventoryItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Your inventory is empty
                </p>
              ) : (
                <div className="space-y-1">
                  {inventoryItems.map(({ itemId, quantity, item }) => item && (
                    <ItemRow
                      key={itemId}
                      item={item}
                      quantity={quantity}
                      onClick={() => setSelectedItem(item)}
                      isSelected={selectedItem?.id === item.id}
                    />
                  ))}
                </div>
              )}
            </ScrollArea>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              {inventory.slots.length} / {inventory.maxSlots} slots used
            </p>
          </TabsContent>

          <TabsContent value="equipment" className="mt-0">
            <ScrollArea className="h-64">
              <div className="space-y-1">
                {equippedItems.map(({ slot, item }) => {
                  const Icon = slotIcons[slot];
                  return (
                    <div
                      key={slot}
                      className={`flex items-center gap-3 p-2 rounded-md border transition-colors ${
                        item 
                          ? "bg-primary/5 border-primary/20 hover:bg-primary/10" 
                          : "bg-muted/30 border-transparent"
                      }`}
                      onClick={() => item && onUnequip?.(slot)}
                    >
                      <Icon className={`w-4 h-4 ${item ? "text-primary" : "text-muted-foreground"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground">{slotLabels[slot]}</p>
                        {item ? (
                          <p 
                            className="text-sm font-medium truncate"
                            style={{ color: getRarityColor(item.rarity) }}
                          >
                            {item.name}
                          </p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Empty</p>
                        )}
                      </div>
                      {item && (
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        {/* Item Details */}
        {selectedItem && (
          <div className="mt-4 p-3 rounded-lg border bg-background/50">
            <div className="flex items-start justify-between mb-2">
              <h4 
                className="font-medium"
                style={{ color: getRarityColor(selectedItem.rarity) }}
              >
                {selectedItem.name}
              </h4>
              <Badge variant="outline" className="text-xs">
                {selectedItem.rarity}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              {selectedItem.description}
            </p>
            <div className="flex gap-2">
              {selectedItem.type === "consumable" && (
                <Button size="sm" onClick={() => onUse?.(selectedItem.id)}>
                  Use
                </Button>
              )}
              {["weapon", "armor", "shield", "helmet", "boots", "gloves", "ring", "amulet"].includes(selectedItem.type) && (
                <Button size="sm" variant="outline">
                  Equip
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setSelectedItem(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface ItemRowProps {
  item: Item;
  quantity: number;
  isSelected?: boolean;
  onClick?: () => void;
}

function ItemRow({ item, quantity, isSelected, onClick }: ItemRowProps) {
  return (
    <div
      className={`flex items-center gap-3 p-2 rounded-md cursor-pointer transition-colors ${
        isSelected 
          ? "bg-primary/10 border border-primary/30" 
          : "hover:bg-muted/50 border border-transparent"
      }`}
      onClick={onClick}
    >
      <div 
        className="w-8 h-8 rounded-md flex items-center justify-center text-lg"
        style={{ 
          backgroundColor: `${getRarityColor(item.rarity)}20`,
          border: `1px solid ${getRarityColor(item.rarity)}40`,
        }}
      >
        {getItemEmoji(item.type)}
      </div>
      <div className="flex-1 min-w-0">
        <p 
          className="text-sm font-medium truncate"
          style={{ color: getRarityColor(item.rarity) }}
        >
          {item.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {item.type} • {item.value}g
        </p>
      </div>
      {quantity > 1 && (
        <Badge variant="secondary" className="text-xs">
          x{quantity}
        </Badge>
      )}
    </div>
  );
}

function getItemEmoji(type: Item["type"]): string {
  const emojis: Record<Item["type"], string> = {
    weapon: "⚔️",
    armor: "🛡️",
    shield: "🛡️",
    helmet: "⛑️",
    boots: "👢",
    gloves: "🧤",
    ring: "💍",
    amulet: "📿",
    consumable: "🧪",
    quest: "📜",
    relic: "🏺",
    material: "🪨",
    key: "🗝️",
  };
  return emojis[type] ?? "📦";
}
