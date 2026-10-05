import { test, expect, DESKTOP, open, LIST_CELLS } from "./helpers";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

// Right-click on a computer offers what a swipe does on a phone.

test.use(DESKTOP);

const PROP_TABLE = path.join(__dirname, "fixtures", "prop-table.jpg");
const menu = (page: Page) => page.locator("[data-context-menu]");
const items = async (page: Page) =>
  (await menu(page).locator("[role=menuitem]").allInnerTexts()).map((t) => t.split("\n")[0]);
const cell = (page: Page, name: string) =>
  page.locator(LIST_CELLS, { has: page.locator("h3", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) });
const bar = (page: Page) => page.locator("[data-pull-bar]");
/** Raises a contextmenu event on the element; true if the page took it. */
const taken = (target: Locator, { shift = false } = {}) =>
  target.evaluate((el, shift) => {
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 300, clientY: 300, shiftKey: shift });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  }, shift);

test("an inventory item: ask, then remember, then offer another", async ({ page }) => {
  await open(page, "/inventory?view=list");
  await cell(page, "Bells").locator("h3").click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(menu(page)).toContainText("Bells");
  expect(await items(page)).toEqual(["Add to a production…"]);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("menuitem");
  await expect(cell(page, "Bells").locator("[data-cell-button]")).toHaveAttribute("aria-expanded", "false");
  await menu(page).getByRole("menuitem").first().click();
  await page.getByRole("dialog").locator("[data-pull-target]", { hasText: "Noises Off!" }).click();
  await expect(bar(page)).toContainText(/Added\s+Bells\s+to Noises Off!/);

  await cell(page, "Crown (Prop)").locator("h3").click({ button: "right" });
  expect(await items(page)).toEqual(["Add to Noises Off!", "Add to another production…"]);
  await page.keyboard.press("Enter");
  await expect(bar(page)).toContainText(/Added\s+Crown \(Prop\)\s+to Noises Off!/);

  await cell(page, "Tea Set").locator("h3").click({ button: "right" });
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(":focus")).toContainText("another production");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toContainText("Tea Set");
  await page.keyboard.press("Escape");
});

test("closes on Escape, a click elsewhere or a scroll; one at a time", async ({ page }) => {
  await open(page, "/inventory?view=list");
  const tray = cell(page, "Silver Tray").locator("h3");
  await tray.click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(menu(page)).toBeHidden();
  await tray.click({ button: "right" });
  await page.mouse.click(5, 5);
  await expect(menu(page)).toBeHidden();
  await tray.click({ button: "right" });
  await page.mouse.wheel(0, -300);
  await page.mouse.wheel(0, 300);
  await expect(menu(page)).toBeHidden();
  await tray.click({ button: "right" });
  await cell(page, "Tea Set").locator("h3").click({ button: "right" });
  await expect(menu(page)).toHaveCount(1);
  await expect(menu(page)).toContainText("Tea Set");
});

test("the browser's own menu is left alone on links, with Shift, and after a touch", async ({ page }) => {
  await open(page, "/inventory?view=list");
  const tray = cell(page, "Silver Tray");
  await tray.locator("h3").click();
  expect(await taken(tray.locator("dl a").last()), "on a link").toBe(false);
  expect(await taken(cell(page, "Tea Set").locator("h3"), { shift: true }), "with Shift").toBe(false);
  expect(await taken(cell(page, "Tea Set").locator("h3")), "a plain right-click is ours").toBe(true);
  await page.keyboard.press("Escape");
  const afterTouch = await cell(page, "Tea Set").locator("h3").evaluate((el) => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "touch" }));
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 200, clientY: 200 });
    el.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(afterTouch, "Android's long press").toBe(false);
});

test("stays inside the window near the corner", async ({ page }) => {
  await open(page, "/inventory?view=list");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(300);
  const last = (await page.locator(LIST_CELLS).last().boundingBox())!;
  await page.mouse.click(last.x + last.width - 4, last.y + last.height - 4, { button: "right" });
  const box = (await menu(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1280);
  expect(box.y + box.height).toBeLessThanOrEqual(900);
});

test("grid tiles and search results have it too", async ({ page }) => {
  await open(page, "/inventory?view=grid");
  await page.locator("[data-item-tile]", { hasText: "Oil Lantern" }).locator("h3").click({ button: "right" });
  await expect(menu(page)).toContainText("Oil Lantern");
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-item-tile][data-open]")).toHaveCount(0);
  await page.locator("main input[type=text]").fill("map");
  await page.locator("main li", { hasText: "Map (Aged)" }).first().click({ button: "right" });
  await expect(menu(page)).toContainText("Map (Aged)");
});

test("a pull-list line: Mark pulled, then Already pulled; the quantity box keeps the browser menu", async ({ page }) => {
  await open(page, "/productions/prod1");
  const line = page.locator("[data-pull-row]", { hasText: "Brass candlestick" });
  await line.locator("p").first().click({ button: "right" });
  expect(await items(page)).toEqual(["Mark pulled"]);
  await menu(page).getByRole("menuitem").first().click();
  await expect(line.locator('button[aria-pressed="true"]')).toHaveText("Pulled");
  await line.locator("p").first().click({ button: "right" });
  expect(await items(page)).toEqual(["Already pulled"]);
  await expect(menu(page).getByRole("menuitem").first()).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(await taken(line.locator("input[type=number]"))).toBe(false);
});

test("a checklist line: Not needed, then Put back", async ({ page }) => {
  await open(page, "/productions/prod1/checklist");
  const line = page.locator("main li", { hasText: "Brass candlestick" }).first();
  await line.locator("p").first().click({ button: "right" });
  expect(await items(page)).toEqual(["Not needed"]);
  await menu(page).getByRole("menuitem").first().click();
  await expect(line).toContainText("Not needed after all");
  // No menu while a change is still saving; wait for it to land.
  await expect(line.getByRole("button", { name: "Put back" })).toBeEnabled();
  await line.locator("p").first().click({ button: "right" });
  expect(await items(page)).toEqual(["Put back on the list"]);
  await menu(page).getByRole("menuitem").first().click();
  await expect(line).not.toContainText("Not needed after all");
});

test("a photo-review row offers both of its swipes", async ({ page }) => {
  await open(page, "/productions/prod1/photo");
  await page.locator("input[type=file]").first().setInputFiles(PROP_TABLE);
  const rows = page.locator('main li:has(select[aria-label^="Which item"])');
  await expect(rows).toHaveCount(4, { timeout: 20_000 });
  await rows.first().locator("figure").first().click({ button: "right" });
  expect(await items(page)).toEqual(["Add to inventory", "Remove from this list"]);
  await menu(page).getByRole("menuitem", { name: /Remove/ }).click();
  await expect(rows).toHaveCount(3);
});
