import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic town board liveness", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable town board liveness smoke.");

  test("town board avoids duplicate labels and supports npc inspect", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const grid = page.getByTestId("board-grid-layer").first();
    await expect(grid).toBeVisible();

    const hotspotIds = await page.locator("[data-testid^='board-hotspot-']").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid") || ""),
    );
    const unique = new Set(hotspotIds.filter(Boolean));
    expect(unique.size).toBe(hotspotIds.filter(Boolean).length);

    const npcToken = page.locator("[data-testid^='town-npc-token-']").first();
    if (await npcToken.count()) {
      await npcToken.click();
      await expect(page.getByTestId("board-inspect-card")).toBeVisible();
      await page.getByTestId("board-inspect-card").getByRole("button", { name: "Close" }).click();
      await expect(page.getByTestId("board-inspect-card")).toHaveCount(0);
    }
  });
});
