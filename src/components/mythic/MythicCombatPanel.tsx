import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MythicCombatTarget } from "@/hooks/useMythicCombat";
import type { MythicActionEventRow, MythicCombatantRow, MythicTurnOrderRow } from "@/hooks/useMythicCombatState";

export interface MythicSkillLite {
  id: string;
  kind: string;
  name: string;
  description: string;
  targeting: string;
  range_tiles: number;
  cooldown_turns: number;
}

export interface MythicCombatItemLite {
  inventoryId: string;
  itemId: string;
  name: string;
  quantity: number;
  container: string;
  itemType: string;
  slot: string;
  targeting: "self" | "single";
}

interface CombatGridConfig {
  width: number;
  height: number;
  blockedTiles: Array<{ x: number; y: number }>;
}

interface MythicCombatPanelProps {
  campaignId: string;
  combatSessionId: string;
  combatants: MythicCombatantRow[];
  turnOrder: MythicTurnOrderRow[];
  activeTurnCombatantId: string | null;
  events: MythicActionEventRow[];
  playerCombatantId: string | null;
  currentTurnIndex: number;
  skills: MythicSkillLite[];
  items: MythicCombatItemLite[];
  grid: CombatGridConfig;
  onUseSkill: (args: { actorCombatantId: string; skillId: string; target: MythicCombatTarget }) => Promise<void>;
  onUseItem: (args: { actorCombatantId: string; inventoryItemId: string; target?: MythicCombatTarget }) => Promise<void>;
  onMove: (args: { actorCombatantId: string; to: { x: number; y: number } }) => Promise<void>;
  onWait: (args: { actorCombatantId: string }) => Promise<void>;
  isActing: boolean;
}

type ActionMode = "move" | "skill" | "item" | "wait";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function pct(n: number, d: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0, Math.min(1, n / d));
}

