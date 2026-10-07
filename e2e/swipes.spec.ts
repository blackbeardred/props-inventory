import { test, expect, PHONE, DESKTOP, open, swipe, LIST_CELLS } from "./helpers";
import path from "node:path";
import type { Page } from "@playwright/test";

// Every swipe goes left and does the row's "yes": an inventory item onto a
// production's pull list (ask once, then remember), a pull-list line to
// "Pulled", a checklist line to "Checked", a photo-review row to "Add to
// inventory". Nothing is removed or cleared by a swipe, and a rightward drag
// does nothing anywhere.

const cell = (page: Page, name: string) =>
  page.locator(LIST_CELLS, { has: page.locator("h3", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) });
const bar = (page: Page) => page.locator("[data-pull-bar]");
const sheet = (page: Page) => page.getByRole("dialog");
const reveal = (page: Page) => page.locator("[data-swipe-reveal]");
const REMEMBER_NOISES_OFF = () =>
  localStorage.setItem(
    "pull-target",
    JSON.stringify({
      at: Date.now(),
      target: { productionId: "prod1", productionName: "Noises Off!", pullListId: "pl1", label: "Noises Off!" },
    })
  );

test.describe("inventory (phone)", () => {
  test.use(PHONE);

  test("the first swipe asks which production, and the strip says it will", async ({ page }) => {
    await open(page, "/inventory?view=list");
    await swipe(page, cell(page, "Bells"), -160, {
      during: async () => {
        await expect(reveal(page)).toContainText(/Add to\s*a\s*production/);
        await expect(reveal(page)).toHaveClass(/bg-accent /);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
      },
    });
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText(/Add\s+Bells\s+to/);
    await expect(cell(page, "Bells").locator("[data-cell-button]")).toHaveAttribute("aria-expanded", "false");
    await sheet(page).locator("[data-pull-target]", { hasText: "Noises Off!" }).click();
    await expect(bar(page)).toContainText(/Added\s+Bells\s+to Noises Off!/);
  });

  test("after that, swipes go straight there; Undo takes it back off", async ({ page }) => {
    await open(page, "/inventory?view=list");
    await page.evaluate(REMEMBER_NOISES_OFF);
    await swipe(page, cell(page, "Crown (Prop)"), -160, {
      during: async () => {
        await expect(reveal(page)).toContainText(/Add to\s*Noises Off!/);
      },
    });
    await expect(bar(page)).toContainText(/Added\s+Crown \(Prop\)\s+to Noises Off!/);
    await expect(sheet(page)).toBeHidden();
    await bar(page).getByRole("button", { name: "Undo" }).click();
    await expect(bar(page)).toContainText(/Took\s+Crown \(Prop\)\s+off/);
    await open(page, "/productions/prod1");
    await expect(page.locator("[data-pull-row]", { hasText: "Crown (Prop)" })).toHaveCount(0);
  });

  test("something already on the list isn't added twice; the bar goes by itself", async ({ page }) => {
    await open(page, "/inventory?view=list");
    await page.evaluate(REMEMBER_NOISES_OFF);
    await swipe(page, cell(page, "Fishing Net"), -160);
    await expect(bar(page)).toContainText(/Fishing Net\s+is already on Noises Off!/);
    await expect(bar(page)).toBeHidden({ timeout: 9_000 });
  });

  test("short, vertical and rightward drags do nothing; taps still open the card", async ({ page }) => {
    await open(page, "/inventory?view=list");
    await swipe(page, cell(page, "Tea Set"), -60);
    await swipe(page, cell(page, "Silver Tray"), -30, { dy: -200 });
    await swipe(page, cell(page, "Pewter tankard"), 160);
    await page.waitForTimeout(500);
    await expect(bar(page)).toBeHidden();
    await expect(sheet(page)).toBeHidden();
    await cell(page, "Tea Set").locator("h3").tap();
    await expect(cell(page, "Tea Set").locator("[data-cell-button]")).toHaveAttribute("aria-expanded", "true");
    await expect(cell(page, "Tea Set").getByRole("button", { name: /Add to a production/ })).toHaveCount(1);
  });

  test("Change takes it back and asks again", async ({ page }) => {
    await open(page, "/inventory?view=list");
    await page.evaluate(REMEMBER_NOISES_OFF);
    await swipe(page, cell(page, "Velvet cloak"), -160);
    await bar(page).getByRole("button", { name: "Change" }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText("Velvet cloak");
    await sheet(page).getByRole("button", { name: "Cancel" }).click();
    expect(await page.evaluate(() => localStorage.getItem("pull-target"))).toBeNull();
    await open(page, "/productions/prod1");
    await expect(page.locator("[data-pull-row]", { hasText: "Velvet cloak" })).toHaveCount(0);
  });

  test("grid tiles and search results swipe too", async ({ page }) => {
    await open(page, "/inventory?view=grid");
    await page.evaluate(REMEMBER_NOISES_OFF);
    await swipe(page, page.locator("[data-item-tile]", { hasText: "Oil Lantern" }), -150);
    await expect(bar(page)).toContainText(/Added\s+Oil Lantern/);
    await expect(page.locator("[data-item-tile][data-open]")).toHaveCount(0);
    await page.locator("main input[type=text]").fill("map");
    await expect(page.locator("main li", { hasText: "Map (Aged)" }).first()).toBeVisible();
    // Enter takes it as a search word, which closes the suggestions that
    // would otherwise sit over the results (blurring doesn't close them).
    await page.locator("main input[type=text]").press("Enter");
    await expect(page.locator("main li", { hasText: "Map (Aged)" }).first()).toBeVisible();
    await swipe(page, page.locator("main li", { hasText: "Map (Aged)" }).first(), -150);
    await expect(bar(page)).toContainText(/Added\s+Map \(Aged\)/);
    await open(page, "/productions/prod1");
    await expect(page.locator("[data-pull-row]", { hasText: "Oil Lantern" })).toHaveCount(1);
    await expect(page.locator("[data-pull-row]", { hasText: "Map (Aged)" })).toHaveCount(1);
  });
});

test.describe("pull list (phone)", () => {
  test.use(PHONE);
  const row = (page: Page, name: string) => page.locator("[data-pull-row]", { hasText: name });
  const pressed = (page: Page, name: string) => row(page, name).locator('button[aria-pressed="true"]');

  test("a left swipe marks a line pulled; on one already pulled it says so", async ({ page }) => {
    await open(page, "/productions/prod1");
    await expect(pressed(page, "Brass candlestick")).toHaveText("Pending");
    await swipe(page, row(page, "Brass candlestick"), -160, {
      during: async () => {
        await expect(row(page, "Brass candlestick")).toContainText("Let go to mark pulled");
      },
    });
    await expect(pressed(page, "Brass candlestick")).toHaveText("Pulled");
    // Saved, not just shown: the current status's own button is disabled.
    await expect(row(page, "Brass candlestick").locator('button[value="pulled"]')).toBeDisabled();
    await swipe(page, row(page, "Brass candlestick"), -160, {
      during: async () => {
        await expect(row(page, "Brass candlestick")).toContainText("Already pulled");
      },
    });
    await expect(pressed(page, "Brass candlestick")).toHaveText("Pulled");
  });

  test("a swipe begun at the very edge of the screen still counts", async ({ page }) => {
    await open(page, "/productions/prod1");
    await swipe(page, row(page, "Brass candlestick"), -170, { fromX: 388 });
    await expect(pressed(page, "Brass candlestick")).toHaveText("Pulled");
  });
});

test.describe("checklist (phone)", () => {
  test.use(PHONE);
  const line = (page: Page, name: string) => page.locator("main li", { hasText: name }).first();
  const box = (page: Page, name: string) => line(page, name).locator("input[type=checkbox]");

  test("a left swipe marks a line checked; on one already checked it says so", async ({ page }) => {
    await open(page, "/productions/prod1/checklist");
    await expect(box(page, "Brass candlestick")).not.toBeChecked();
    // From the name: the row's right-hand end is its Not needed button.
    await swipe(page, line(page, "Brass candlestick").locator("p").first(), -160, {
      during: async () => {
        await expect(line(page, "Brass candlestick")).toContainText("Let go to mark checked");
      },
    });
    await expect(box(page, "Brass candlestick")).toBeChecked();
    await expect(line(page, "Brass candlestick")).not.toContainText("NOT CHECKED");
    await swipe(page, line(page, "Brass candlestick").locator("p").first(), -160, {
      during: async () => {
        await expect(line(page, "Brass candlestick")).toContainText("Already checked");
      },
    });
    await expect(box(page, "Brass candlestick")).toBeChecked();
  });

  test("no swipe takes a line off the list: right and short drags do nothing", async ({ page }) => {
    await open(page, "/productions/prod1/checklist");
    await swipe(page, line(page, "Fishing Net").locator("p").first(), 160);
    await swipe(page, line(page, "Fishing Net").locator("p").first(), -60);
    await page.waitForTimeout(400);
    await expect(line(page, "Fishing Net")).not.toContainText("Not needed after all");
    await expect(box(page, "Fishing Net")).not.toBeChecked();
    // The button still does it.
    await line(page, "Fishing Net").getByRole("button", { name: "Not needed" }).click();
    await expect(line(page, "Fishing Net")).toContainText("Not needed after all");
  });
});

test.describe("photo review (phone)", () => {
  test.use(PHONE);
  const PROP_TABLE = path.join(__dirname, "fixtures", "prop-table.jpg");
  const rows = (page: Page) => page.locator('main li:has(select[aria-label^="Which item"])');
  const goblet = (page: Page) => rows(page).filter({ has: page.locator('select[aria-label="Which item is “goblet”"]') });

  test("a left swipe sets a row to be added to the inventory; a right swipe does nothing", async ({ page }) => {
    await open(page, "/productions/prod1/photo");
    await page.locator("input[type=file]").first().setInputFiles(PROP_TABLE);
    await expect(rows(page)).toHaveCount(4, { timeout: 20_000 });
    const select = page.locator('select[aria-label="Which item is “goblet”"]');
    await expect(select).toHaveValue("");

    await swipe(page, goblet(page).locator("figure").first(), 160);
    await expect(rows(page)).toHaveCount(4);
    await expect(select).toHaveValue("");

    await swipe(page, goblet(page).locator("figure").first(), -160, {
      during: async () => {
        await expect(goblet(page)).toContainText("Let go to add to inventory");
      },
    });
    await expect(select).toHaveValue("__new");
    // Still there: a swipe never removes a row.
    await expect(rows(page)).toHaveCount(4);
    await swipe(page, goblet(page).locator("figure").first(), -160, {
      during: async () => {
        await expect(goblet(page)).toContainText("Being added to inventory");
      },
    });
    await expect(rows(page)).toHaveCount(4);
  });
});

test.describe("desktop", () => {
  test.use(DESKTOP);

  test("an opened item's button does what the swipe does", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const tankard = cell(page, "Pewter tankard");
    await tankard.locator("h3").click();
    await tankard.getByRole("button", { name: /Add to a production/ }).click();
    await expect(sheet(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  });
});
