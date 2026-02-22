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
      await expect(page.getByTestId("board-render-token-label-mode")).toContainText("compact");
      await expect(page.getByTestId("board-render-status-chip-mode")).toContainText("none");
      await expect(page.getByTestId("board-render-intent-chip-mode")).toContainText("none");

      const paceBadge = page.getByTestId("board-mode-pace");
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
    let tacticalHeaderCount = await page.getByTestId("inspect-tactical-header").count();
    if (tacticalHeaderCount === 0) {
      const box = await boardGrid.boundingBox();
      if (box) {
        const probes = [
          { x: Math.max(8, Math.floor(box.width * 0.65)), y: Math.max(8, Math.floor(box.height * 0.35)) },
          { x: Math.max(8, Math.floor(box.width * 0.5)), y: Math.max(8, Math.floor(box.height * 0.5)) },
          { x: Math.max(8, Math.floor(box.width * 0.75)), y: Math.max(8, Math.floor(box.height * 0.55)) },
        ];
        for (const point of probes) {
          await boardGrid.click({ position: point });
          await expect(inspectCard).toBeVisible();
          tacticalHeaderCount = await page.getByTestId("inspect-tactical-header").count();
          if (tacticalHeaderCount > 0) break;
        }
      }
    }
    if (tacticalHeaderCount > 0) {
      await expect(page.getByTestId("inspect-tactical-vitals")).toBeVisible();
    }
  });
});
