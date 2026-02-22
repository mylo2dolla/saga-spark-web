import { expect, test } from "@playwright/test";
import { parsePlayerCommand } from "@/lib/mythic/playerCommandParser";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic typed input primary", () => {
  test("non-slash parser path is always dm_prompt", () => {
    const freeform = parsePlayerCommand("tell me more about the quartermaster");
    expect(freeform.intent).toBe("dm_prompt");
    expect(freeform.explicit).toBe(false);

    const slash = parsePlayerCommand("/travel town");
    expect(slash.intent).toBe("town");
    expect(slash.explicit).toBe(true);
  });

  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable typed-input smoke.");

  test("non-slash text routes as freeform without command leakage", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const before = (await page.locator("body").innerText()) || "";

    const input = page.getByPlaceholder("Say something to the DM...");
    await input.fill("tell me more");
    await page.getByRole("button", { name: /^send$/i }).click();

    await expect.poll(async () => {
      const next = (await page.locator("body").innerText()) || "";
      return next.length > before.length;
    }, { timeout: 45_000 }).toBeTruthy();

    const after = (await page.locator("body").innerText()) || "";
    const appended = after.slice(Math.min(before.length, after.length));
    expect(appended.toLowerCase()).not.toContain("command:unknown");
  });
});
