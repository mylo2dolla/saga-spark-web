import { DEFAULT_RULE_TUNABLES, clamp, type RuleTunables } from "@/rules/constants";
import type {
  ActiveStatus,
  Actor,
  ElementKey,
  StatModifier,
  StatusCategory,
  StatusEffectDefinition,
  StackingMode,
} from "@/rules/schema";

export interface StatusApplyResult {
  statuses: ActiveStatus[];
  applied: boolean;
  reason: "applied" | "ignored_none" | "refreshed" | "stacked" | "intensified" | "immune";
}

export interface StatusTickEvent {
  statusId: string;
  category: StatusCategory;
  amount: number;
  kind: "damage" | "heal" | "none";
  element: ElementKey;
  remainingTurns: number;
  expired: boolean;
}

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function makeStableKey(status: ActiveStatus): string {
  return `${status.id}:${status.sourceActorId ?? ""}:${status.sourceSkillId ?? ""}`;
}

export function hasStatusImmunity(args: {
  target: Pick<Actor, "statuses">;
  incomingStatusId: string;
  incomingCategory?: StatusCategory;
}): boolean {
  const incoming = args.incomingStatusId.trim().toLowerCase();
  const category = (args.incomingCategory ?? "debuff").toLowerCase();
  for (const status of args.target.statuses) {
    const immunities = status.metadata?.immunitiesGranted;
    if (!Array.isArray(immunities)) continue;
    for (const value of immunities) {
      const token = String(value).trim().toLowerCase();
      if (!token) continue;
      if (token === incoming || token === category || token === "all") {
        return true;
      }
    }
  }
  return false;
}

function sortedStatuses(statuses: ActiveStatus[]): ActiveStatus[] {
  return [...statuses].sort((left, right) => {
    const idDelta = left.id.localeCompare(right.id);
    if (idDelta !== 0) return idDelta;
    return makeStableKey(left).localeCompare(makeStableKey(right));
  });
}

function findExistingIndex(statuses: ActiveStatus[], incoming: ActiveStatus): number {
  return statuses.findIndex((entry) => entry.id === incoming.id && makeStableKey(entry) === makeStableKey(incoming));
}

function applyStackingMode(args: {
  statuses: ActiveStatus[];
  incoming: ActiveStatus;
  stacking: StackingMode;
  maxStacks: number;
  intensityCap: number;
}): StatusApplyResult {
  const statuses = [...args.statuses];
  const idx = findExistingIndex(statuses, args.incoming);
  const hasExisting = idx >= 0;

  if (!hasExisting) {
    statuses.push(args.incoming);
    return { statuses: sortedStatuses(statuses), applied: true, reason: "applied" };
  }

  const current = statuses[idx]!;
  if (args.stacking === "none") {
    return { statuses: sortedStatuses(statuses), applied: false, reason: "ignored_none" };
  }

  if (args.stacking === "refresh") {
    statuses[idx] = {
      ...current,
      remainingTurns: Math.max(current.remainingTurns, args.incoming.remainingTurns),
      nextTickTurn: args.incoming.nextTickTurn,
      rank: Math.max(current.rank, args.incoming.rank),
      statMods: args.incoming.statMods,
      tickFormula: args.incoming.tickFormula,
      metadata: {
        ...current.metadata,
        ...args.incoming.metadata,
      },
    };
    return { statuses: sortedStatuses(statuses), applied: true, reason: "refreshed" };
  }

  if (args.stacking === "stack") {
    const nextStacks = Math.min(args.maxStacks, Math.max(1, current.stacks + args.incoming.stacks));
    statuses[idx] = {
      ...current,
      stacks: nextStacks,
      remainingTurns: Math.max(current.remainingTurns, args.incoming.remainingTurns),
      nextTickTurn: Math.min(current.nextTickTurn, args.incoming.nextTickTurn),
      rank: Math.max(current.rank, args.incoming.rank),
      metadata: {
        ...current.metadata,
        ...args.incoming.metadata,
      },
    };
    return { statuses: sortedStatuses(statuses), applied: true, reason: "stacked" };
  }

  const nextIntensity = clamp(current.intensity + args.incoming.intensity, 1, args.intensityCap);
  statuses[idx] = {
    ...current,
    intensity: nextIntensity,
    stacks: Math.min(args.maxStacks, current.stacks + 1),
    remainingTurns: Math.max(current.remainingTurns, args.incoming.remainingTurns),
    rank: Math.max(current.rank, args.incoming.rank),
    metadata: {
      ...current.metadata,
      ...args.incoming.metadata,
    },
  };
  return { statuses: sortedStatuses(statuses), applied: true, reason: "intensified" };
}

export function applyStatusEffect(args: {
  target: Pick<Actor, "statuses">;
  definition: StatusEffectDefinition;
  sourceActorId?: string | null;
  sourceSkillId?: string | null;
  nowTurn: number;
  rank?: number;
  tunables?: RuleTunables;
}): StatusApplyResult {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  if (hasStatusImmunity({
    target: args.target,
    incomingStatusId: args.definition.id,
    incomingCategory: args.definition.category,
  })) {
    return { statuses: sortedStatuses(args.target.statuses), applied: false, reason: "immune" };
  }

  const rank = Math.max(1, Math.floor(args.rank ?? 1));
  const incoming: ActiveStatus = {
    id: args.definition.id,
    sourceActorId: args.sourceActorId ?? null,
    sourceSkillId: args.sourceSkillId ?? null,
    category: args.definition.category,
    remainingTurns: Math.max(0, Math.floor(args.definition.durationTurns)),
    nextTickTurn: Math.max(0, Math.floor(args.nowTurn + args.definition.tickRate)),
    stacks: 1,
    intensity: 1,
    rank,
    statMods: args.definition.statMods,
    tickFormula: args.definition.tickFormula,
    dispellable: args.definition.dispellable,
    cleanseTags: args.definition.cleanseTags,
    metadata: {
      ...args.definition.metadata,
      immunitiesGranted: args.definition.immunitiesGranted,
      maxStacks: args.definition.maxStacks,
      intensityCap: args.definition.intensityCap,
      tickRate: args.definition.tickRate,
      statusVersion: tunables.ruleVersion,
    },
  };

  return applyStackingMode({
    statuses: args.target.statuses,
    incoming,
    stacking: args.definition.stacking,
    maxStacks: Math.max(1, Math.floor(args.definition.maxStacks ?? 1)),
    intensityCap: Math.max(1, Math.floor(args.definition.intensityCap ?? tunables.statuses.defaultIntensityCap)),
  });
}

