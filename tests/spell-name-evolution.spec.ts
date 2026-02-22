import { expect, test } from "@playwright/test";
import { buildSpellName } from "../services/mythic-api/src/lib/presentation/spellNameBuilder";

test.describe("mythic spell name evolution", () => {
  test("is deterministic for identical inputs", () => {
    const a = buildSpellName("Fireball", 4, "unique", 3, "spell-seed-alpha");
    const b = buildSpellName("Fireball", 4, "unique", 3, "spell-seed-alpha");
    expect(a).toBe(b);
  });

  test("escalates naming tiers by rank/rarity/escalation", () => {
    const low = buildSpellName("Fireball", 1, "common", 0, "spell-seed-bravo");
    const mid = buildSpellName("Fireball", 3, "unique", 2, "spell-seed-bravo");
    const high = buildSpellName("Fireball", 7, "mythic", 7, "spell-seed-bravo");

    expect(low).toMatch(/fireball/i);
    expect(mid).not.toBe(low);
    expect(high).not.toBe(mid);
    expect(high.split(/\s+/).length).toBeGreaterThanOrEqual(mid.split(/\s+/).length);
  });
});
