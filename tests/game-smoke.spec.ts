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

test("mythic screen keeps diagnostics hidden by default and reveals with advanced toggle", async ({ page }) => {
  const campaignId = "e2e00000-0000-4000-8000-000000000001";
  await page.goto(`/mythic/${campaignId}`);

  await expect(page.getByText("Mythic Weave")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show Advanced" })).toBeVisible();
  await expect(page.getByText("Board State JSON (Advanced)")).toHaveCount(0);

  await page.getByRole("button", { name: "Show Advanced" }).click();
  await expect(page.getByText("Board State JSON (Advanced)")).toBeVisible();
  await expect(page.getByText("Recent Board Transitions (Advanced)")).toBeVisible();
  await expect(page.getByText("DM Context JSON (Advanced)")).toBeVisible();
});

test("mythic DM turn updates quest arc and story timeline", async ({ page }) => {
  const campaignId = "e2e00000-0000-4000-8000-000000000001";
  await page.goto(`/mythic/${campaignId}`);

  await expect(page.getByText("No active quest arcs yet.")).toBeVisible();
  await expect(page.getByText("No story beats recorded yet.")).toBeVisible();

  await page.getByPlaceholder("Say something to the DM...").fill("I threaten the gate guard and demand passage.");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("E2E Pressure Arc")).toBeVisible();
  await expect(page.getByText("Endure three volatile turns. (1/3)")).toBeVisible();
  await expect(page.getByText("Mood swing in motion")).toBeVisible();
});

test("mythic combat loop supports move then skill then rewards then return to exploration", async ({ page }) => {
  let pageError: Error | null = null;
  page.on("pageerror", (error) => {
    pageError = error;
  });

  const campaignId = "e2e00000-0000-4000-8000-000000000002";
  await page.goto(`/mythic/${campaignId}`);

  await expect(page.getByText("Board: town")).toBeVisible();
  await page.getByRole("button", { name: "Start Combat" }).click();

  await expect(page.getByText("Combat Playback (DB is truth)")).toBeVisible();
  await expect(page.getByText("Isometric Tactics Board")).toBeVisible();

  await page.getByRole("button", { name: /^Move$/ }).click();
  await page.getByTitle("(2,1)").click();
  await page.getByRole("button", { name: "Confirm Move" }).click();

  await page.getByRole("button", { name: /^Skill$/ }).click();
  await page.getByRole("button", { name: "Momentum Slash" }).click();
  await page.getByTitle(/Ink Ghoul/).click();
  await page.getByRole("button", { name: "Use Selected Skill" }).click();

  await expect(page.getByText("Battle Rewards")).toBeVisible();
  await expect(page.getByText("Defeated enemies:")).toBeVisible();
  await page.getByRole("button", { name: "Continue Exploring" }).click();

  await expect(page.getByText("Battle Rewards")).toHaveCount(0);
  await expect(page.getByText("Board: town")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start Combat" })).toBeVisible();

  expect(pageError).toBeNull();
});
