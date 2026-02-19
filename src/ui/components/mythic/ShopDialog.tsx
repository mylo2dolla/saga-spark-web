import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { callEdgeFunction } from "@/lib/edge";
import { parseEdgeError } from "@/lib/edgeError";

type ShopStockItem = {
  id: string;
  price: number;
  item: Record<string, unknown>;
  sold?: boolean;
};

type ShopStockPayload = {
  ok: boolean;
  vendorId: string;
  vendorName: string;
  source?: "cached" | "generated" | "refreshed";
  stock: {
    vendor_id: string;
    vendor_name: string;
    generated_at: string;
    seed: number;
    items: ShopStockItem[];
  };
  requestId?: string;
};

type BuyPayload = {
  ok: boolean;
  itemId: string;
  coins: number;
  vendorId: string;
  stockItemId: string;
  requestId?: string;
};

function toInt(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

function labelRarity(r: unknown): string {
  const s = typeof r === "string" ? r : "";
  return s ? s[0]!.toUpperCase() + s.slice(1) : "Common";
}

export function ShopDialog(props: {
  open: boolean;
  campaignId: string;
  characterId: string;
  vendorId: string | null;
  vendorName?: string | null;
  coins: number;
  onOpenChange: (open: boolean) => void;
  onPurchased: () => Promise<void>;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isBuying, setIsBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stock, setStock] = useState<ShopStockPayload["stock"] | null>(null);
  const [stockSource, setStockSource] = useState<ShopStockPayload["source"] | null>(null);

  const displayName = useMemo(() => {
    if (props.vendorName && props.vendorName.trim().length > 0) return props.vendorName.trim();
    return stock?.vendor_name ?? "Merchant";
  }, [props.vendorName, stock?.vendor_name]);

  const loadStock = useMemo(() => {
    return async (refresh: boolean) => {
      if (!props.vendorId) return;
      setIsLoading(true);
      setError(null);
      try {
        const { data, error: edgeError } = await callEdgeFunction<ShopStockPayload>("mythic-shop-stock", {
          requireAuth: true,
          timeoutMs: 25_000,
          maxRetries: 0,
          idempotencyKey: `shop-stock:${props.campaignId}:${props.vendorId}:${refresh ? "refresh" : "read"}`,
          body: {
            campaignId: props.campaignId,
            vendorId: props.vendorId,
            refresh,
          },
        });
        if (edgeError) throw edgeError;
        if (!data?.ok) throw new Error("Failed to load shop stock");
        setStock(data.stock);
        setStockSource(data.source ?? null);
      } catch (e) {
        const parsed = parseEdgeError(e, "Failed to load shop stock");
        setError(parsed.message);
      } finally {
        setIsLoading(false);
      }
    };
  }, [props.campaignId, props.vendorId]);

  useEffect(() => {
    if (!props.open) return;
    if (!props.vendorId) return;
    void loadStock(false);
  }, [loadStock, props.open, props.vendorId]);

  const items = stock?.items ?? [];

  const handleBuy = async (stockItemId: string) => {
    if (!props.vendorId) return;
    setIsBuying(stockItemId);
    setError(null);
    try {
      const { data, error: edgeError } = await callEdgeFunction<BuyPayload>("mythic-shop-buy", {
        requireAuth: true,
        timeoutMs: 25_000,
        maxRetries: 0,
        idempotencyKey: `shop-buy:${props.characterId}:${props.vendorId}:${stockItemId}`,
        body: {
          campaignId: props.campaignId,
          characterId: props.characterId,
          vendorId: props.vendorId,
          stockItemId,
        },
      });
      if (edgeError) throw edgeError;
      if (!data?.ok) throw new Error("Purchase failed");

      // Optimistically mark sold in local stock.
      setStock((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          items: prev.items.map((it) => (it.id === stockItemId ? { ...it, sold: true } : it)),
        };
      });

      await props.onPurchased();
    } catch (e) {
      const parsed = parseEdgeError(e, "Purchase failed");
      setError(parsed.message);
    } finally {
      setIsBuying(null);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden border border-border bg-card/90 backdrop-blur-md">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{displayName}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Coins: <span className="font-medium text-foreground">{props.coins}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-auto pr-1">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-background/20 px-3 py-2 text-[11px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-3">
              <span>Stock source: <span className="text-foreground">{stockSource ?? "unknown"}</span></span>
              {stock?.generated_at ? (
                <span>Generated: <span className="text-foreground">{new Date(stock.generated_at).toLocaleString()}</span></span>
              ) : null}
            </div>
            <Button size="sm" variant="outline" onClick={() => void loadStock(true)} disabled={isLoading || !props.vendorId}>
              Regenerate vendor stock
            </Button>
          </div>

          {error ? (
            <div className="mb-3 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading stock...</span>
            </div>
          ) : null}

          {!isLoading && items.length === 0 ? (
            <div className="text-sm text-muted-foreground">No stock available.</div>
          ) : null}

          <div className="grid gap-2 md:grid-cols-2">
            {items.map((entry) => {
              const item = entry.item ?? {};
              const name = String((item as Record<string, unknown>).name ?? "Item");
              const rarity = labelRarity((item as Record<string, unknown>).rarity);
              const slot = String((item as Record<string, unknown>).slot ?? "other");
              const requiredLevel = toInt((item as Record<string, unknown>).required_level, 1);
              const itemPower = toInt((item as Record<string, unknown>).item_power, 0);
              const mods = (item as Record<string, unknown>).stat_mods as Record<string, unknown> | undefined;
              const sold = Boolean(entry.sold);
              const price = toInt(entry.price, 0);
              const canAfford = props.coins >= price;

              return (
                <div key={entry.id} className="rounded-lg border border-border bg-background/30 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold">{name}</div>
                      <div className="text-xs text-muted-foreground">{rarity} · {slot} · req lvl {requiredLevel} · power {itemPower}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div className="font-medium text-foreground">{price} coins</div>
                      {sold ? <div className="text-[11px] text-muted-foreground">Sold</div> : null}
                    </div>
                  </div>

                  {mods && Object.keys(mods).length > 0 ? (
                    <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                      {Object.entries(mods)
                        .filter(([k]) => !k.startsWith("_"))
                        .slice(0, 6)
                        .map(([k, v]) => (
                          <div key={k}>
                            {k}: <span className="text-foreground">{String(v)}</span>
                          </div>
                        ))}
                    </div>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <Button
                      size="sm"
                      onClick={() => void handleBuy(entry.id)}
                      disabled={sold || Boolean(isBuying) || !canAfford}
                    >
                      {isBuying === entry.id ? "Buying..." : sold ? "Sold" : "Buy"}
                    </Button>
                    {!sold && !canAfford ? (
                      <div className="text-[11px] text-destructive">Need {Math.max(0, price - props.coins)} more coins</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
