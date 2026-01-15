import { useMemo } from "react";
import { Coins, ShoppingBag, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import type { Inventory, Item, NPC } from "@/engine/narrative/types";
import { addItemToInventory, modifyGold, removeItemFromInventory } from "@/engine/narrative/Item";

interface NPCTradePanelProps {
  npc: NPC;
  playerInventory: Inventory;
  items: ReadonlyMap<string, Item>;
  onTrade: (updatedNpc: NPC, updatedPlayerInventory: Inventory) => void;
  onClose: () => void;
}

export function NPCTradePanel({
  npc,
  playerInventory,
  items,
  onTrade,
  onClose,
}: NPCTradePanelProps) {
  const npcItems = useMemo(() => {
    return npc.inventory.slots
      .map(slot => ({ ...slot, item: items.get(slot.itemId) }))
      .filter((slot): slot is typeof slot & { item: Item } => !!slot.item);
  }, [npc.inventory.slots, items]);

  const playerItems = useMemo(() => {
    return playerInventory.slots
      .map(slot => ({ ...slot, item: items.get(slot.itemId) }))
      .filter((slot): slot is typeof slot & { item: Item } => !!slot.item);
  }, [playerInventory.slots, items]);

  const getBuyPrice = (item: Item) => Math.max(1, Math.round(item.value * npc.priceModifier));
  const getSellPrice = (item: Item) => Math.max(1, Math.round(item.value * 0.5));

  const handleBuy = (item: Item) => {
    const price = getBuyPrice(item);
    if (playerInventory.gold < price) {
      toast.error("Not enough gold.");
      return;
    }

    const removeResult = removeItemFromInventory(npc.inventory, item.id, 1);
    if (removeResult.removed === 0) {
      toast.error("Item unavailable.");
      return;
    }

    const addResult = addItemToInventory(playerInventory, item.id, 1, items);
    if (addResult.added === 0) {
      toast.error("Inventory is full.");
      return;
    }

    const updatedNpcInventory = modifyGold(removeResult.inventory, price);
    const updatedPlayerInventory = modifyGold(addResult.inventory, -price);
    onTrade({ ...npc, inventory: updatedNpcInventory }, updatedPlayerInventory);
  };

  const handleSell = (item: Item) => {
    const price = getSellPrice(item);
    if (npc.inventory.gold < price) {
      toast.error("Merchant cannot afford this item.");
      return;
    }

    const removeResult = removeItemFromInventory(playerInventory, item.id, 1);
    if (removeResult.removed === 0) {
      toast.error("Item unavailable.");
      return;
    }

    const addResult = addItemToInventory(npc.inventory, item.id, 1, items);
    if (addResult.added === 0) {
      toast.error("Merchant inventory is full.");
      return;
    }

    const updatedNpcInventory = modifyGold(addResult.inventory, -price);
    const updatedPlayerInventory = modifyGold(removeResult.inventory, price);
    onTrade({ ...npc, inventory: updatedNpcInventory }, updatedPlayerInventory);
  };

  return (
    <Card className="w-full max-w-3xl bg-card/95 backdrop-blur border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Store className="w-5 h-5 text-primary" />
            Trade with {npc.name}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2">
              <Store className="w-4 h-4" />
              Merchant Goods
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Coins className="w-3 h-3" />
              {npc.inventory.gold}
            </span>
          </div>
          <Separator />
          <ScrollArea className="h-64 rounded-md border border-border p-2">
            {npcItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">No goods available.</p>
            ) : (
              <div className="space-y-2">
                {npcItems.map(slot => (
                  <div key={slot.item.id} className="flex items-center justify-between rounded-md border border-border p-2">
                    <div className="text-sm">
                      <div className="font-medium">{slot.item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {slot.quantity} in stock · {getBuyPrice(slot.item)}g
                      </div>
                    </div>
                    <Button size="sm" onClick={() => handleBuy(slot.item)}>
                      Buy
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm font-medium">
            <span className="flex items-center gap-2">
              <ShoppingBag className="w-4 h-4" />
              Your Items
            </span>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Coins className="w-3 h-3" />
              {playerInventory.gold}
            </span>
          </div>
          <Separator />
          <ScrollArea className="h-64 rounded-md border border-border p-2">
            {playerItems.length === 0 ? (
              <p className="text-xs text-muted-foreground">No items to sell.</p>
            ) : (
              <div className="space-y-2">
                {playerItems.map(slot => (
                  <div key={slot.item.id} className="flex items-center justify-between rounded-md border border-border p-2">
                    <div className="text-sm">
                      <div className="font-medium">{slot.item.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {slot.quantity} owned · {getSellPrice(slot.item)}g
                      </div>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => handleSell(slot.item)}>
                      Sell
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
