import { test, expect } from "@playwright/test";

test.describe("mythic board render snapshot harness", () => {
  test("loads deterministic board snapshot and fallback renderer", async ({ page }) => {
    await page.goto("/mythic-render-harness");

    await expect(page.getByRole("heading", { name: "Mythic Render Harness" })).toBeVisible();
    await expect(page.getByTestId("render-harness-board")).toBeVisible();

    await expect(page.getByTestId("assert-aoe")).toContainText("aoe telegraph true");
    await expect(page.getByTestId("assert-fallback")).toContainText("fallback sprites true");
    await expect(page.getByTestId("assert-movement")).toContainText("movement true");
  });
});
