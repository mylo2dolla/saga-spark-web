import type { MythicSkill } from "@/types/mythic";
import type { MythicCombatantRow } from "@/hooks/useMythicCombatState";

export interface SkillAvailabilityEntry {
  skillId: string;
  name: string;
  kind: string;
  targeting: string;
  rangeTiles: number;
  cooldownTurns: number;
  cooldownRemaining: number;
  isPlayersTurn: boolean;
  usableNow: boolean;
  reason: string | null;
  rangeToFocused: number | null;
  inRangeForFocused: boolean | null;
  requiresTarget: boolean;
  hasFocusedTarget: boolean;
  hasEnoughPower: boolean;
}

export interface ResolvedSkillTarget {
  skill: MythicSkill;
  target:
    | { kind: "self" }
    | { kind: "combatant"; combatant_id: string }
    | { kind: "tile"; x: number; y: number };
  targetCombatantId?: string;
}

function distanceForMetric(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  metric: "manhattan" | "chebyshev" | "euclidean",
): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  if (metric === "euclidean") return Math.sqrt(dx * dx + dy * dy);
  if (metric === "chebyshev") return Math.max(dx, dy);
  return dx + dy;
}

function normalizeString(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cooldownMapFromStatuses(statuses: unknown, currentTurnIndex: number): Map<string, number> {
  const map = new Map<string, number>();
  const rawList = Array.isArray(statuses) ? statuses : [];
  for (const status of rawList) {
    if (!status || typeof status !== "object") continue;
    const raw = status as Record<string, unknown>;
    const id = typeof raw.id === "string" ? raw.id : "";
    if (!id.startsWith("cd:")) continue;
    const skillId = id.slice(3);
    const expiresTurn = Number(raw.expires_turn ?? 0);
    const remaining = Math.max(0, Math.floor(expiresTurn - currentTurnIndex));
    map.set(skillId, remaining);
  }
  return map;
}

function isActiveSkill(skill: MythicSkill): boolean {
  return skill.kind === "active" || skill.kind === "ultimate";
}

function findByQuery<T extends { id: string; name: string }>(entries: T[], query: string): T | null {
  const clean = query.trim();
  if (!clean) return null;
  const norm = normalizeString(clean);
  const byId = entries.find((entry) => entry.id === clean);
  if (byId) return byId;
  const exact = entries.find((entry) => normalizeString(entry.name) === norm);
  if (exact) return exact;
  const partial = entries.find((entry) => normalizeString(entry.name).includes(norm));
  return partial ?? null;
}

export function buildSkillAvailability(args: {
  skills: MythicSkill[];
  combatants: MythicCombatantRow[];
  playerCombatantId: string | null;
  activeTurnCombatantId: string | null;
  currentTurnIndex: number;
  focusedTargetCombatantId?: string | null;
}): SkillAvailabilityEntry[] {
  const playerCombatant = args.playerCombatantId
    ? args.combatants.find((entry) => entry.id === args.playerCombatantId) ?? null
    : null;
  const focusedTarget = args.focusedTargetCombatantId
    ? args.combatants.find((entry) => entry.id === args.focusedTargetCombatantId) ?? null
    : null;
  const isPlayersTurn = Boolean(
    playerCombatant &&
    args.activeTurnCombatantId &&
    playerCombatant.id === args.activeTurnCombatantId,
  );
  const cooldowns = cooldownMapFromStatuses(playerCombatant?.statuses, args.currentTurnIndex);

  return args.skills
    .filter((skill) => isActiveSkill(skill) && typeof skill.id === "string")
    .map((skill) => {
      const skillId = String(skill.id);
      const cdRemaining = cooldowns.get(skillId) ?? 0;
      let reason: string | null = null;
      if (!playerCombatant) reason = "No player combatant present.";
      else if (!playerCombatant.is_alive) reason = "You are down.";
      else if (!isPlayersTurn) reason = "Not your turn.";
      else if (cdRemaining > 0) reason = `Cooldown ${cdRemaining} turn(s).`;
      const requiresTarget = skill.targeting !== "self";
      const hasFocusedTarget = Boolean(focusedTarget);
      if (!reason && requiresTarget && !hasFocusedTarget) reason = "Select a target.";
      const metricRaw = String(skill.targeting_json?.metric ?? "manhattan").toLowerCase();
      const metric = metricRaw === "euclidean" || metricRaw === "chebyshev" ? metricRaw : "manhattan";
      const rangeToFocused = playerCombatant && focusedTarget
        ? distanceForMetric(playerCombatant.x, playerCombatant.y, focusedTarget.x, focusedTarget.y, metric)
        : null;
      const inRangeForFocused = rangeToFocused === null ? null : rangeToFocused <= Math.max(0, Number(skill.range_tiles ?? 0));
      if (!reason && requiresTarget && inRangeForFocused === false) {
        const rangeTiles = Math.max(0, Number(skill.range_tiles ?? 0));
        reason = `Out of range (${rangeToFocused?.toFixed(1)} > ${rangeTiles}).`;
      }
      const resourceCost = Number(skill.cost_json?.amount ?? 0);
      const hasEnoughPower = !playerCombatant || resourceCost <= 0 || Number(playerCombatant.power ?? 0) >= resourceCost;
      if (!reason && !hasEnoughPower) {
        reason = `Needs ${Math.max(0, Math.floor(resourceCost))} power.`;
      }

      return {
        skillId,
        name: skill.name,
        kind: skill.kind,
        targeting: skill.targeting,
        rangeTiles: Number(skill.range_tiles ?? 0),
        cooldownTurns: Number(skill.cooldown_turns ?? 0),
        cooldownRemaining: cdRemaining,
        isPlayersTurn,
        usableNow: reason === null,
        reason,
        rangeToFocused,
        inRangeForFocused,
        requiresTarget,
        hasFocusedTarget,
        hasEnoughPower,
      };
    });
}

export function resolveSkillTarget(args: {
  skills: MythicSkill[];
  combatants: MythicCombatantRow[];
  playerCombatantId: string;
  activeTurnCombatantId: string | null;
  currentTurnIndex: number;
  skillQuery: string;
  targetQuery?: string;
  focusedTargetCombatantId?: string | null;
}): { ok: true; value: ResolvedSkillTarget } | { ok: false; error: string } {
  const player = args.combatants.find((entry) => entry.id === args.playerCombatantId);
  if (!player) return { ok: false, error: "Player combatant not found." };
  if (!player.is_alive) return { ok: false, error: "You cannot act while down." };
  if (!args.activeTurnCombatantId || args.activeTurnCombatantId !== player.id) {
    return { ok: false, error: "It is not your turn." };
  }

  const activeSkills = args.skills
    .filter((skill): skill is MythicSkill & { id: string } => isActiveSkill(skill) && typeof skill.id === "string")
    .map((skill) => ({ id: skill.id, name: skill.name, skill }));

  const matchedSkill = findByQuery(activeSkills, args.skillQuery);
  if (!matchedSkill) return { ok: false, error: `Skill not found: ${args.skillQuery}` };

  const skill = matchedSkill.skill;
  const cooldowns = cooldownMapFromStatuses(player.statuses, args.currentTurnIndex);
  const cooldownRemaining = cooldowns.get(skill.id) ?? 0;
  if (cooldownRemaining > 0) {
    return { ok: false, error: `${skill.name} is on cooldown for ${cooldownRemaining} turn(s).` };
  }

  if (skill.targeting === "self") {
    return { ok: true, value: { skill, target: { kind: "self" }, targetCombatantId: player.id } };
  }

  const candidates = args.combatants.filter((entry) => entry.is_alive && entry.id !== player.id);
  const preferredTarget = args.targetQuery
    ? findByQuery(candidates.map((entry) => ({ id: entry.id, name: entry.name, entry })), args.targetQuery)?.entry ?? null
    : null;
  const focusedTarget = args.focusedTargetCombatantId
    ? candidates.find((entry) => entry.id === args.focusedTargetCombatantId) ?? null
    : null;
  const fallbackEnemy = candidates.find((entry) => entry.entity_type !== "player") ?? candidates[0] ?? null;
  const targetCombatant = preferredTarget ?? focusedTarget ?? fallbackEnemy;
  if (!targetCombatant) return { ok: false, error: "No valid target found." };

  const metricRaw = String(skill.targeting_json?.metric ?? "manhattan").toLowerCase();
  const metric = metricRaw === "euclidean" || metricRaw === "chebyshev" ? metricRaw : "manhattan";
  const rangeTiles = Math.max(0, Number(skill.range_tiles ?? 0));
  const distance = distanceForMetric(player.x, player.y, targetCombatant.x, targetCombatant.y, metric);
  if (rangeTiles > 0 && distance > rangeTiles) {
    return { ok: false, error: `${skill.name} is out of range (${distance.toFixed(1)} > ${rangeTiles}).` };
  }

  if (skill.targeting === "single") {
    return {
      ok: true,
      value: {
        skill,
        target: { kind: "combatant", combatant_id: targetCombatant.id },
        targetCombatantId: targetCombatant.id,
      },
    };
  }

  return {
    ok: true,
    value: {
      skill,
      target: { kind: "tile", x: targetCombatant.x, y: targetCombatant.y },
      targetCombatantId: targetCombatant.id,
    },
  };
}