export function tickStatuses(args: {
  source?: Pick<Actor, "statsBase" | "statsDerived"> | null;
  target: Pick<Actor, "statuses" | "resistances" | "statsDerived" | "statsBase">;
  nowTurn: number;
  tunables?: RuleTunables;
}): { statuses: ActiveStatus[]; events: StatusTickEvent[] } {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const source = args.source ?? args.target;
  const events: StatusTickEvent[] = [];
  const nextStatuses: ActiveStatus[] = [];

  for (const status of args.target.statuses) {
    const remaining = Math.max(0, status.remainingTurns - 1);
    const tickRate = Math.max(1, Math.floor(num(status.metadata?.tickRate, 1)));
    const shouldTick = status.category === "dot" || status.category === "hot"
      ? args.nowTurn >= status.nextTickTurn
      : false;

    let amount = 0;
    let kind: StatusTickEvent["kind"] = "none";
    let element: ElementKey = (status.tickFormula?.element ?? "poison") as ElementKey;

    if (shouldTick) {
      const baseTick = num(status.tickFormula?.baseTick, 0);
      const rankTick = num(status.tickFormula?.rankTick, tunables.statuses.defaultRankTick);
      const dotScale = num(status.tickFormula?.dotScale, tunables.statuses.defaultDotScale);
      const hotScale = num(status.tickFormula?.hotScale, tunables.statuses.defaultHotScale);

      if (status.category === "dot") {
        const resist = clamp(num(args.target.resistances[element], args.target.statsDerived.res), -0.9, 0.95);
        const dotRaw = (source.statsDerived.matk * dotScale) + baseTick + (status.rank * rankTick);
        amount = Math.max(0, Math.ceil(dotRaw * (1 - resist) * Math.max(1, status.intensity)));
        kind = amount > 0 ? "damage" : "none";
      }

      if (status.category === "hot") {
        element = "holy";
        const healRaw = (source.statsBase.wis * hotScale) + baseTick;
        amount = Math.max(0, Math.ceil(healRaw * (1 + args.target.statsDerived.healBonus) * Math.max(1, status.intensity)));
        kind = amount > 0 ? "heal" : "none";
      }

      events.push({
        statusId: status.id,
        category: status.category,
        amount,
        kind,
        element,
        remainingTurns: remaining,
        expired: remaining <= 0,
      });
    }

    if (remaining > 0) {
      nextStatuses.push({
        ...status,
        remainingTurns: remaining,
        nextTickTurn: shouldTick ? args.nowTurn + tickRate : status.nextTickTurn,
      });
    } else if (!shouldTick) {
      events.push({
        statusId: status.id,
        category: status.category,
        amount: 0,
        kind: "none",
        element,
        remainingTurns: 0,
        expired: true,
      });
    }
  }

  return {
    statuses: sortedStatuses(nextStatuses),
    events,
  };
}

export function statModsFromStatuses(statuses: ActiveStatus[]): StatModifier {
  const flat: Record<string, number> = {};
  const pct: Record<string, number> = {};

  for (const status of statuses) {
    for (const [key, value] of Object.entries(status.statMods.flat ?? {})) {
      flat[key] = (flat[key] ?? 0) + (num(value, 0) * Math.max(1, status.intensity));
    }
    for (const [key, value] of Object.entries(status.statMods.pct ?? {})) {
      pct[key] = (pct[key] ?? 0) + (num(value, 0) * Math.max(1, status.intensity));
    }
  }

  return { flat, pct };
}

export function cleanseStatuses(args: {
  statuses: ActiveStatus[];
  removeControl?: boolean;
  removeDebuffs?: boolean;
  removeIds?: string[];
  removeTags?: string[];
  keepUndispellable?: boolean;
  tunables?: RuleTunables;
}): ActiveStatus[] {
  const tunables = args.tunables ?? DEFAULT_RULE_TUNABLES;
  const removeIds = new Set((args.removeIds ?? []).map((entry) => entry.toLowerCase()));
  const removeTags = new Set((args.removeTags ?? []).map((entry) => entry.toLowerCase()));

  return sortedStatuses(
    args.statuses.filter((status) => {
      if (args.keepUndispellable && !status.dispellable) return true;
      if (removeIds.has(status.id.toLowerCase())) return false;
      if (args.removeDebuffs && status.category === "debuff") return false;
      if ((args.removeControl || tunables.statuses.cleanseRemovesControl) && status.category === "control") return false;
      if (removeTags.size > 0) {
        const tags = (status.cleanseTags ?? []).map((tag) => tag.toLowerCase());
        if (tags.some((tag) => removeTags.has(tag))) return false;
      }
      return true;
    }),
  );
}
