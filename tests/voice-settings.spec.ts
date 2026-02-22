import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

const STORAGE_KEY = "mythic:dm-voice:v2";

test.describe("mythic voice settings", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable voice settings smoke.");

  test("defaults to alloy and persists selector changes", async ({ page }) => {
    await page.addInitScript((key) => {
      window.localStorage.removeItem(key);
    }, STORAGE_KEY);

    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    await expect.poll(async () => {
      return await page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        try {
          return JSON.parse(raw)?.voice ?? null;
        } catch {
          return null;
        }
      }, STORAGE_KEY);
    }, { timeout: 15_000 }).toBe("alloy");

    await page.getByRole("button", { name: /^menu$/i }).first().click();
    await page.getByRole("button", { name: /^settings$/i }).first().click();
    await expect(page.getByText("DM Voice")).toBeVisible();

    const voiceSelect = page.getByRole("combobox").first();
    await voiceSelect.click();
    await page.getByRole("option", { name: "Verse (Male Alt)" }).click();

    await expect.poll(async () => {
      return await page.evaluate((key) => {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        try {
          return JSON.parse(raw)?.voice ?? null;
        } catch {
          return null;
        }
      }, STORAGE_KEY);
    }, { timeout: 10_000 }).toBe("verse");
  });
});
