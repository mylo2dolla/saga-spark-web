import { rngInt } from "../../shared/mythic_rng.js";

type StatusEntry = {
  id: string;
};

type CombatantHitProfile = {
  offense: number;
  defense: number;
  mobility: number;
  utility: number;
  statuses: unknown;
};

export type HitResolutionInput = {
  seed: number;
  label: string;
  attacker: CombatantHitProfile;
  defender: CombatantHitProfile;
};

export type HitResolutionResult = {
  hit: boolean;
  rollD20: number;
  requiredRoll: number;
  hitChance: number;
  reason: "natural_1" | "natural_20" | "hit" | "evaded";
  offenseScore: number;
  defenseScore: number;
};

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function asStatuses(raw: unknown): StatusEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry) ? entry as Record<string, unknown> : null))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => ({ id: String(entry.id ?? "").trim().toLowerCase() }))
    .filter((entry) => entry.id.length > 0);
}

function sumStatusBonus(statuses: StatusEntry[], bonuses: Record<string, number>): number {
  let total = 0;
  for (const status of statuses) {
    total += bonuses[status.id] ?? 0;
  }
  return total;
}

function offenseScore(profile: CombatantHitProfile, statusBonus: number): number {
  return (profile.offense * 0.62) + (profile.mobility * 0.24) + (profile.utility * 0.14) + statusBonus;
}

function defenseScore(profile: CombatantHitProfile, statusBonus: number): number {
  return (profile.defense * 0.52) + (profile.mobility * 0.33) + (profile.utility * 0.15) + statusBonus;
}

export function resolveDeterministicHit(args: HitResolutionInput): HitResolutionResult {
  const attackerStatuses = asStatuses(args.attacker.statuses);
  const defenderStatuses = asStatuses(args.defender.statuses);

  const attackerAimBonus = sumStatusBonus(attackerStatuses, {
    precision: 10,
    focused: 8,
    battle_focus: 6,
    blind: -14,
    disoriented: -8,
  });
  const defenderEvadeBonus = sumStatusBonus(defenderStatuses, {
    guard: 12,
    barrier: 4,
    evasive: 14,
    haste: 4,
    vulnerable: -12,
    marked: -6,
    exposed: -8,
    stunned: -15,
    rooted: -10,
  });

  const atkScore = offenseScore(args.attacker, attackerAimBonus);
  const defScore = defenseScore(args.defender, defenderEvadeBonus);
  const rawChance = 0.58 + ((atkScore - defScore) / 140);
  const clampedChance = clampNumber(rawChance, 0.20, 0.92);
  const requiredRoll = clampInt(21 - Math.round(clampedChance * 20), 2, 19);
  const rollD20 = rngInt(args.seed, `${args.label}:d20_hit`, 1, 20);
  const chanceFromRequired = clampNumber((21 - requiredRoll) / 20, 0.05, 0.95);

  if (rollD20 === 1) {
    return {
      hit: false,
      rollD20,
      requiredRoll,
      hitChance: chanceFromRequired,
      reason: "natural_1",
      offenseScore: atkScore,
      defenseScore: defScore,
    };
  }

  if (rollD20 === 20) {
    return {
      hit: true,
      rollD20,
      requiredRoll,
      hitChance: chanceFromRequired,
      reason: "natural_20",
      offenseScore: atkScore,
      defenseScore: defScore,
    };
  }

  const hit = rollD20 >= requiredRoll;
  return {
    hit,
    rollD20,
    requiredRoll,
    hitChance: chanceFromRequired,
    reason: hit ? "hit" : "evaded",
    offenseScore: atkScore,
    defenseScore: defScore,
  };
}
