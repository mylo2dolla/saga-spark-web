import { expect, test } from "@playwright/test";

const campaignId = process.env.PLAYWRIGHT_MYTHIC_CAMPAIGN_ID;

test.describe("mythic town layout readability", () => {
  test.skip(!campaignId, "Set PLAYWRIGHT_MYTHIC_CAMPAIGN_ID to enable town readability smoke.");

  test("town board avoids duplicate noisy labels and token pileups", async ({ page }) => {
    await page.goto(`/mythic/${campaignId}`);
    await expect(page).toHaveURL(new RegExp(`/mythic/${campaignId}$`));
    await expect(page.getByTestId("narrative-board-page")).toBeVisible({ timeout: 30_000 });

    const hotspotIds = await page.locator("[data-testid^='board-hotspot-']").evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-testid") || ""),
    );
    const unique = new Set(hotspotIds.filter(Boolean));
    expect(unique.size).toBe(hotspotIds.filter(Boolean).length);

    const vendorLabels = await page.locator("[data-testid^='board-hotspot-town-vendor-']").allTextContents();
    for (const label of vendorLabels) {
      expect(label).not.toContain("notice_board");
      expect(label).not.toContain("_");
    }

    const npcTexts = await page.locator("[data-testid^='town-npc-token-']").allTextContents();
    for (const text of npcTexts) {
      const lineCount = text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
      expect(lineCount).toBeLessThanOrEqual(1);
    }

    const maxOverlap = await page.locator("[data-testid^='town-npc-token-']").evaluateAll((nodes) => {
      const rects = nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      let maxArea = 0;
      for (let i = 0; i < rects.length; i += 1) {
        for (let j = i + 1; j < rects.length; j += 1) {
          const a = rects[i]!;
          const b = rects[j]!;
          const w = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
          const h = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
          maxArea = Math.max(maxArea, w * h);
        }
      }
      return maxArea;
    });
    expect(maxOverlap).toBeLessThanOrEqual(64);
  });
});