function movementBudget(mobility: number): number {
  const base = Math.floor(mobility / 20) + 2;
  return Math.max(2, Math.min(8, base));
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function shortEvent(e: MythicActionEventRow): string {
  const payload = asObject(e.payload);
  if (e.event_type === "skill_used") return `skill_used: ${String(payload.skill_name ?? payload.skill_id ?? "")}`;
  if (e.event_type === "item_used") return `item_used: ${String(payload.item_name ?? payload.item_id ?? "")}`;
  if (e.event_type === "damage") return `damage: ${String(payload.damage_to_hp ?? "")}`;
  if (e.event_type === "moved") return `moved: ${String(asObject(payload.to).x ?? "?")},${String(asObject(payload.to).y ?? "?")}`;
  if (e.event_type === "death") return `death: ${String(payload.target_combatant_id ?? "")}`;
  if (e.event_type === "reward_granted") return "reward granted";
  return `${e.event_type}`;
}

function tokenColor(combatant: MythicCombatantRow): string {
  if (!combatant.is_alive) return "bg-zinc-700 border-zinc-500";
  if (combatant.entity_type === "player") return "bg-emerald-400 border-emerald-200 text-emerald-950";
  if (combatant.entity_type === "npc") return "bg-rose-400 border-rose-200 text-rose-950";
  return "bg-blue-300 border-blue-100 text-blue-950";
}

function isoPosition(x: number, y: number, tileW: number, tileH: number, originX: number) {
  return {
    left: originX + (x - y) * (tileW / 2),
    top: (x + y) * (tileH / 2),
  };
}

export function MythicCombatPanel(props: MythicCombatPanelProps) {
  const {
    combatants,
    turnOrder,
    activeTurnCombatantId,
    events,
    playerCombatantId,
    currentTurnIndex,
    grid,
  } = props;

  const [actionMode, setActionMode] = useState<ActionMode>("move");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number } | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, MythicCombatantRow>();
    for (const combatant of combatants) map.set(combatant.id, combatant);
    return map;
  }, [combatants]);

  const playerActor = playerCombatantId ? byId.get(playerCombatantId) ?? null : null;
  const activeActor = activeTurnCombatantId ? byId.get(activeTurnCombatantId) ?? null : null;
  const canAct = Boolean(playerCombatantId && activeTurnCombatantId && playerCombatantId === activeTurnCombatantId);

  const cooldowns = useMemo(() => {
    if (!playerActor) return new Map<string, number>();
    const statuses = Array.isArray(playerActor.statuses) ? playerActor.statuses : [];
    const map = new Map<string, number>();
    for (const statusValue of statuses) {
      if (!statusValue || typeof statusValue !== "object") continue;
      const status = asObject(statusValue);
      const id = String(status.id ?? "");
      if (!id.startsWith("cd:")) continue;
      const skillId = id.slice(3);
      const expiresTurn = Number(status.expires_turn ?? 0);
      const remaining = Math.max(0, Math.floor(expiresTurn - currentTurnIndex));
      map.set(skillId, remaining);
    }
    return map;
  }, [currentTurnIndex, playerActor]);

  const selectedSkill = useMemo(
    () => props.skills.find((skill) => skill.id === selectedSkillId) ?? null,
    [props.skills, selectedSkillId],
  );
  const selectedItem = useMemo(
    () => props.items.find((item) => item.inventoryId === selectedItemId) ?? null,
    [props.items, selectedItemId],
  );

  const tileW = 62;
  const tileH = 32;
  const boardWidth = (grid.width + grid.height) * (tileW / 2) + tileW * 2;
  const boardHeight = (grid.width + grid.height) * (tileH / 2) + tileH * 3;
  const originX = Math.floor(boardWidth / 2) - tileW;

  const blockedSet = useMemo(() => new Set(grid.blockedTiles.map((tile) => `${tile.x},${tile.y}`)), [grid.blockedTiles]);
  const occupiedSet = useMemo(() => {
    const set = new Set<string>();
    for (const combatant of combatants) {
      if (!combatant.is_alive) continue;
      if (combatant.id === playerCombatantId) continue;
      set.add(`${combatant.x},${combatant.y}`);
    }
    return set;
  }, [combatants, playerCombatantId]);

  const moveBudget = playerActor ? movementBudget(playerActor.mobility) : 0;

  const lastAnimation = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i]!;
      const payload = asObject(event.payload);
      const hint = payload.animation_hint;
      if (hint && typeof hint === "object" && !Array.isArray(hint)) {
        return asObject(hint);
      }
    }
    return null;
  }, [events]);

  const lastEvents = useMemo(() => events.slice(-12), [events]);

  const executeMove = async () => {
    if (!canAct || !playerCombatantId || !selectedTile) return;
    await props.onMove({
      actorCombatantId: playerCombatantId,
      to: selectedTile,
    });
  };

  const executeWait = async () => {
    if (!canAct || !playerCombatantId) return;
    await props.onWait({ actorCombatantId: playerCombatantId });
  };

  const executeSkill = async () => {
    if (!canAct || !playerCombatantId || !selectedSkill) return;

    let target: MythicCombatTarget = { kind: "self" };
    if (selectedSkill.targeting === "single") {
      if (!selectedTargetId) return;
      target = { kind: "combatant", combatant_id: selectedTargetId };
    } else if (selectedSkill.targeting === "self") {
      target = { kind: "self" };
    } else {
      if (selectedTile) {
        target = { kind: "tile", x: selectedTile.x, y: selectedTile.y };
      } else {
        const combatant = selectedTargetId ? byId.get(selectedTargetId) ?? null : null;
        if (combatant) {
          target = { kind: "tile", x: combatant.x, y: combatant.y };
        }
      }
    }

    await props.onUseSkill({
      actorCombatantId: playerCombatantId,
      skillId: selectedSkill.id,
      target,
    });
  };

  const executeItem = async () => {
    if (!canAct || !playerCombatantId || !selectedItem) return;
    let target: MythicCombatTarget | undefined;
    if (selectedItem.targeting === "single") {
      if (selectedTargetId) {
        target = { kind: "combatant", combatant_id: selectedTargetId };
      } else if (selectedTile) {
        target = { kind: "tile", x: selectedTile.x, y: selectedTile.y };
      }
    } else {
      target = { kind: "self" };
    }

    await props.onUseItem({
      actorCombatantId: playerCombatantId,
      inventoryItemId: selectedItem.inventoryId,
      target,
    });
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">Isometric Tactics Board</div>
          <div className="text-xs text-muted-foreground">
            Turn: <span className="font-medium text-foreground">{activeActor?.name ?? activeTurnCombatantId ?? "-"}</span>
          </div>
        </div>

        <div className="mythic-combat-board-wrap">
          <div
            className="mythic-combat-board"
            style={{ width: `${boardWidth}px`, height: `${boardHeight}px` }}
          >
            {Array.from({ length: grid.height }).flatMap((_, y) =>
              Array.from({ length: grid.width }).map((__, x) => {
                const iso = isoPosition(x, y, tileW, tileH, originX);
                const blocked = blockedSet.has(`${x},${y}`);
                const occupied = occupiedSet.has(`${x},${y}`);
                const inMoveRange = playerActor
                  ? manhattan(playerActor.x, playerActor.y, x, y) <= moveBudget
                  : false;
                const isSelectedTile = selectedTile?.x === x && selectedTile?.y === y;
                const canMoveTo = !blocked && !occupied && inMoveRange;

                return (
                  <button
                    key={`tile:${x}:${y}`}
                    type="button"
                    className={[
                      "mythic-iso-tile",
                      blocked ? "is-blocked" : "",
                      isSelectedTile ? "is-selected" : "",
                      actionMode === "move" && canMoveTo && canAct ? "is-move-range" : "",
                    ].join(" ")}
                    style={{ left: `${iso.left}px`, top: `${iso.top}px`, width: `${tileW}px`, height: `${tileH}px` }}
                    onClick={() => {
                      setSelectedTile({ x, y });
                      const token = combatants.find((combatant) => combatant.x === x && combatant.y === y && combatant.is_alive);
                      if (token) setSelectedTargetId(token.id);
                    }}
                    title={`(${x},${y})`}
                  />
                );
              }),
            )}

            {combatants
              .slice()
              .sort((a, b) => (a.x + a.y) - (b.x + b.y))
              .map((combatant) => {
                const iso = isoPosition(combatant.x, combatant.y, tileW, tileH, originX);
                const hpRatio = pct(combatant.hp, combatant.hp_max);
                const isSelected = selectedTargetId === combatant.id;
                const isActive = activeTurnCombatantId === combatant.id;
                return (
                  <button
                    key={combatant.id}
                    type="button"
                    className={[
                      "mythic-iso-token",
                      tokenColor(combatant),
                      isSelected ? "ring-2 ring-primary/60" : "",
                      isActive ? "ring-2 ring-amber-300/70" : "",
                    ].join(" ")}
                    style={{ left: `${iso.left + tileW / 2 - 12}px`, top: `${iso.top - 10}px` }}
                    onClick={() => {
                      setSelectedTargetId(combatant.id);
                      setSelectedTile({ x: combatant.x, y: combatant.y });
                    }}
                    title={`${combatant.name} (${combatant.x},${combatant.y})`}
                  >
                    <span className="text-[10px] font-semibold leading-none">{combatant.name.slice(0, 2).toUpperCase()}</span>
                    <span
                      className="mythic-token-hp"
                      style={{ width: `${Math.max(8, Math.floor(20 * hpRatio))}px` }}
                    />
                  </button>
                );
              })}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <div>
            Grid {grid.width}x{grid.height} · blocked {grid.blockedTiles.length}
          </div>
          <div>
            {lastAnimation
              ? `Anim: ${String(lastAnimation.kind ?? "effect")}`
              : "Anim: idle"}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Turn Timeline</div>
          <div className="space-y-1">
            {turnOrder.map((entry) => {
              const combatant = byId.get(entry.combatant_id) ?? null;
              const isActive = activeTurnCombatantId === entry.combatant_id;
              const isDead = combatant ? !combatant.is_alive : false;
              return (
                <div
                  key={`${entry.turn_index}:${entry.combatant_id}`}
                  className={[
                    "rounded-md border px-2 py-1 text-xs",
                    isActive ? "border-primary bg-primary/15 text-foreground" : "border-border bg-background/20 text-muted-foreground",
                    isDead ? "opacity-50" : "",
                  ].join(" ")}
                >
                  {entry.turn_index}. {combatant?.name ?? entry.combatant_id}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Action Picker</div>
          <div className="grid grid-cols-4 gap-2">
            <Button
              variant={actionMode === "move" ? "default" : "secondary"}
              size="sm"
              onClick={() => setActionMode("move")}
            >
              Move
            </Button>
            <Button
              variant={actionMode === "skill" ? "default" : "secondary"}
              size="sm"
              onClick={() => setActionMode("skill")}
            >
              Skill
            </Button>
            <Button
              variant={actionMode === "item" ? "default" : "secondary"}
              size="sm"
              onClick={() => setActionMode("item")}
            >
              Item
            </Button>
            <Button
              variant={actionMode === "wait" ? "default" : "secondary"}
              size="sm"
              onClick={() => setActionMode("wait")}
            >
              Wait
            </Button>
          </div>

          {actionMode === "move" ? (
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <div>Movement budget: {moveBudget} tiles</div>
              <div>Selected tile: {selectedTile ? `${selectedTile.x},${selectedTile.y}` : "none"}</div>
              <Button
                className="w-full"
                disabled={!canAct || !selectedTile || props.isActing}
                onClick={executeMove}
              >
                {props.isActing ? "Acting..." : canAct ? "Confirm Move" : "Waiting for your turn"}
              </Button>
            </div>
          ) : null}

          {actionMode === "skill" ? (
            <div className="mt-3 space-y-3">
              <div className="max-h-44 space-y-2 overflow-auto pr-1">
                {props.skills
                  .filter((skill) => skill.kind === "active" || skill.kind === "ultimate")
                  .map((skill) => {
                    const selected = selectedSkillId === skill.id;
                    const cooldown = cooldowns.get(skill.id) ?? 0;
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        className={[
                          "w-full rounded-md border p-2 text-left",
                          selected ? "border-primary bg-primary/10" : "border-border bg-background/20",
                          cooldown > 0 ? "opacity-60" : "",
                        ].join(" ")}
                        onClick={() => setSelectedSkillId(skill.id)}
                      >
                        <div className="text-xs font-semibold">{skill.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {skill.targeting} · r{skill.range_tiles} · cd{skill.cooldown_turns}
                          {cooldown > 0 ? ` · cooldown ${cooldown}` : ""}
                        </div>
                      </button>
                    );
                  })}
              </div>
              <Button
                className="w-full"
                disabled={!canAct || !selectedSkill || props.isActing || (selectedSkill ? (cooldowns.get(selectedSkill.id) ?? 0) > 0 : false)}
                onClick={executeSkill}
              >
                {props.isActing ? "Acting..." : canAct ? "Use Selected Skill" : "Waiting for your turn"}
              </Button>
            </div>
          ) : null}

          {actionMode === "item" ? (
            <div className="mt-3 space-y-3">
              <div className="max-h-44 space-y-2 overflow-auto pr-1">
                {props.items.length === 0 ? (
                  <div className="rounded-md border border-border bg-background/20 p-2 text-xs text-muted-foreground">
                    No usable combat items.
                  </div>
                ) : (
                  props.items.map((item) => (
                    <button
                      key={item.inventoryId}
                      type="button"
                      className={[
                        "w-full rounded-md border p-2 text-left",
                        selectedItemId === item.inventoryId ? "border-primary bg-primary/10" : "border-border bg-background/20",
                        item.quantity <= 0 ? "opacity-60" : "",
                      ].join(" ")}
                      onClick={() => setSelectedItemId(item.inventoryId)}
                    >
                      <div className="text-xs font-semibold">{item.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        qty {item.quantity} · {item.slot} · {item.targeting}
                      </div>
                    </button>
                  ))
                )}
              </div>
              <Button
                className="w-full"
                disabled={!canAct || !selectedItem || selectedItem.quantity <= 0 || props.isActing}
                onClick={executeItem}
              >
                {props.isActing ? "Acting..." : canAct ? "Use Selected Item" : "Waiting for your turn"}
              </Button>
              <div className="text-[11px] text-muted-foreground">
                Consumables are consumed from backpack inventory and resolved as deterministic action events.
              </div>
            </div>
          ) : null}

          {actionMode === "wait" ? (
            <div className="mt-3 space-y-2 text-xs text-muted-foreground">
              <div>End this turn without movement or skill usage.</div>
              <Button className="w-full" disabled={!canAct || props.isActing} onClick={executeWait}>
                {props.isActing ? "Acting..." : canAct ? "Confirm Wait" : "Waiting for your turn"}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-card/40 p-4">
          <div className="mb-2 text-sm font-semibold">Combat Log</div>
          <div className="max-h-36 space-y-1 overflow-auto text-xs text-muted-foreground">
            {lastEvents.map((event) => (
              <div key={event.id}>
                t{event.turn_index}: {shortEvent(event)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
