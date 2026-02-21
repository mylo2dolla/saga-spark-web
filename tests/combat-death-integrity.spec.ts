import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic combat death integrity", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable death integrity smoke.");

  test("dead combatants are removed from active token render", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const combatRail = page.getByTestId("board-combat-rail");
    if (!(await combatRail.count())) {
      test.skip(true, "Campaign is not currently in combat.");
    }

    const hasDeadToken = async () => {
      const tokens = page.locator("[data-testid^='combat-token-']");
      const count = await tokens.count();
      for (let index = 0; index < count; index += 1) {
        const hpAttr = await tokens.nth(index).getAttribute("data-hp");
        const hp = Number(hpAttr ?? "0");
        if (Number.isFinite(hp) && hp <= 0) {
          return true;
        }
      }
      return false;
    };

    expect(await hasDeadToken()).toBeFalsy();
    await page.waitForTimeout(3_500);
    expect(await hasDeadToken()).toBeFalsy();
  });
});
