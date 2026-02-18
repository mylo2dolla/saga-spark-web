import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import type { MythicCombatantRow } from "@/hooks/useMythicCombatState";
import type { MythicSkill } from "@/types/mythic";
import { distanceTiles, hasLineOfSight, type Metric } from "@/components/mythic/combat/combatMath";
import type { CombatFocus } from "@/components/mythic/combat/PixelCombatBoard";

type Target =
  | { kind: "self" }
  | { kind: "combatant"; combatant_id: string }
  | { kind: "tile"; x: number; y: number };

type DisabledReason =
  | { code: "not_your_turn" }
  | { code: "cooldown"; remaining: number }
  | { code: "out_of_range" }
  | { code: "no_line_of_sight" }
  | { code: "insufficient_power" }
  | { code: "missing_target" };

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function getFlatCostAmount(skill: MythicSkill): number {
  const amount = num((skill.cost_json as any)?.amount, 0);
  return Math.max(0, Math.floor(amount));
}

function parseCooldowns(statuses: unknown, currentTurnIndex: number): Map<string, number> {
  const raw = Array.isArray(statuses) ? statuses : [];
  const map = new Map<string, number>();
  for (const s of raw) {
    if (!s || typeof s !== "object") continue;
    const id = String((s as any).id ?? "");
    if (!id.startsWith("cd:")) continue;
    const expires = Number((s as any).expires_turn ?? 0);
    const skillId = id.replace("cd:", "");
    const remaining = Math.max(0, Math.floor(expires - currentTurnIndex));
    map.set(skillId, remaining);
  }
  return map;
}

function resolveTarget(args: {
  skill: MythicSkill;
  focus: CombatFocus;
  combatantsById: Map<string, MythicCombatantRow>;
}): { target: Target | null; missing: boolean } {
  const { skill, focus, combatantsById } = args;

  if (skill.targeting === "self") return { target: { kind: "self" }, missing: false };

  if (!focus) return { target: null, missing: true };

  if (skill.targeting === "single") {
    if (focus.kind === "combatant") return { target: { kind: "combatant", combatant_id: focus.combatantId }, missing: false };
    // If focused tile has a combatant, treat it as single-target.
    const t = Array.from(combatantsById.values()).find((c) => c.is_alive && c.x === focus.x && c.y === focus.y);
    if (t) return { target: { kind: "combatant", combatant_id: t.id }, missing: false };
    return { target: null, missing: true };
  }

  // tile/area targeting
  if (focus.kind === "tile") return { target: { kind: "tile", x: focus.x, y: focus.y }, missing: false };
  const c = combatantsById.get(focus.combatantId) ?? null;
  if (!c) return { target: null, missing: true };
  return { target: { kind: "tile", x: c.x, y: c.y }, missing: false };
}

