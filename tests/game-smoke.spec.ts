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
  await expect(page.getByText("Advanced session data")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show" })).toBeVisible();
  await expect(page.getByText("Inspector")).toHaveCount(0);

  expect(pageError).toBeNull();
});

test("advanced panels stay hidden until explicitly enabled", async ({ page }) => {
  const campaignId = "e2e-campaign";
  await page.goto(`/__e2e/game/${campaignId}`);

  await expect(page.getByRole("heading", { name: "World Events" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("heading", { name: "Inspector" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "World Events" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Session" })).toBeVisible();
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

test("auth screen renders login controls", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
});
