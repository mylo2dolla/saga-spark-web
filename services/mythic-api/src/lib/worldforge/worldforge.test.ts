import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCampaignContext,
  buildWorldSeed,
  forgeCharacterFromWorld,
  updateWorldState,
} from "./generator.js";

const BASE_INPUT = {
  title: "Ashline Covenant",
  description: "Warring houses and relic hunters contest a dying frontier city.",
  tonePreset: "dark" as const,
  randomizationMode: "controlled" as const,
  lethality: "high" as const,
  magicDensity: "high" as const,
  techLevel: "medieval" as const,
  factionComplexity: "high" as const,
  worldSize: "medium" as const,
};

function toneDistance(a: Record<string, number>, b: Record<string, number>): number {
  const keys = Object.keys(a);
  let sum = 0;
  for (const key of keys) {
    const delta = (a[key] ?? 0) - (b[key] ?? 0);
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

test("buildCampaignContext is deterministic for identical forge input", () => {
  const first = buildCampaignContext(BASE_INPUT);
  const second = buildCampaignContext(BASE_INPUT);

  assert.equal(first.worldSeed.seedString, second.worldSeed.seedString);
  assert.equal(first.worldSeed.seedNumber, second.worldSeed.seedNumber);
  assert.deepEqual(first.worldSeed.toneVector, second.worldSeed.toneVector);
  assert.deepEqual(first.worldContext.worldBible, second.worldContext.worldBible);
  assert.deepEqual(first.worldContext.biomeMap, second.worldContext.biomeMap);
  assert.deepEqual(first.dmContext.dmBehaviorProfile, second.dmContext.dmBehaviorProfile);
});

test("different campaign titles produce divergent world identities", () => {
  const first = buildCampaignContext({
    ...BASE_INPUT,
    title: "Ashline Covenant",
  });
  const second = buildCampaignContext({
    ...BASE_INPUT,
    title: "Honey Circuit Uprising",
  });

  assert.notEqual(first.worldSeed.seedString, second.worldSeed.seedString);
  assert.notEqual(first.worldSeed.seedNumber, second.worldSeed.seedNumber);
  assert.notEqual(first.worldContext.worldBible.worldName, second.worldContext.worldBible.worldName);
  assert.notDeepEqual(first.worldContext.factionGraph.factions, second.worldContext.factionGraph.factions);
});

test("changing one forge field shifts tone vector measurably", () => {
  const lowHumor = buildWorldSeed({
    ...BASE_INPUT,
    humorLevel: 0,
  });
  const highHumor = buildWorldSeed({
    ...BASE_INPUT,
    humorLevel: 5,
  });

  const distance = toneDistance(
    lowHumor.toneVector as unknown as Record<string, number>,
    highHumor.toneVector as unknown as Record<string, number>,
  );

  assert.ok(distance >= 0.12, `expected tone vector distance >= 0.12, got ${distance.toFixed(4)}`);
});

test("updateWorldState advances tick/history and applies action impacts", () => {
  const campaign = buildCampaignContext(BASE_INPUT);
  const before = campaign.worldContext.worldState;
  const targetFactionId = campaign.worldContext.factionGraph.factions[0]?.id;

  assert.ok(targetFactionId, "expected at least one faction in generated graph");

  const next = updateWorldState(before, {
    actionType: "raid_stronghold",
    summary: "The player struck a fortified faction depot and torched supplies.",
    targetFactionId,
    chaosImpact: 0.7,
    brutalityImpact: 0.8,
    generosityImpact: -0.2,
    moralImpact: -0.4,
    tags: ["dungeon", "raid"],
  });

  assert.equal(next.tick, before.tick + 1);
  assert.equal(next.history.at(-1)?.type, "raid_stronghold");
  assert.equal(next.history.at(-1)?.tick, next.tick);
  assert.ok(next.activeRumors.length >= before.activeRumors.length);

  const targetBefore = before.factionStates.find((state) => state.factionId === targetFactionId);
  const targetAfter = next.factionStates.find((state) => state.factionId === targetFactionId);
  assert.ok(targetBefore, "expected target faction state before update");
  assert.ok(targetAfter, "expected target faction state after update");
  assert.equal(targetAfter?.lastActionTick, next.tick);
  assert.notEqual(targetAfter?.trustDelta, targetBefore?.trustDelta);
});

test("forgeCharacterFromWorld is deterministic for same context and input", () => {
  const campaign = buildCampaignContext({
    ...BASE_INPUT,
    tonePreset: "heroic",
    title: "Starward Compact",
  });

  const input = {
    characterName: "Nyx",
    background: "guild dropout",
    moralLeaning: 0.2,
  };

  const first = forgeCharacterFromWorld({ campaignContext: campaign, input });
  const second = forgeCharacterFromWorld({ campaignContext: campaign, input });

  assert.deepEqual(first, second);
  assert.equal(first.background, "guild dropout");
  assert.ok(first.startingRumors.length >= 1);
  assert.ok(Object.keys(first.startingNpcRelationships).length >= 1);
});
