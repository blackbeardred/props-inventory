import { test, expect, PHONE, open } from "./helpers";

// Search, from Inventory's search box: chips, why each result matched, and
// where the details open.

const RESULT_ROWS = "main ul > li > button";

test.describe("phone", () => {
  test.use(PHONE);

  test("results say why they matched, when the name doesn't", async ({ page }) => {
    await open(page, "/inventory?q=brass");
    await expect.poll(() => page.locator(RESULT_ROWS).count()).toBeGreaterThanOrEqual(4);
    await expect(page.locator(RESULT_ROWS, { hasText: "Tea Set" })).toContainText("matched “brass” in its notes");
    await expect(page.locator(RESULT_ROWS, { hasText: "Silver Tray" })).toContainText("by what it is");
    await expect(page.locator(RESULT_ROWS, { hasText: "Antique Brass Broom" })).not.toContainText("matched");
  });

  test("tapping a result opens its details right under it; a second tap closes", async ({ page }) => {
    await open(page, "/inventory?q=brass");
    const inline = page.locator("main li.lg\\:hidden");
    await expect(inline).toHaveCount(0);
    const tea = page.locator(RESULT_ROWS, { hasText: "Tea Set" });
    await tea.click();
    await expect(inline).toContainText("Tea Set");
    const gap = await page.evaluate(() => {
      const details = document.querySelector("main li.lg\\:hidden")!.getBoundingClientRect();
      const row = [...document.querySelectorAll("main ul > li > button")]
        .find((b) => (b as HTMLElement).innerText.includes("Tea Set"))!
        .getBoundingClientRect();
      return details.top - row.bottom;
    });
    expect(gap).toBeGreaterThanOrEqual(-1);
    expect(gap).toBeLessThan(4);
    await tea.click();
    await expect(inline).toHaveCount(0);
  });

  test("a search is in the address, so it can be shared or reloaded", async ({ page }) => {
    await open(page, "/inventory");
    await page.locator("main input[type=text]").fill("tankard");
    await expect(page).toHaveURL(/q=tankard/);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator(RESULT_ROWS, { hasText: "Pewter tankard" })).toBeVisible();
  });

  test("leftover spreadsheet columns are searchable", async ({ page }) => {
    await open(page, "/inventory?q=P-014");
    await expect(page.locator(RESULT_ROWS, { hasText: "Map (Aged)" })).toBeVisible();
  });

  test("“By photo” sits in the search box", async ({ page }) => {
    await open(page, "/inventory");
    await expect(page.locator('main a[href="/items/lookalike"]', { hasText: "By photo" })).toHaveCount(1);
  });
});

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the details pane sits beside the list", async ({ page }) => {
    await open(page, "/inventory?q=brass");
    await expect(page.locator("main .lg\\:block").first()).toBeVisible();
  });
});
