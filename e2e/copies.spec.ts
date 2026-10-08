import { test, expect, DESKTOP, PHONE, LIST_CELLS, open, noSidewaysScroll } from "./helpers";
import type { Page } from "@playwright/test";

// Identical items in the same box show as one row on the Inventory page:
// "Silver Tray (2)" (src/lib/item-copies.ts). The fixture option copies=1
// puts six Silver Trays about: two loose in Props Room A (a room with boxes,
// so they stay apart), two in the Loft (a room with nothing inside, so they
// combine; one is out on Noises Off!), one in the Shakespeare Box and one on
// shelf B (different boxes, so apart).

test.use({ fixtureOptions: "copies=1" });

const trayRows = (page: Page) => page.locator(LIST_CELLS, { has: page.locator("h3", { hasText: /^Silver Tray/i }) });

test.describe("the list (desktop)", () => {
  test.use(DESKTOP);

  test("two trays in the same place become Silver Tray (2); the rest stay apart", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const combined = page.locator("main li[data-copies]");
    await expect(combined).toHaveCount(1);
    await expect(combined).toHaveAttribute("data-copies", "2");
    await expect(combined.locator("h3")).toHaveText("Silver Tray (2)");
    await expect(combined).toContainText("Loft");
    // Six trays, five rows: the two in the Loft are one.
    await expect(trayRows(page)).toHaveCount(5);
    await expect(page.locator("main h3", { hasText: /^Silver Tray$/ })).toHaveCount(4);
    // One of the two is out on a show.
    await expect(combined).toContainText("1/2 in use");
  });

  test("opening it lists each tray, each with its own page", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const combined = page.locator("main li[data-copies]");
    await combined.locator("h3").click();
    const copies = combined.locator("[data-copy]");
    await expect(copies).toHaveCount(2);
    await expect(copies.nth(0)).toContainText("Good");
    await expect(copies.nth(0)).toContainText("Noises Off!");
    await expect(copies.nth(1)).toContainText("Fair");
    await expect(copies.nth(1)).toContainText("Dented on one corner.");
    await expect(copies.nth(0).getByRole("link", { name: "Edit →" })).toHaveAttribute("href", "/items/it-tray3/edit");
    await expect(copies.nth(1).getByRole("link", { name: "Edit →" })).toHaveAttribute("href", "/items/it-tray4/edit");
  });

  test("right-click offers the one that isn't out on a show", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const combined = page.locator("main li[data-copies]");
    await combined.locator("h3").click({ button: "right" });
    const menu = page.locator("[data-context-menu]");
    await expect(menu).toContainText("Silver Tray (2)");
    await expect(menu.getByRole("menuitem", { name: /Add to room…/ })).toContainText("Now in Loft");
    await menu.getByRole("menuitem").first().click();
    await page.getByRole("dialog").locator("[data-pull-target]", { hasText: "Noises Off!" }).click();
    // it-tray3 is already out on the show, so it's it-tray4 ("silver  tray").
    await expect(page.locator("[data-pull-bar]")).toContainText(/Added\s+silver\s+tray\s+to Noises Off!/);
  });

  test("inside the Loft, the pair is still one row", async ({ page }) => {
    await open(page, "/inventory?place=loft&view=list");
    await expect(page.locator("main li[data-copies] h3")).toHaveText("Silver Tray (2)");
  });
});

test.describe("the grid", () => {
  test.use(DESKTOP);

  test("the tile says Silver Tray (2) and opens to both", async ({ page }) => {
    await open(page, "/inventory?view=grid");
    const tile = page.locator("[data-item-tile][data-copies]");
    await expect(tile).toHaveCount(1);
    await expect(tile.locator("h3")).toHaveText("Silver Tray (2)");
    await expect(tile).toContainText("1/2 in use");
    await tile.locator("h3").click();
    await expect(tile.locator("[data-copy]")).toHaveCount(2);
  });
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the pair opens without pushing the page sideways", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const combined = page.locator("main li[data-copies]");
    await combined.locator("h3").click();
    await expect(combined.locator("[data-copy]")).toHaveCount(2);
    await noSidewaysScroll(page);
  });
});
