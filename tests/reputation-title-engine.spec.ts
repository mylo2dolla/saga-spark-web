import { expect, test } from "@playwright/test";
import { buildReputationTitle } from "../services/mythic-api/src/lib/presentation/reputationTitleEngine";

test.describe("mythic reputation title engine", () => {
  test("keeps base name at low reputation and overwrites at tier 3+", () => {
    const tier1 = buildReputationTitle({
      baseName: "Kael",
      reputationScore: 20,
      behaviorFlags: [],
      notableKills: [],
      factionStanding: {},
      seedKey: "rep-seed-alpha",
    });
    expect(tier1.tier).toBe(1);
    expect(tier1.displayName).toBe("Kael");

    const tier3 = buildReputationTitle({
      baseName: "Kael",
      reputationScore: 140,
      behaviorFlags: [],
      notableKills: [],
      factionStanding: {},
      seedKey: "rep-seed-alpha",
    });
    expect(tier3.tier).toBeGreaterThanOrEqual(3);
    expect(tier3.displayName).not.toBe("Kael");
  });

  test("applies deterministic behavior-trigger overrides", () => {
    const first = buildReputationTitle({
      baseName: "Kael",
      reputationScore: 80,
      behaviorFlags: ["sparkle_50"],
      notableKills: [],
      factionStanding: {},
      seedKey: "rep-seed-behavior",
    });
    const second = buildReputationTitle({
      baseName: "Kael",
      reputationScore: 80,
      behaviorFlags: ["sparkle_50"],
      notableKills: [],
      factionStanding: {},
      seedKey: "rep-seed-behavior",
    });
    expect(first.displayName.toLowerCase()).toContain("glitterstorm");
    expect(first.displayName).toBe(second.displayName);
  });
});
