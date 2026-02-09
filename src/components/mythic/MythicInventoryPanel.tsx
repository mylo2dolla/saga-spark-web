import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatError } from "@/ui/data/async";
import { getGrantedAbilities, splitInventory, sumStatMods, type MythicInventoryRow } from "@/lib/mythicEquipment";

function itemSummary(row: MythicInventoryRow) {
  const item = row.item;
  if (!item) return "(missing item)";
  return `${item.name} · ${item.slot} · ${item.rarity}`;
}

export function MythicInventoryPanel(props: {
  rows: MythicInventoryRow[];
  onChanged: () => Promise<void>;
}) {
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { equipment, backpack } = splitInventory(props.rows);

  const equip = async (row: MythicInventoryRow) => {
    if (!row.item) return;
    setIsWorking(true);
    setError(null);
    try {
      const itemSlot = row.item.slot ?? "other";
      const isUnlimited = itemSlot === "ring" || itemSlot === "trinket";
      if (!isUnlimited) {
        // Unequip any existing item in the same slot.
        const equippedSameSlot = equipment.filter((e) => e.item?.slot === itemSlot);
        if (equippedSameSlot.length > 0) {
          const { error: uneqErr } = await supabase
            .from("mythic.inventory")
            .update({ container: "backpack", equip_slot: null, equipped_at: null })
            .in("id", equippedSameSlot.map((e) => e.id));
          if (uneqErr) throw uneqErr;
        }
      }

      const { error: eqErr } = await supabase
        .from("mythic.inventory")
        .update({ container: "equipment", equip_slot: itemSlot, equipped_at: new Date().toISOString() })
        .eq("id", row.id);
      if (eqErr) throw eqErr;
      await props.onChanged();
    } catch (e) {
      setError(formatError(e, "Failed to equip item"));
    } finally {
      setIsWorking(false);
    }
  };

  const unequip = async (row: MythicInventoryRow) => {
    setIsWorking(true);
    setError(null);
    try {
      const { error: uneqErr } = await supabase
        .from("mythic.inventory")
        .update({ container: "backpack", equip_slot: null, equipped_at: null })
        .eq("id", row.id);
      if (uneqErr) throw uneqErr;
      await props.onChanged();
    } catch (e) {
      setError(formatError(e, "Failed to unequip item"));
    } finally {
      setIsWorking(false);
    }
  };

  const equipmentTotals = sumStatMods(equipment.map((r) => r.item));

  return (
    <div className="rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-2 text-sm font-semibold">Inventory + Equipment</div>
      {error ? <div className="mb-2 text-xs text-destructive">{error}</div> : null}

      <div className="mb-3 text-xs text-muted-foreground">
        Equipment bonuses are applied in real time. Rings/trinkets stack with no limit.
      </div>

      <div className="mb-3 rounded-lg border border-border bg-background/30 p-2 text-xs text-muted-foreground">
        <div className="font-medium text-foreground">Equipped Bonuses</div>
        {Object.keys(equipmentTotals).length === 0 ? (
          <div>None</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {Object.entries(equipmentTotals).map(([k, v]) => (
              <span key={k} className="rounded bg-muted px-2 py-1">
                {k}: {v >= 0 ? "+" : ""}{Math.floor(v)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">Equipment</div>
          <div className="grid gap-2">
            {equipment.length === 0 ? (
              <div className="text-xs text-muted-foreground">No equipped items.</div>
            ) : (
              equipment.map((row) => (
                <div key={row.id} className="rounded-md border border-border bg-background/30 p-2">
                  <div className="text-sm font-medium">{itemSummary(row)}</div>
                  <div className="text-xs text-muted-foreground">
                    abilities: {getGrantedAbilities(row.item).join(", ") || "none"}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => unequip(row)} disabled={isWorking}>
                      Unequip
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-semibold text-muted-foreground">Backpack</div>
          <div className="grid gap-2">
            {backpack.length === 0 ? (
              <div className="text-xs text-muted-foreground">Backpack is empty.</div>
            ) : (
              backpack.map((row) => (
                <div key={row.id} className="rounded-md border border-border bg-background/30 p-2">
                  <div className="text-sm font-medium">{itemSummary(row)}</div>
                  <div className="text-xs text-muted-foreground">
                    abilities: {getGrantedAbilities(row.item).join(", ") || "none"}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => equip(row)} disabled={isWorking}>
                      Equip
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

