import { useMemo } from "react";
import type { MythicCombatantRow, MythicTurnOrderRow } from "@/hooks/useMythicCombatState";

export function TurnQueueStrip(props: {
  combatants: MythicCombatantRow[];
  turnOrder: MythicTurnOrderRow[];
  currentTurnIndex: number;
  playerCombatantId: string | null;
  limit?: number;
}) {
  const byId = useMemo(() => new Map(props.combatants.map((c) => [c.id, c] as const)), [props.combatants]);

  const entries = useMemo(() => {
    const order = props.turnOrder ?? [];
    if (order.length === 0) return [];
    const start = Math.max(0, Math.floor(props.currentTurnIndex ?? 0));
    const limit = Math.max(3, Math.min(8, Math.floor(props.limit ?? 5)));
    return Array.from({ length: limit }, (_, i) => {
      const idx = (start + i) % order.length;
      const row = order[idx]!;
      const c = byId.get(row.combatant_id) ?? null;
      return {
        idx,
        combatantId: row.combatant_id,
        name: c?.name ?? row.combatant_id.slice(0, 6),
        entityType: c?.entity_type ?? "npc",
        isDead: c ? !c.is_alive || c.hp <= 0 : false,
        isYou: props.playerCombatantId ? row.combatant_id === props.playerCombatantId : false,
        isActive: i === 0,
      };
    });
  }, [byId, props.currentTurnIndex, props.limit, props.playerCombatantId, props.turnOrder]);

  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background/25 px-2 py-2">
      <div className="text-[11px] font-semibold text-muted-foreground">Turn</div>
      {entries.map((e) => (
        <div
          key={`${e.idx}:${e.combatantId}`}
          className={[
            "flex items-center gap-2 rounded-full border px-2 py-1 text-[11px]",
            e.isActive ? "border-primary bg-primary/15 text-foreground" : "border-border bg-background/20 text-muted-foreground",
            e.isDead ? "opacity-60" : "",
          ].join(" ")}
          title={e.name}
        >
          <span
            className={[
              "h-2 w-2 rounded-full",
              e.entityType === "player" ? "bg-emerald-400" : e.entityType === "summon" ? "bg-cyan-300" : "bg-rose-400",
            ].join(" ")}
          />
          <span className="max-w-[120px] truncate">{e.name}</span>
          {e.isYou ? <span className="rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-300">you</span> : null}
        </div>
      ))}
    </div>
  );
}

