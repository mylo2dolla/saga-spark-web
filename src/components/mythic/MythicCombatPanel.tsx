import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { MythicCombatantRow, MythicActionEventRow } from "@/hooks/useMythicCombatState";

type Target =
  | { kind: "self" }
  | { kind: "combatant"; combatant_id: string }
  | { kind: "tile"; x: number; y: number };

export interface MythicSkillLite {
  id: string;
  kind: string;
  name: string;
  description: string;
  targeting: string;
  range_tiles: number;
  cooldown_turns: number;
}

function pct(n: number, d: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0;
  return Math.max(0, Math.min(1, n / d));
}

function shortEvent(e: MythicActionEventRow): string {
  if (e.event_type === "skill_used") return `skill_used: ${String((e.payload as any)?.skill_name ?? (e.payload as any)?.skill_id ?? "")}`;
  if (e.event_type === "damage") return `damage: ${String((e.payload as any)?.damage_to_hp ?? "")}`;
  if (e.event_type === "death") return `death: ${String((e.payload as any)?.target_combatant_id ?? "")}`;
  return `${e.event_type}`;
}

export function MythicCombatPanel(props: {
  campaignId: string;
  combatSessionId: string;
  combatants: MythicCombatantRow[];
  activeTurnCombatantId: string | null;
  events: MythicActionEventRow[];
  playerCombatantId: string | null;
  currentTurnIndex: number;
  skills: MythicSkillLite[];
  onUseSkill: (args: { actorCombatantId: string; skillId: string; target: Target }) => Promise<void>;
  onTickTurn?: () => Promise<void>;
  isActing: boolean;
  isTicking?: boolean;
  canTick?: boolean;
  bossPhaseLabel?: string | null;
}) {
  const { combatants, activeTurnCombatantId, events, playerCombatantId } = props;
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [selectedTile, setSelectedTile] = useState<{ x: number; y: number } | null>(null);

  const selectedSkill = useMemo(
    () => props.skills.find((s) => s.id === selectedSkillId) ?? null,
    [props.skills, selectedSkillId],
  );

  const byId = useMemo(() => {
    const m = new Map<string, MythicCombatantRow>();
    for (const c of combatants) m.set(c.id, c);
    return m;
  }, [combatants]);

  const activeActor = activeTurnCombatantId ? byId.get(activeTurnCombatantId) ?? null : null;
  const playerActor = props.playerCombatantId ? byId.get(props.playerCombatantId) ?? null : null;

  const cooldowns = useMemo(() => {
    if (!playerActor) return new Map<string, number>();
    const raw = Array.isArray((playerActor as any).statuses) ? (playerActor as any).statuses : [];
    const map = new Map<string, number>();
    for (const s of raw) {
      if (!s || typeof s !== "object") continue;
      const id = String((s as any).id ?? "");
      if (!id.startsWith("cd:")) continue;
      const expires = Number((s as any).expires_turn ?? 0);
      const skillId = id.replace("cd:", "");
      const remaining = Math.max(0, Math.floor(expires - props.currentTurnIndex));
      map.set(skillId, remaining);
    }
    return map;
  }, [playerActor, props.currentTurnIndex]);
  const selectedCooldown = selectedSkill ? (cooldowns.get(selectedSkill.id) ?? 0) : 0;

  const gridSize = useMemo(() => {
    const maxX = Math.max(9, ...combatants.map((c) => c.x));
    const maxY = Math.max(5, ...combatants.map((c) => c.y));
    return { w: Math.min(14, Math.max(6, maxX + 2)), h: Math.min(10, Math.max(6, maxY + 2)) };
  }, [combatants]);

  const tokenAt = useMemo(() => {
    const map = new Map<string, MythicCombatantRow[]>();
    for (const c of combatants) {
      const key = `${c.x},${c.y}`;
      const arr = map.get(key) ?? [];
      arr.push(c);
      map.set(key, arr);
    }
    return map;
  }, [combatants]);

  const lastEvents = useMemo(() => events.slice(-10), [events]);

  const canAct = Boolean(playerCombatantId && activeTurnCombatantId && playerCombatantId === activeTurnCombatantId);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Combat</div>
          {props.bossPhaseLabel ? (
            <div className="rounded bg-primary/15 px-2 py-1 text-[11px] font-medium text-primary">
              {props.bossPhaseLabel}
            </div>
          ) : null}
        </div>
        <div className="text-sm text-muted-foreground">
          Turn:{" "}
          <span className="font-medium text-foreground">
            {activeActor ? activeActor.name : activeTurnCombatantId ?? "(unknown)"}
          </span>
        </div>

        <div className="mt-3 grid gap-2">
          {combatants.map((c) => {
            const hpP = pct(c.hp, c.hp_max);
            const isActive = c.id === activeTurnCombatantId;
            const isSelected = c.id === selectedTargetId;
            return (
              <button
                key={c.id}
                type="button"
                className={[
                  "w-full rounded-lg border bg-background/30 p-2 text-left transition",
                  isActive ? "border-primary" : "border-border",
                  isSelected ? "ring-2 ring-primary/40" : "",
                  c.is_alive ? "" : "opacity-60",
                ].join(" ")}
                onClick={() => setSelectedTargetId(c.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {c.entity_type} · ({c.x},{c.y}) · armor {Math.floor(c.armor)}
                </div>
                {Array.isArray(c.statuses) && c.statuses.length > 0 ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    status: {c.statuses.map((s: any) => String(s?.id ?? "status")).slice(0, 3).join(", ")}
                  </div>
                ) : null}
                  </div>
                  <div className="w-28 shrink-0">
                    <div className="h-2 w-full overflow-hidden rounded bg-muted">
                      <div className="h-2 bg-red-500" style={{ width: `${hpP * 100}%` }} />
                    </div>
                    <div className="mt-1 text-right text-[11px] text-muted-foreground">
                      {Math.floor(c.hp)}/{Math.floor(c.hp_max)}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 text-xs font-semibold text-muted-foreground">Action Log (append-only)</div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          {lastEvents.map((e) => (
            <div key={e.id} className="truncate">
              t{e.turn_index}: {shortEvent(e)}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card/40 p-4">
        <div className="mb-2 text-sm font-semibold">Grid (truth)</div>
        <div className="rounded-lg border border-border bg-background/30 p-2">
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${gridSize.w}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: gridSize.h }).flatMap((_, y) =>
              Array.from({ length: gridSize.w }).map((__, x) => {
                const key = `${x},${y}`;
                const tokens = tokenAt.get(key) ?? [];
                const top = tokens[0] ?? null;
                const isHereSelected = top ? top.id === selectedTargetId : false;
                return (
                  <button
                    key={`${x}:${y}`}
                    type="button"
                    className={[
                      "aspect-square rounded border text-[10px] leading-none",
                      tokens.length ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-background/10 text-muted-foreground",
                      isHereSelected || (selectedTile && selectedTile.x === x && selectedTile.y === y) ? "ring-2 ring-primary/40" : "",
                    ].join(" ")}
                    onClick={() => {
                      setSelectedTile({ x, y });
                      if (tokens.length === 1) setSelectedTargetId(tokens[0]!.id);
                    }}
                    title={tokens.map((t) => t.name).join(", ")}
                  >
                    {top ? top.name.slice(0, 2).toUpperCase() : `${x},${y}`}
                  </button>
                );
              }),
            )}
          </div>
        </div>

        <div className="mt-4 text-sm font-semibold">Your Skills</div>
        <div className="mt-2 grid gap-2">
          {props.skills
            .filter((s) => s.kind === "active" || s.kind === "ultimate")
            .map((s) => {
              const active = s.id === selectedSkillId;
              const cd = cooldowns.get(s.id) ?? 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  className={[
                    "rounded-lg border bg-background/30 p-2 text-left transition",
                    active ? "border-primary ring-2 ring-primary/30" : "border-border",
                    cd > 0 ? "opacity-60" : "",
                  ].join(" ")}
                  onClick={() => setSelectedSkillId(s.id)}
                >
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {s.kind} · {s.targeting} · r{s.range_tiles} · cd{s.cooldown_turns}
                    {cd > 0 ? ` · cooldown ${cd}` : ""}
                  </div>
                </button>
              );
            })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={!canAct || !selectedSkill || !playerCombatantId || props.isActing || selectedCooldown > 0}
            onClick={async () => {
              if (!selectedSkill || !playerCombatantId) return;
              const targeting = selectedSkill.targeting;
              let target: Target = { kind: "self" };
              if (targeting === "single") {
                if (!selectedTargetId) return;
                target = { kind: "combatant", combatant_id: selectedTargetId };
              } else if (targeting === "self") {
                target = { kind: "self" };
              } else {
                // tile/area/cone/line: use selected tile if available, else fall back to selected combatant tile.
                if (selectedTile) {
                  target = { kind: "tile", x: selectedTile.x, y: selectedTile.y };
                } else {
                  const t = selectedTargetId ? byId.get(selectedTargetId) ?? null : null;
                  target = t ? { kind: "tile", x: t.x, y: t.y } : { kind: "tile", x: 0, y: 0 };
                }
              }

              await props.onUseSkill({
                actorCombatantId: playerCombatantId,
                skillId: selectedSkill.id,
                target,
              });
            }}
          >
            {props.isActing ? "Acting..." : canAct ? "Use Selected Skill" : "Waiting for Your Turn"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setSelectedSkillId(null);
              setSelectedTargetId(null);
              setSelectedTile(null);
            }}
          >
            Clear
          </Button>
          {props.onTickTurn ? (
            <Button
              variant="outline"
              onClick={() => void props.onTickTurn?.()}
              disabled={!props.canTick || Boolean(props.isTicking)}
            >
              {props.isTicking ? "Advancing..." : "Advance Enemy Turn"}
            </Button>
          ) : null}
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          Select a skill, then select a target combatant. Range and turn ownership are enforced by the combat engine.
        </div>
      </div>
    </div>
  );
}