export function SkillTray(props: {
  skills: MythicSkill[];
  combatants: MythicCombatantRow[];
  blockedTiles: Array<{ x: number; y: number }>;
  currentTurnIndex: number;
  playerCombatantId: string | null;
  activeTurnCombatantId: string | null;
  focus: CombatFocus;
  hoveredSkillId: string | null;
  onHoverSkill: (skill: MythicSkill | null) => void;
  onCast: (args: { actorCombatantId: string; skillId: string; target: Target }) => Promise<void>;
}) {
  const combatantsById = useMemo(() => new Map(props.combatants.map((c) => [c.id, c] as const)), [props.combatants]);
  const actor = props.playerCombatantId ? combatantsById.get(props.playerCombatantId) ?? null : null;
  const canAct = Boolean(actor && props.activeTurnCombatantId && actor.id === props.activeTurnCombatantId);

  const blockedSet = useMemo(() => new Set(props.blockedTiles.map((t) => `${t.x},${t.y}`)), [props.blockedTiles]);
  const cooldowns = useMemo(() => parseCooldowns(actor?.statuses ?? null, props.currentTurnIndex), [actor?.statuses, props.currentTurnIndex]);

  const activeSkills = useMemo(() => {
    // Show actives/ultimates first; include Move if present.
    return props.skills
      .filter((s) => s.kind === "active" || s.kind === "ultimate")
      .sort((a, b) => (a.name === "Move" ? -1 : 0) - (b.name === "Move" ? -1 : 0) || a.name.localeCompare(b.name));
  }, [props.skills]);

  const evaluated = useMemo(() => {
    if (!actor) return [];
    return activeSkills.map((skill) => {
      const skillId = typeof skill.id === "string" ? skill.id : null;
      const { target, missing } = resolveTarget({ skill, focus: props.focus, combatantsById });
      const cd = skillId ? (cooldowns.get(skillId) ?? 0) : 0;

      const metric = (skill.targeting_json?.metric ?? "manhattan") as Metric;
      const requiresLos = Boolean(skill.targeting_json?.requires_los);
      const blocksOnWalls = Boolean(skill.targeting_json?.blocks_on_walls);
      const cost = getFlatCostAmount(skill);

      const disabled: DisabledReason | null = (() => {
        if (!skillId) return { code: "missing_target" };
        if (!canAct) return { code: "not_your_turn" };
        if (missing || !target) return { code: "missing_target" };
        if (cd > 0) return { code: "cooldown", remaining: cd };
        if (cost > 0 && Number(actor.power ?? 0) < cost) return { code: "insufficient_power" };

        let tx = actor.x;
        let ty = actor.y;
        if (target.kind === "combatant") {
          const t = combatantsById.get(target.combatant_id) ?? null;
          if (!t) return { code: "missing_target" };
          tx = t.x;
          ty = t.y;
        } else if (target.kind === "tile") {
          tx = target.x;
          ty = target.y;
        }

        const dist = distanceTiles(metric, actor.x, actor.y, tx, ty);
        if (dist > Number(skill.range_tiles ?? 0)) return { code: "out_of_range" };

        if (requiresLos && blocksOnWalls && !hasLineOfSight(actor.x, actor.y, tx, ty, blockedSet)) {
          return { code: "no_line_of_sight" };
        }
        return null;
      })();

      return { skill, target, disabled };
    });
  }, [activeSkills, actor, blockedSet, canAct, combatantsById, cooldowns, props.focus]);

  if (!actor) {
    return (
      <div className="rounded-lg border border-border bg-background/30 p-3 text-xs text-muted-foreground">
        No player combatant found for this session.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-background/30 p-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-muted-foreground">Actions</div>
        {!canAct ? (
          <div className="text-[11px] text-muted-foreground">Waiting for your turn.</div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {evaluated.map(({ skill, target, disabled }) => {
          const id = typeof skill.id === "string" ? skill.id : skill.name;
          const label = skill.name;
          const hint = disabled
            ? disabled.code === "cooldown"
              ? `cooldown ${disabled.remaining}`
              : disabled.code.replace(/_/g, " ")
            : `${skill.targeting} · r${skill.range_tiles}`;

          return (
            <Button
              key={id}
              size="sm"
              variant={disabled ? "secondary" : "default"}
              disabled={Boolean(disabled)}
              onMouseEnter={() => props.onHoverSkill(skill)}
              onMouseLeave={() => props.onHoverSkill(null)}
              onFocus={() => props.onHoverSkill(skill)}
              onBlur={() => props.onHoverSkill(null)}
              onClick={() => {
                if (disabled || !target) return;
                if (typeof skill.id !== "string") return;
                void props.onCast({ actorCombatantId: actor.id, skillId: skill.id, target });
              }}
              title={hint}
              className="justify-start"
            >
              <div className="flex flex-col items-start leading-tight">
                <span className="text-xs font-medium">{label}</span>
                <span className="text-[10px] text-muted-foreground">{hint}</span>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
