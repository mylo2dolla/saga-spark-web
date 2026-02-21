import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic right-panel quick cards", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable right-panel card interaction smoke.");

  test("quick cards open and close detail surfaces", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByText("Quick Cards")).toBeVisible({ timeout: 30_000 });

    const cardIds = ["inspect", "actions", "scene", "feed"] as const;
    for (const cardId of cardIds) {
      const trigger = page.getByTestId(`board-card-trigger-${cardId}`);
      await expect(trigger).toBeVisible();
      await trigger.click();
      await expect(trigger).toHaveClass(/ring-1/);
      await page.keyboard.press("Escape");
      await expect(trigger).not.toHaveClass(/ring-1/);
    }
  });
});
