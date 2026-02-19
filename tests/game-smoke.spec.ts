import { test, expect } from "@playwright/test";

test("mythic game route renders without crashing", async ({ page }) => {
  let pageError: Error | null = null;
  page.on("pageerror", error => {
    pageError = error;
  });

  const campaignId = "e2e-campaign";
  await page.goto(`/mythic/${campaignId}`);

  await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
  await expect(page.locator("body")).toContainText(/No active Mythic board found\.|Mythic Weave/);

  expect(pageError).toBeNull();
});

test("mythic create character route renders without crashing", async ({ page }) => {
  let pageError: Error | null = null;
  page.on("pageerror", error => {
    pageError = error;
  });

  const campaignId = "e2e-campaign";
  await page.goto(`/mythic/${campaignId}/create-character`);

  await expect(page.getByText("Mythic Class Forge")).toBeVisible();

  expect(pageError).toBeNull();
});
