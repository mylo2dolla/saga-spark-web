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
  const boardCount = await page.getByTestId("narrative-board-page").count();
  if (boardCount > 0) {
    await expect(page.getByTestId("narrative-board-page").first()).toBeVisible();
    await expect(page.getByTestId("mythic-command-bar")).toBeVisible();
  }

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
