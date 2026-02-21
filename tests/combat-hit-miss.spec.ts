import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic combat hit/miss parity", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable hit/miss smoke.");

  test("combat feed records both hits and misses", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const combatRail = page.getByTestId("board-combat-rail");
    if (!(await combatRail.count())) {
      test.skip(true, "Campaign is not currently in combat.");
    }

    const attackButton = combatRail.getByRole("button", { name: /Attack/i }).first();
    const feed = page.getByTestId("combat-impact-feed");
    let sawHit = false;
    let sawMiss = false;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (await attackButton.count()) {
        const disabled = await attackButton.isDisabled();
        if (!disabled) {
          await attackButton.click();
        }
      }

      await page.waitForTimeout(1_900);
      const text = await (await feed.count() ? feed.innerText() : page.getByTestId("narrative-board-page").innerText());
      if (/miss/i.test(text)) sawMiss = true;
      if (/damage|strikes|hit|-\d+/i.test(text)) sawHit = true;
      if (sawHit && sawMiss) break;
    }

    expect(sawHit).toBeTruthy();
    expect(sawMiss).toBeTruthy();
  });
});
