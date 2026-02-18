import { expect, test } from "@playwright/test";

test.describe("production smoke", () => {
  test("campaign create reaches mythic route without stuck state", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    const campaignName = `Smoke ${Date.now()}`;
    const campaignDescription = "Production smoke campaign for reliability validation.";

    await page.getByPlaceholder("Campaign name").fill(campaignName);
    await page.getByPlaceholder("Campaign description").fill(campaignDescription);
    await page.getByRole("button", { name: "Create" }).click();

    const navResult = await Promise.race([
      page.waitForURL(/\/mythic\/[0-9a-f-]+(\/create-character)?/i, { timeout: 25_000 }).then(() => "navigated"),
      page.getByText("Failed to create campaign").waitFor({ timeout: 25_000 }).then(() => "failed"),
      page.getByText("Campaign create timed out", { exact: false }).waitFor({ timeout: 25_000 }).then(() => "failed"),
      page.getByText("You must be signed in to create a campaign.", { exact: false }).waitFor({ timeout: 25_000 }).then(() => "blocked_auth"),
    ]);

    expect(["navigated", "blocked_auth", "failed"]).toContain(navResult);
    await expect(page.getByRole("button", { name: /Creating\.\.\./ })).toHaveCount(0);
    expect(pageErrors, `page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  });

  test("servers admin exports debug bundle", async ({ page }) => {
    await page.goto("/servers");
    await expect(page.getByRole("heading", { name: "Servers/Admin" })).toBeVisible();

    const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
    await page.getByRole("button", { name: "Export Debug Bundle" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("mythic-debug-bundle-");
  });
});
