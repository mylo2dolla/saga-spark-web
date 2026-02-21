import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic right-panel popup interactions", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable right-panel interaction smoke.");

  test("board clicks open inspect popups in player mode", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const boardGrid = page.getByTestId("board-grid-layer").first();
    await expect(boardGrid).toBeVisible();
    await boardGrid.click({ position: { x: 24, y: 24 } });
    await expect(page.getByTestId("board-inspect-card")).toBeVisible();
    await page.getByTestId("board-inspect-card").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("board-inspect-card")).toHaveCount(0);

    const hotspot = page.locator("[data-testid^='board-hotspot-']").first();
    if (await hotspot.count()) {
      await hotspot.click();
      await expect(page.getByTestId("board-inspect-card")).toBeVisible();
      await page.getByTestId("board-inspect-card").getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("board-inspect-card")).toHaveCount(0);
    }
  });

  test("combat rail stays board-first and exposes core actions", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const combatRail = page.getByTestId("board-combat-rail");
    if (await combatRail.count()) {
      await expect(combatRail).toContainText(/Core Actions/i);
      await expect(combatRail).toContainText(/Attack/i);
      await expect(combatRail).toContainText(/Defend/i);
      await expect(combatRail).toContainText(/Recover MP/i);
    }
  });
});
