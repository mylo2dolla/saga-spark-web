import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatError } from "@/ui/data/async";
import { getGrantedAbilities, splitInventory, sumStatMods, type MythicInventoryRow } from "@/lib/mythicEquipment";
import { callEdgeFunction } from "@/lib/edge";

function itemSummary(row: MythicInventoryRow) {
  const item = row.item;
  if (!item) return "(missing item)";
  const label = item.name && item.name.trim().length > 0 ? item.name : "Unnamed Item";
  return `${label} · ${item.slot} · ${item.rarity}`;
}

function topStatMods(item: MythicInventoryRow["item"], limit = 6): Array<{ key: string; value: number }> {
  if (!item) return [];
  const raw = item.stat_mods ?? {};
  const entries = Object.entries(raw)
    .map(([key, value]) => ({ key, value: Number(value) }))
    .filter((x) => x.key.length > 0 && Number.isFinite(x.value) && x.value !== 0);
  entries.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return entries.slice(0, limit);
}

export function MythicInventoryPanel(props: {
  campaignId: string;
  characterId: string;
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
      const { data, error: eqErr } = await callEdgeFunction<{ ok: boolean }>("mythic-inventory-equip", {
        requireAuth: true,
        idempotencyKey: `equip:${props.characterId}:${row.id}`,
        body: {
          campaignId: props.campaignId,
          characterId: props.characterId,
          inventoryId: row.id,
        },
      });
      if (eqErr) throw eqErr;
      if (!data?.ok) throw new Error("Equip failed");
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
      const { data, error: uneqErr } = await callEdgeFunction<{ ok: boolean }>("mythic-inventory-unequip", {
        requireAuth: true,
        idempotencyKey: `unequip:${props.characterId}:${row.id}`,
        body: {
          campaignId: props.campaignId,
          characterId: props.characterId,
          inventoryId: row.id,
        },
      });
      if (uneqErr) throw uneqErr;
      if (!data?.ok) throw new Error("Unequip failed");
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
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {row.item?.required_level ? <span className="rounded bg-muted px-2 py-0.5">req lvl {row.item.required_level}</span> : null}
                    {row.item?.item_power ? <span className="rounded bg-muted px-2 py-0.5">power {row.item.item_power}</span> : null}
                    {row.item?.bind_policy ? <span className="rounded bg-muted px-2 py-0.5">{row.item.bind_policy}</span> : null}
                    {row.item?.drop_tier ? <span className="rounded bg-muted px-2 py-0.5">{row.item.drop_tier}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                    {topStatMods(row.item).length === 0 ? (
                      <span className="text-muted-foreground">no stat mods</span>
                    ) : (
                      topStatMods(row.item).map((m) => (
                        <span key={m.key} className="rounded bg-muted px-2 py-0.5 text-foreground">
                          {m.key}: {m.value >= 0 ? "+" : ""}{Math.floor(m.value)}
                        </span>
                      ))
                    )}
                  </div>
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
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {row.item?.required_level ? <span className="rounded bg-muted px-2 py-0.5">req lvl {row.item.required_level}</span> : null}
                    {row.item?.item_power ? <span className="rounded bg-muted px-2 py-0.5">power {row.item.item_power}</span> : null}
                    {row.item?.bind_policy ? <span className="rounded bg-muted px-2 py-0.5">{row.item.bind_policy}</span> : null}
                    {row.item?.drop_tier ? <span className="rounded bg-muted px-2 py-0.5">{row.item.drop_tier}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                    {topStatMods(row.item).length === 0 ? (
                      <span className="text-muted-foreground">no stat mods</span>
                    ) : (
                      topStatMods(row.item).map((m) => (
                        <span key={m.key} className="rounded bg-muted px-2 py-0.5 text-foreground">
                          {m.key}: {m.value >= 0 ? "+" : ""}{Math.floor(m.value)}
                        </span>
                      ))
                    )}
                  </div>
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
