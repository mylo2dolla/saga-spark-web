import { test, expect } from "@playwright/test";

test("game screen renders without crashing", async ({ page }) => {
  let pageError: Error | null = null;
  page.on("pageerror", error => {
    pageError = error;
  });

  const campaignId = "e2e-campaign";
  await page.goto(`/__e2e/game/${campaignId}`);

  await expect(page.getByRole("heading", { name: "Game" })).toBeVisible();
  await expect(page.getByText(`Campaign ${campaignId}`)).toBeVisible();
  await expect(page.getByText("Dungeon Master")).toBeVisible();

  expect(pageError).toBeNull();
});

test("create character screen renders without crashing", async ({ page }) => {
  let pageError: Error | null = null;
  page.on("pageerror", error => {
    pageError = error;
  });

  const campaignId = "e2e-campaign";
  await page.goto(`/__e2e/game/${campaignId}/create-character`);

  await expect(page.getByText("Mythic Class Forge")).toBeVisible();

  expect(pageError).toBeNull();
});
