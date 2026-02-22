import { expect, test } from "@playwright/test";
import { buildNarrativeLinesFromEvents } from "../services/mythic-api/src/lib/presentation/narrativeMiddleware";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic dm presentation overhaul", () => {
  test("dedupes duplicate events and compresses grouped combat output", () => {
    const first = buildNarrativeLinesFromEvents({
      seedKey: "presentation-seed-alpha",
      tone: "tactical",
      events: [
        {
          id: "e1",
          turn_index: 12,
          event_type: "damage",
          payload: {
            source_combatant_id: "enemy-1",
            source_name: "Nightcoil",
            target_combatant_id: "player-1",
            target_name: "Kael",
            damage_to_hp: 34,
            actor_alive: true,
          },
          created_at: "2026-02-22T10:00:01.000Z",
        },
        {
          id: "e2",
          turn_index: 12,
          event_type: "damage",
          payload: {
            source_combatant_id: "enemy-1",
            source_name: "Nightcoil",
            target_combatant_id: "player-1",
            target_name: "Kael",
            damage_to_hp: 34,
            actor_alive: true,
          },
          created_at: "2026-02-22T10:00:02.000Z",
        },
        {
          id: "e3",
          turn_index: 12,
          event_type: "status_applied",
          payload: {
            source_combatant_id: "enemy-1",
            source_name: "Nightcoil",
            target_combatant_id: "enemy-1",
            target_name: "Nightcoil",
            status: { id: "barrier" },
            actor_alive: true,
          },
          created_at: "2026-02-22T10:00:03.000Z",
        },
        {
          id: "e4",
          turn_index: 12,
          event_type: "status_applied",
          payload: {
            source_combatant_id: "enemy-1",
            source_name: "Nightcoil",
            target_combatant_id: "enemy-1",
            target_name: "Nightcoil",
            status: { id: "guard" },
            actor_alive: true,
          },
          created_at: "2026-02-22T10:00:04.000Z",
        },
      ],
      recentLineHashes: [],
      recentVerbKeys: [],
    });

    const combined = first.lines.join(" ").toLowerCase();
    expect(first.lines.length).toBeGreaterThan(0);
    expect(combined).toContain("nightcoil");
    expect(combined).toContain("2 times");
    expect(combined).toContain("barrier");
    expect(combined).toContain("guard");

    const second = buildNarrativeLinesFromEvents({
      seedKey: "presentation-seed-alpha",
      tone: "tactical",
      events: [
        {
          id: "e1",
          turn_index: 12,
          event_type: "damage",
          payload: {
            source_combatant_id: "enemy-1",
            source_name: "Nightcoil",
            target_combatant_id: "player-1",
            target_name: "Kael",
            damage_to_hp: 34,
            actor_alive: true,
          },
          created_at: "2026-02-22T10:00:01.000Z",
        },
      ],
      recentLineHashes: first.lineHashes,
      recentVerbKeys: first.verbKeys,
    });

    expect(second.lines.length).toBeGreaterThan(0);
    expect(second.lines.join(" ").toLowerCase()).not.toContain("nightcoil");
  });

  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable player-facing narration smoke.");

  test("player-facing narration excludes banned system phrases", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const text = ((await page.locator("body").innerText()) || "").toLowerCase();
    const banned = [
      "command:unknown",
      "opening move",
      "hard state",
      "committed pressure lines",
      "campaign_intro_opening_",
      "resolved 3 non-player turn steps",
    ];
    for (const phrase of banned) {
      expect(text).not.toContain(phrase);
    }
  });
});
