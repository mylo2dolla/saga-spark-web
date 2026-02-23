import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;
const authEmail = process.env.PLAYWRIGHT_MYTHIC_EMAIL;
const authPassword = process.env.PLAYWRIGHT_MYTHIC_PASSWORD;

test.describe("mythic town board liveness", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable town board liveness smoke.");

  test("town board avoids duplicate labels and supports npc inspect", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("mythic:board-renderer");
    });

    if (authEmail && authPassword) {
      await page.goto("/login");
      await page.locator("#email").fill(authEmail);
      await page.locator("#password").fill(authPassword);
      await page.getByRole("button", { name: "Login" }).click();
      await expect(page).toHaveURL(/\/dashboard(?:[?#].*)?$/, { timeout: 30_000 });
    }

    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("board-pixi-renderer")).toHaveCount(0);

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
