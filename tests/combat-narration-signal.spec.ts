import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic combat narration signal", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable narration signal smoke.");

  test("player-facing narration avoids internal/mechanical leakage", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const bodyText = ((await page.locator("body").innerText()) || "").toLowerCase();
    expect(bodyText).not.toContain("campaign_intro_opening_v");
    expect(bodyText).not.toContain("command:unknown");
    expect(bodyText).not.toContain("opening move");
    expect(bodyText).not.toContain("hard state");
    expect(bodyText).not.toContain("committed pressure lines");
    expect(bodyText).not.toMatch(/resolved\s+\d+\s+non-player turn steps/i);
    expect(bodyText).not.toMatch(/a combatant\s+(hits|tags|shifts)/i);
    expect(bodyText).not.toMatch(/tags the line/i);
  });

  test("dead actor names are not narrated as acting later in the same transcript", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const fullText = (await page.locator("body").innerText()) || "";
    const deathRegex = /^([A-Za-z0-9' -]{2,}) drops and is out\./gim;
    const deathMatches: Array<{ name: string; index: number }> = [];
    for (const match of fullText.matchAll(deathRegex)) {
      const name = (match[1] ?? "").trim();
      if (!name) continue;
      deathMatches.push({ name, index: match.index ?? 0 });
    }

    for (const death of deathMatches) {
      const trailing = fullText.slice(Math.max(0, death.index + death.name.length));
      const actorPattern = new RegExp(`${death.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+(hits|strikes|misses|shifts|tags|afflicts)`, "i");
      expect(trailing).not.toMatch(actorPattern);
    }
  });
});
