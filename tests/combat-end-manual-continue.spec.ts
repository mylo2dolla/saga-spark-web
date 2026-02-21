import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic combat end manual continue", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable combat-end continue smoke.");

  test("resolved combat waits for explicit continue before board transition", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const continueButton = page.getByTestId("combat-resolution-continue");
    if (!(await continueButton.count())) {
      test.skip(true, "No pending combat resolution is active for this campaign.");
    }

    const modeStrip = page.getByTestId("board-mode-strip");
    await expect(modeStrip).toContainText(/Combat/i);
    await continueButton.click();

    await expect.poll(async () => {
      const text = await modeStrip.innerText();
      return /Combat/i.test(text);
    }, { timeout: 25_000 }).toBeFalsy();
  });
});
