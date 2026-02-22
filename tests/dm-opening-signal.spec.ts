import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

const bannedPatterns = [
  /command:unknown/i,
  /opening move/i,
  /board answers with hard state/i,
  /committed the pressure lines/i,
  /commit one decisive move and keep pressure on the nearest fault line/i,
];

test.describe("mythic opening narration signal", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable opening signal smoke.");

  test("opening and recovery narration stay player-facing", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const bodyText = ((await page.locator("body").innerText()) || "").toLowerCase();
    for (const pattern of bannedPatterns) {
      expect(bodyText).not.toMatch(pattern);
    }
  });
});
