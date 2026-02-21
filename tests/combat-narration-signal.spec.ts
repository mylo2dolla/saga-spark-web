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
    expect(bodyText).not.toMatch(/resolved\s+\d+\s+non-player turn steps/i);
    expect(bodyText).not.toMatch(/a combatant\s+(hits|tags|shifts)/i);
    expect(bodyText).not.toMatch(/tags the line/i);
  });
});
