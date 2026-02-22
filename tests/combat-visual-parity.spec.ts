import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic combat visual parity", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable combat parity smoke.");

  test("combat board keeps tactical parity surface", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("dm-overlay-bar")).toBeVisible();
    await expect(page.getByTestId("mythic-command-bar")).toBeVisible();

    const combatRail = page.getByTestId("board-combat-rail");
    if (await combatRail.count()) {
      await expect(combatRail).toBeVisible();
      await expect(combatRail).toContainText(/Attack/i);
      await expect(combatRail).toContainText(/Defend/i);
      await expect(combatRail).toContainText(/Recover MP/i);

      await expect(page.getByTestId("combat-move-state")).toContainText(/Move/i);

      const paceBadge = page.getByTestId("combat-pace-badge");
      if (await paceBadge.count()) {
        await expect(paceBadge).toContainText(/Pace:/i);
      }

      const impactFeed = page.getByTestId("combat-impact-feed");
      if (await impactFeed.count()) {
        await expect(impactFeed).toContainText(/Feed/i);
      }

      const railBox = await combatRail.boundingBox();
      const commandBox = await page.getByTestId("mythic-command-bar").boundingBox();
      if (railBox && commandBox) {
        expect(railBox.y + railBox.height).toBeLessThanOrEqual(commandBox.y + 2);
      }
    }

    const boardGrid = page.getByTestId("board-grid-layer").first();
    await boardGrid.click({ position: { x: 24, y: 24 } });
    const inspectCard = page.getByTestId("board-inspect-card");
    await expect(inspectCard).toBeVisible();
    await expect(inspectCard).toContainText(/Confirm Action/i);
  });
});
