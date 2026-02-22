import { test, expect } from "@playwright/test";

test.describe("mythic combat visual events", () => {
  test("replays move/hit/miss/barrier/bleed with camera pulse and no event spam", async ({ page }) => {
    await page.goto("/mythic-render-harness");

    await page.getByTestId("harness-replay").click();

    await expect(page.getByTestId("assert-movement")).toContainText("movement true");
    await expect(page.getByTestId("assert-hit")).toContainText("hit+damage true");
    await expect(page.getByTestId("assert-miss")).toContainText("miss true");
    await expect(page.getByTestId("assert-barrier")).toContainText("barrier/status true");
    await expect(page.getByTestId("assert-bleed")).toContainText("bleed tick true");
    await expect(page.getByTestId("assert-camera")).toContainText("camera pulse true");

    const queueText = await page.getByText(/raw \d+ · queued \d+ · played \d+/).innerText();
    const match = queueText.match(/raw\s+(\d+)\s+·\s+queued\s+(\d+)\s+·\s+played\s+(\d+)/i);
    expect(match).not.toBeNull();
    const rawCount = Number(match?.[1] ?? 0);
    const queuedCount = Number(match?.[2] ?? 0);
    expect(rawCount).toBeGreaterThan(queuedCount);
  });
});
