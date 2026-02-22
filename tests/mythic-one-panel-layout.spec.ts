import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic one-panel layout", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable one-panel layout smoke.");

  test("renders board-first shell with overlay and command bar", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));

    const boardPage = page.getByTestId("narrative-board-page");
    await expect(boardPage).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dm-overlay-bar")).toBeVisible();
    await expect(page.getByTestId("mythic-command-bar")).toBeVisible();
    await expect(page.getByTestId("mythic-command-controls")).toBeVisible();
    await expect(page.getByTestId("command-voice-toggle")).toHaveCount(1);
    await expect(page.getByTestId("command-transcript-open")).toHaveCount(1);
    await expect(page.getByTestId("dm-overlay-bar").getByText(/Voice:/i)).toHaveCount(0);
    await expect(page.getByTestId("board-grid-layer").first()).toBeVisible();

    const viewport = page.viewportSize();
    const boardBox = await boardPage.boundingBox();
    if (viewport && boardBox) {
      expect(boardBox.width).toBeGreaterThan(viewport.width * 0.70);
      expect(boardBox.height).toBeGreaterThan(viewport.height * 0.55);
    }
  });
});
