import { expect, test } from "@playwright/test";

import {
  applyStatusEffect,
  buildTunables,
  computeHitChance,
  expectedDamage,
  generateLootBatch,
  generateLootItem,
  rollRarity,
  tickStatuses,
  type Actor,
  type Skill,
} from "@/rules";
import { buildSampleSimBuild, simulateFight } from "./simulateFight";

function totalStatMagnitude(stats: Record<string, number>): number {
  return Object.values(stats).reduce((sum, value) => sum + Math.abs(Number(value ?? 0)), 0);
}

function defaultSkillFor(actor: Actor): Skill {
  return {
    id: `${actor.id}-strike`,
    name: "Strike",
    element: "physical",
    tags: ["melee"],
    targeting: "single",
    rank: 1,
    maxRank: 5,
    mpCostBase: 4,
    mpCostScale: 0.6,
    mpLevelScale: 0.08,
    basePower: 24,
    powerScale: 4,
    levelScale: 0.45,
    hitBonus: 6,
    critBonus: 0.04,
    formulaOverrideId: null,
    description: "Basic strike",
  };
}

test.describe("simulation balance", () => {
  test("hitChance is always clamped between 5% and 95%", () => {
    const tunables = buildTunables();
    for (let acc = 20; acc <= 180; acc += 8) {
      for (let eva = 5; eva <= 160; eva += 7) {
        const chance = computeHitChance({
          attackerAcc: acc,
          targetEva: eva,
          skillHitBonus: 0,
          tunables,
        });
        expect(chance).toBeGreaterThanOrEqual(0.05);
        expect(chance).toBeLessThanOrEqual(0.95);
      }
    }
  });

  test("equal-level TTK averages within 4..8 turns", () => {
    const buildA = buildSampleSimBuild({
      id: "a",
      name: "Knight A",
      level: 12,
      offense: 22,
      defense: 20,
      control: 18,
      support: 16,
      mobility: 18,
      utility: 14,
      skillName: "Measured Slash",
      skillPower: 18,
    });
    const buildB = buildSampleSimBuild({
      id: "b",
      name: "Knight B",
      level: 12,
      offense: 21,
      defense: 21,
      control: 17,
      support: 16,
      mobility: 17,
      utility: 14,
      skillName: "Measured Slash",
      skillPower: 18,
    });

    const turns: number[] = [];
    for (let seed = 1; seed <= 80; seed += 1) {
      const sim = simulateFight(seed, buildA, buildB);
      turns.push(sim.turns);
    }

    const avgTtk = turns.reduce((sum, value) => sum + value, 0) / turns.length;
    expect(avgTtk).toBeGreaterThanOrEqual(4);
    expect(avgTtk).toBeLessThanOrEqual(8);
  });

  test("low-rank DOT does not outscale direct damage", () => {
    const tunables = buildTunables();
    const attacker = buildSampleSimBuild({
      id: "dot-src",
      name: "Hexling",
      level: 10,
      offense: 18,
      defense: 14,
      control: 21,
      support: 16,
      mobility: 15,
      utility: 14,
      skillName: "Tap",
      skillPower: 15,
    }).actor;

    const target = buildSampleSimBuild({
      id: "dot-tgt",
      name: "Bandit",
      level: 10,
      offense: 17,
      defense: 18,
      control: 14,
      support: 14,
      mobility: 14,
      utility: 12,
      skillName: "Tap",
      skillPower: 15,
    }).actor;

    const direct = expectedDamage({
      attacker,
      target,
      skill: defaultSkillFor(attacker),
      skillPower: 20,
      damageKind: "magical",
      tunables,
    });

    const statusDef = {
      id: "burning_wisp",
      name: "Burning Wisp",
      category: "dot" as const,
      durationTurns: 3,
      tickRate: 1,
      stacking: "refresh" as const,
      maxStacks: 1,
      intensityCap: 1,
      tickFormula: {
        element: "fire" as const,
        baseTick: 3,
        dotScale: 0.18,
        hotScale: 0,
        rankTick: 1,
        usesHealBonus: true,
      },
      statMods: { flat: {}, pct: {} },
      immunitiesGranted: [],
      dispellable: true,
      cleanseTags: [],
      metadata: {},
    };

    const applied = applyStatusEffect({
      target,
      definition: statusDef,
      sourceActorId: attacker.id,
      sourceSkillId: "burn",
      nowTurn: 1,
      rank: 1,
      tunables,
    });

    const targetAfter = { ...target, statuses: applied.statuses };
    const tick = tickStatuses({
      source: attacker,
      target: targetAfter,
      nowTurn: 2,
      tunables,
    });

    const dotDamage = tick.events
      .filter((entry) => entry.kind === "damage")
      .reduce((sum, entry) => sum + entry.amount, 0);

    expect(dotDamage).toBeGreaterThan(0);
    expect(dotDamage).toBeLessThan(direct);
  });

  test("healing scales but does not trivialize incoming damage", () => {
    const tunables = buildTunables();
    const healer = buildSampleSimBuild({
      id: "heal-src",
      name: "Medic",
      level: 14,
      offense: 16,
      defense: 18,
      control: 16,
      support: 24,
      mobility: 14,
      utility: 18,
      skillName: "Pulse",
      skillPower: 12,
    }).actor;
    const attacker = buildSampleSimBuild({
      id: "heal-dmg",
      name: "Raider",
      level: 14,
      offense: 24,
      defense: 16,
      control: 14,
      support: 14,
      mobility: 16,
      utility: 12,
      skillName: "Cleave",
      skillPower: 22,
    }).actor;

    const incoming = expectedDamage({
      attacker,
      target: healer,
      skill: defaultSkillFor(attacker),
      skillPower: 24,
      damageKind: "physical",
      tunables,
    });

    const hotDef = {
      id: "warm_bloom",
      name: "Warm Bloom",
      category: "hot" as const,
      durationTurns: 2,
      tickRate: 1,
      stacking: "refresh" as const,
      maxStacks: 1,
      intensityCap: 1,
      tickFormula: {
        element: "holy" as const,
        baseTick: 6,
        dotScale: 0,
        hotScale: 0.28,
        rankTick: 0,
        usesHealBonus: true,
      },
      statMods: { flat: {}, pct: {} },
      immunitiesGranted: [],
      dispellable: true,
      cleanseTags: [],
      metadata: {},
    };

    const applied = applyStatusEffect({
      target: healer,
      definition: hotDef,
      sourceActorId: healer.id,
      sourceSkillId: "warm_bloom",
      nowTurn: 1,
      rank: 1,
      tunables,
    });

    const healerAfter = { ...healer, statuses: applied.statuses };
    const tick = tickStatuses({
      source: healer,
      target: healerAfter,
      nowTurn: 2,
      tunables,
    });

    const healing = tick.events
      .filter((entry) => entry.kind === "heal")
      .reduce((sum, entry) => sum + entry.amount, 0);

    expect(healing).toBeGreaterThan(incoming * 0.2);
    expect(healing).toBeLessThan(incoming * 0.95);
  });

  test("loot rarity distribution tracks configured weights", () => {
    const tunables = buildTunables();
    const samples: Array<{ rarity: string }> = [];

    for (let seed = 10; seed < 2010; seed += 1) {
      const batch = generateLootBatch({
        seed,
        actorLevel: 18,
        count: 3,
        tunables,
      });
      for (const item of batch.items) {
        samples.push({ rarity: item.rarity });
      }
    }

    const counts = new Map<string, number>();
    for (const sample of samples) {
      counts.set(sample.rarity, (counts.get(sample.rarity) ?? 0) + 1);
    }

    const total = samples.length;
    const totalWeight = Object.values(tunables.loot.rarityWeights).reduce((sum, value) => sum + value, 0);

    const observed = {
      common: (counts.get("common") ?? 0) / total,
      uncommon: (counts.get("uncommon") ?? 0) / total,
      rare: (counts.get("rare") ?? 0) / total,
      epic: (counts.get("epic") ?? 0) / total,
    };

    const expected = {
      common: tunables.loot.rarityWeights.common / totalWeight,
      uncommon: tunables.loot.rarityWeights.uncommon / totalWeight,
      rare: tunables.loot.rarityWeights.rare / totalWeight,
      epic: tunables.loot.rarityWeights.epic / totalWeight,
    };

    expect(Math.abs(observed.common - expected.common)).toBeLessThan(0.06);
    expect(Math.abs(observed.uncommon - expected.uncommon)).toBeLessThan(0.05);
    expect(Math.abs(observed.rare - expected.rare)).toBeLessThan(0.04);
    expect(Math.abs(observed.epic - expected.epic)).toBeLessThan(0.03);

    // Tail rarities should still appear in a larger sample.
    expect((counts.get("legendary") ?? 0)).toBeGreaterThan(0);
    expect((counts.get("mythic") ?? 0)).toBeGreaterThan(0);
  });

  test("item stat budgets scale up with level", () => {
    const tunables = buildTunables();
    let lowTotal = 0;
    let highTotal = 0;
    const runs = 200;

    for (let seed = 1; seed <= runs; seed += 1) {
      const rarity = rollRarity(seed, `rarity:${seed}`, tunables);
      const low = generateLootItem({
        seed,
        label: `low:${seed}`,
        level: 5,
        rarity,
        slot: "weapon",
        tunables,
      });
      const high = generateLootItem({
        seed,
        label: `high:${seed}`,
        level: 40,
        rarity,
        slot: "weapon",
        tunables,
      });
      lowTotal += totalStatMagnitude(low.statsFlat);
      highTotal += totalStatMagnitude(high.statsFlat);
    }

    const lowAvg = lowTotal / runs;
    const highAvg = highTotal / runs;

    expect(highAvg).toBeGreaterThan(lowAvg * 2);
  });
});
