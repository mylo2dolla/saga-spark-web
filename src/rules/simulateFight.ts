import { DEFAULT_RULE_TUNABLES, type RuleTunables } from "@/rules/constants";
import { computeDamageRoll, type DamageKind } from "@/rules/combatMath";
import { computeSkillPower } from "@/rules/skills";
import { applyStatusEffect, tickStatuses } from "@/rules/status";
import type { Actor, CombatLogEntry, Skill } from "@/rules/schema";

export interface SimBuild {
  actor: Actor;
  skill: Skill;
  damageKind: DamageKind;
}

export interface FightSimulationResult {
  winner: "A" | "B" | "draw";
  turns: number;
  hpA: number;
  hpB: number;
  totalDamageByA: number;
  totalDamageByB: number;
  log: CombatLogEntry[];
}

function cloneActor(actor: Actor): Actor {
  return {
    ...actor,
    statsBase: { ...actor.statsBase },
    statsGrowth: { ...actor.statsGrowth },
    statsDerived: { ...actor.statsDerived },
    resistances: { ...actor.resistances },
    statuses: actor.statuses.map((status) => ({
      ...status,
      statMods: {
        flat: { ...status.statMods.flat },
        pct: { ...status.statMods.pct },
      },
      metadata: { ...status.metadata },
    })),
    equipment: {
      weapon: actor.equipment.weapon,
      offhand: actor.equipment.offhand,
      head: actor.equipment.head,
      chest: actor.equipment.chest,
      legs: actor.equipment.legs,
      accessory1: actor.equipment.accessory1,
      accessory2: actor.equipment.accessory2,
    },
    skillbook: [...actor.skillbook],
  };
}

function orderForTurn(a: Actor, b: Actor): Array<{ side: "A" | "B"; actor: Actor }> {
  if (a.statsDerived.speed > b.statsDerived.speed) {
    return [
      { side: "A", actor: a },
      { side: "B", actor: b },
    ];
  }
  if (b.statsDerived.speed > a.statsDerived.speed) {
    return [
      { side: "B", actor: b },
      { side: "A", actor: a },
    ];
  }
  return [
    { side: "A", actor: a },
    { side: "B", actor: b },
  ];
}

export function simulateFight(
  seed: number,
  buildA: SimBuild,
  buildB: SimBuild,
  options?: {
    maxTurns?: number;
    tunables?: RuleTunables;
  },
): FightSimulationResult {
  const tunables = options?.tunables ?? DEFAULT_RULE_TUNABLES;
  const maxTurns = Math.max(1, Math.floor(options?.maxTurns ?? 40));

  const actorA = cloneActor(buildA.actor);
  const actorB = cloneActor(buildB.actor);

  let hpA = Math.max(1, Math.floor(actorA.statsDerived.hp));
  let hpB = Math.max(1, Math.floor(actorB.statsDerived.hp));

  let totalDamageByA = 0;
  let totalDamageByB = 0;
  const log: CombatLogEntry[] = [];

  let turn = 1;
  while (turn <= maxTurns && hpA > 0 && hpB > 0) {
    const order = orderForTurn(actorA, actorB);

    // Start-of-turn status ticks.
    const tickA = tickStatuses({ target: actorA, nowTurn: turn, tunables });
    actorA.statuses = tickA.statuses;
    for (const tick of tickA.events) {
      if (tick.kind === "damage") {
        hpA = Math.max(0, hpA - tick.amount);
      }
      if (tick.kind === "heal") {
        hpA = Math.min(actorA.statsDerived.hp, hpA + tick.amount);
      }
      log.push({
        turn,
        actorId: actorA.id,
        targetId: actorA.id,
        type: "status_tick",
        amount: tick.amount,
        label: `${tick.statusId} ${tick.kind}`,
        statusId: tick.statusId,
      });
    }

    const tickB = tickStatuses({ target: actorB, nowTurn: turn, tunables });
    actorB.statuses = tickB.statuses;
    for (const tick of tickB.events) {
      if (tick.kind === "damage") {
        hpB = Math.max(0, hpB - tick.amount);
      }
      if (tick.kind === "heal") {
        hpB = Math.min(actorB.statsDerived.hp, hpB + tick.amount);
      }
      log.push({
        turn,
        actorId: actorB.id,
        targetId: actorB.id,
        type: "status_tick",
        amount: tick.amount,
        label: `${tick.statusId} ${tick.kind}`,
        statusId: tick.statusId,
      });
    }

    if (hpA <= 0 || hpB <= 0) break;

    for (const step of order) {
      if (hpA <= 0 || hpB <= 0) break;
      const isA = step.side === "A";
      const attacker = isA ? actorA : actorB;
      const defender = isA ? actorB : actorA;
      const attackerBuild = isA ? buildA : buildB;
      const skill = attackerBuild.skill;

      const skillPower = computeSkillPower({
        skill,
        actor: attacker,
        actorLevel: attacker.level,
        tunables,
      });

      const combatAttacker = {
        id: attacker.id,
        level: attacker.level,
        statsBase: attacker.statsBase,
        statsDerived: attacker.statsDerived,
        resistances: attacker.resistances,
        barrier: attacker.barrier,
      };
      const combatDefender = {
        id: defender.id,
        level: defender.level,
        statsBase: defender.statsBase,
        statsDerived: defender.statsDerived,
        resistances: defender.resistances,
        barrier: defender.barrier,
      };

      const roll = computeDamageRoll({
        seed,
        label: `sim:${turn}:${attacker.id}:${defender.id}:${skill.id}`,
        attacker: combatAttacker,
        target: combatDefender,
        skill,
        skillPower,
        damageKind: attackerBuild.damageKind,
        tunables,
      });

      if (!roll.didHit) {
        log.push({
          turn,
          actorId: attacker.id,
          targetId: defender.id,
          type: "miss",
          amount: 0,
          label: `${skill.name} missed`,
        });
        continue;
      }

      if (roll.damageToBarrier > 0) {
        defender.barrier = Math.max(0, roll.targetBarrierAfter);
      }

      if (isA) {
        hpB = Math.max(0, hpB - roll.damageToHp);
        totalDamageByA += roll.damageToHp;
      } else {
        hpA = Math.max(0, hpA - roll.damageToHp);
        totalDamageByB += roll.damageToHp;
      }

      log.push({
        turn,
        actorId: attacker.id,
        targetId: defender.id,
        type: roll.didCrit ? "crit" : "damage",
        amount: roll.damageToHp,
        label: `${skill.name} ${roll.didCrit ? "crit" : "hit"}`,
      });

      if (skill.statusApply && roll.damageToHp > 0) {
        const applied = applyStatusEffect({
          target: defender,
          definition: skill.statusApply,
          sourceActorId: attacker.id,
          sourceSkillId: skill.id,
          nowTurn: turn,
          rank: skill.rank,
          tunables,
        });
        defender.statuses = applied.statuses;
        if (applied.applied) {
          log.push({
            turn,
            actorId: attacker.id,
            targetId: defender.id,
            type: "status_apply",
            amount: 0,
            label: `${skill.statusApply.id} ${applied.reason}`,
            statusId: skill.statusApply.id,
          });
        }
      }
    }

    turn += 1;
  }

  const turns = Math.max(1, turn - 1);
  const winner = hpA === hpB ? "draw" : hpA > hpB ? "A" : "B";

  return {
    winner,
    turns,
    hpA,
    hpB,
    totalDamageByA,
    totalDamageByB,
    log,
  };
}
