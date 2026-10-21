import { test, expect, DESKTOP, PHONE, open } from "./helpers";

// On a computer: the phone's hexagons, ported. The header nav marks the page
// you're on with the tab bar's hexagon, and the thumb hexagon's shortcuts
// live in the header as a dropdown.

test.describe("desktop", () => {
  test.use(DESKTOP);

  const headerHex = (page: import("@playwright/test").Page) =>
    page.locator("[data-quick-actions-header] button[data-hex-toggle]");

  test("each nav link carries a hexagon; the current page's is turned and ink", async ({ page }) => {
    await open(page, "/productions");
    const nav = page.locator('header nav[aria-label="Main"]');
    await expect(nav.locator("a")).toHaveText(["Inventory", "Productions", "Theatre"]);
    const marks = await nav.locator("a [data-hex-toggle]").evaluateAll((els) =>
      els.map((el) => ({ rotate: getComputedStyle(el).rotate, bg: getComputedStyle(el).backgroundColor }))
    );
    expect(marks).toHaveLength(3);
    expect(marks[1].rotate).toBe("90deg");
    expect(marks[0].rotate).not.toBe("90deg");
    expect(marks[1].bg).not.toBe(marks[0].bg);
  });

  test("the header hexagon opens the shortcuts and they work", async ({ page }) => {
    await open(page, "/inventory");
    await expect(page.locator("[data-quick-actions]")).toBeHidden();
    const hex = headerHex(page);
    await expect(hex).toBeVisible();
    await expect(hex).toHaveAttribute("aria-expanded", "false");
    await hex.click();
    await expect(hex).toHaveAttribute("aria-expanded", "true");
    const menu = page.locator("#quick-actions-menu-header");
    await expect(menu.getByRole("menuitem")).toHaveText([/Add item/, /Add a photo/, /Image search/]);
    // It drops down from the header, inside the window.
    const box = (await menu.boundingBox())!;
    const hexBox = (await hex.boundingBox())!;
    expect(box.y).toBeGreaterThan(hexBox.y + hexBox.height - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    // Focus lands in the menu, and Escape gives it back to the hexagon.
    expect(await page.evaluate(() => document.activeElement?.closest("#quick-actions-menu-header") !== null)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.closest("[data-quick-actions-header]") !== null)).toBe(true);
    // Clicking elsewhere closes it too.
    await hex.click();
    await page.mouse.click(20, 400);
    await expect(menu).toHaveCount(0);
    // And a choice goes where it says.
    await hex.click();
    await menu.getByRole("menuitem", { name: /Add item/ }).click();
    await page.waitForURL("**/items/new");
  });

  test("scrolling the page leaves the header hexagon where it is", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const hex = headerHex(page);
    await hex.click();
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(400);
    // The page scrolled under the open menu rather than closing or moving it.
    await expect(hex).toHaveAttribute("aria-expanded", "true");
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("the header hexagon is the computer's; a phone keeps its thumb hexagon", async ({ page }) => {
    await open(page, "/inventory");
    await expect(page.locator("[data-quick-actions-header]")).toBeHidden();
    await expect(page.locator("[data-quick-actions] button[data-hex-toggle]")).toBeVisible();
  });
});
