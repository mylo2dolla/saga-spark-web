import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  buildCampaignContext,
  buildDmContextPayload,
  buildPromptWorldContextBlock,
  buildRuntimeWorldBindings,
  buildWorldSeedPayload,
} from "./index.js";

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

const SNAPSHOTS = {
  seedRich: "636d20bc2afb19cc94418642ff5329be9cf79832b5c25381e3263d3326d55c0f",
  runtime: "e9a4a2e1289828acc8031cfa4312f79c3ff2143066a672a23f3e9d0877b6cf58",
  dm: "154e26c080d1b8d5b0dedb1ad3e61e82f257d98fca098c48f2cafce3c58d2bdd",
  prompt2000: "ebc8baae9d1e58bde52d29489b828f17bf69457ece41406c44727be20d2a82fd",
  prompt950: "2b214b8a806525637cd120d8b505f9b1d4618168f7e8f79a28a177aea7920135",
} as const;

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

test("worldforge endpoint contract envelopes are deterministic for identical input", () => {
  const first = buildCampaignContext(BASE_INPUT);
  const second = buildCampaignContext(BASE_INPUT);

  const firstSeed = buildWorldSeedPayload(first, { includeThemeTags: true, includeToneVector: true });
  const secondSeed = buildWorldSeedPayload(second, { includeThemeTags: true, includeToneVector: true });
  assert.deepEqual(firstSeed, secondSeed);

  const firstRuntime = buildRuntimeWorldBindings(first, {
    includeCampaignContext: false,
    includeBiomeAtmosphere: true,
    directiveLimit: 6,
    coreConflictLimit: 4,
    factionTensionLimit: 5,
  });
  const secondRuntime = buildRuntimeWorldBindings(second, {
    includeCampaignContext: false,
    includeBiomeAtmosphere: true,
    directiveLimit: 6,
    coreConflictLimit: 4,
    factionTensionLimit: 5,
  });
  assert.deepEqual(firstRuntime, secondRuntime);
});

test("worldforge contract snapshots stay stable", () => {
  const campaign = buildCampaignContext(BASE_INPUT);

  const seedPayload = buildWorldSeedPayload(campaign, {
    includeThemeTags: true,
    includeToneVector: true,
  });
  const runtimePayload = buildRuntimeWorldBindings(campaign, {
    includeCampaignContext: false,
    includeBiomeAtmosphere: true,
    directiveLimit: 6,
    coreConflictLimit: 4,
    factionTensionLimit: 5,
  });
  const dmPayload = buildDmContextPayload(campaign, {
    includeProfile: true,
    narrativeLimit: 8,
    tacticalLimit: 8,
  });

  const promptWorld2000 = buildPromptWorldContextBlock({
    worldForgeVersion: campaign.worldForgeVersion,
    worldSeed: buildWorldSeedPayload(campaign, {
      includeTitleDescription: true,
      includeThemeTags: true,
      includeToneVector: true,
    }),
    worldContext: runtimePayload.world_context as Record<string, unknown>,
    dmContext: dmPayload,
    worldState: runtimePayload.world_state as Record<string, unknown>,
    campaignContext: campaign as unknown as Record<string, unknown>,
    maxChars: 2_000,
  });
  const promptWorld950 = buildPromptWorldContextBlock({
    worldForgeVersion: campaign.worldForgeVersion,
    worldSeed: buildWorldSeedPayload(campaign, {
      includeTitleDescription: true,
      includeThemeTags: true,
      includeToneVector: true,
    }),
    worldContext: runtimePayload.world_context as Record<string, unknown>,
    dmContext: dmPayload,
    worldState: runtimePayload.world_state as Record<string, unknown>,
    campaignContext: campaign as unknown as Record<string, unknown>,
    maxChars: 950,
  });

  assert.equal(stableHash(seedPayload), SNAPSHOTS.seedRich);
  assert.equal(stableHash(runtimePayload), SNAPSHOTS.runtime);
  assert.equal(stableHash(dmPayload), SNAPSHOTS.dm);
  assert.equal(stableHash(promptWorld2000.payload), SNAPSHOTS.prompt2000);
  assert.equal(stableHash(promptWorld950.payload), SNAPSHOTS.prompt950);

  assert.equal(promptWorld2000.meta.trimmed, true);
  assert.equal(promptWorld2000.meta.maxChars, 2_000);
  assert.ok(promptWorld2000.meta.finalChars <= promptWorld2000.meta.maxChars);
  assert.deepEqual(promptWorld2000.meta.droppedSections, ["campaign_context", "world_state"]);

  assert.equal(promptWorld950.meta.trimmed, true);
  assert.equal(promptWorld950.meta.maxChars, 950);
  assert.ok(promptWorld950.meta.finalChars <= promptWorld950.meta.maxChars);
  assert.deepEqual(promptWorld950.meta.droppedSections, ["campaign_context", "world_state", "world_context", "dm_context"]);
});

test("single forge-field shift changes endpoint envelope snapshot hash", () => {
  const baseContext = buildCampaignContext(BASE_INPUT);
  const changedContext = buildCampaignContext({
    ...BASE_INPUT,
    title: "Honey Circuit Uprising",
  });

  const baseHash = stableHash(buildRuntimeWorldBindings(baseContext, {
    includeCampaignContext: false,
    includeBiomeAtmosphere: true,
    directiveLimit: 6,
    coreConflictLimit: 4,
    factionTensionLimit: 5,
  }));
  const changedHash = stableHash(buildRuntimeWorldBindings(changedContext, {
    includeCampaignContext: false,
    includeBiomeAtmosphere: true,
    directiveLimit: 6,
    coreConflictLimit: 4,
    factionTensionLimit: 5,
  }));

  assert.notEqual(baseHash, changedHash);
});
