import { test, expect, DESKTOP, PHONE, open, smallTapTargets, noSidewaysScroll } from "./helpers";
import path from "node:path";
import type { Page } from "@playwright/test";

// Twins: props the theatre owns more than one of, that look exactly alike
// (migration 009). In the sample theatre it5 and it6 are both "Brass
// candlestick"; the fixture option twins=1 links them, and pictures=1 gives
// it6 two extra pictures. it5 is already on Noises Off!'s pull list (pli2).

const PHOTO = path.join(__dirname, "fixtures", "white-cup.jpg");
const PROP_TABLE = path.join(__dirname, "fixtures", "prop-table.jpg");
const panel = (page: Page) => page.locator("[data-twins]");
const confirmWith = (page: Page) => {
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  return asked;
};

test.describe("linking (desktop)", () => {
  test.use(DESKTOP);

  test("a same-named item is suggested; linking shows on both", async ({ page }) => {
    await open(page, "/items/it5/edit");
    await expect(panel(page)).toContainText("Link a twin");
    await expect(panel(page).locator("[data-twin]")).toHaveCount(0);
    const suggestion = panel(page).locator("[data-twin-suggestion]", { hasText: "Brass candlestick" });
    await expect(suggestion).toContainText("same name");
    await suggestion.getByRole("button", { name: "Link as twin" }).click();

    await expect(page.locator("main")).toContainText("Linked as a twin of Brass candlestick");
    await expect(panel(page).locator("[data-twin]")).toHaveCount(1);
    await expect(panel(page).locator("[data-twin] a")).toHaveAttribute("href", "/items/it6/edit");

    await open(page, "/items/it6/edit");
    await expect(panel(page).locator("[data-twin] a")).toHaveAttribute("href", "/items/it5/edit");
    // Not suggested again once it's a twin.
    await expect(panel(page).locator("[data-twin-suggestion]", { hasText: "Brass candlestick" })).toHaveCount(0);
  });

  test("any item can be found by searching and linked", async ({ page }) => {
    await open(page, "/items/it5/edit");
    await panel(page).getByRole("button", { name: /Find a different item/ }).click();
    const box = panel(page).locator("[data-twin-search] input[type=text]");
    await box.fill("tankard");
    // Enter takes it as a search word and closes the suggestions over the
    // results. There's no form round the search, so nothing is submitted.
    await box.press("Enter");
    await expect(page).toHaveURL(/\/items\/it5\/edit/);
    await panel(page).locator("[data-twin-search] button", { hasText: "Pewter tankard" }).first().click();
    await panel(page).getByRole("button", { name: "Link as twin" }).last().click();
    await expect(page.locator("main")).toContainText("Linked as a twin of Pewter tankard");
  });

  test.describe("already twins", () => {
    test.use({ fixtureOptions: "twins=1&pictures=1" });

    test("one can leave; the other is then alone", async ({ page }) => {
      await open(page, "/items/it5/edit");
      await expect(panel(page).locator("[data-twin]")).toHaveCount(1);
      await panel(page).getByRole("button", { name: "Brass candlestick isn’t a twin after all" }).click();
      await expect(page.locator("main")).toContainText("No longer a twin");
      await expect(panel(page).locator("[data-twin]")).toHaveCount(0);
      await open(page, "/items/it6/edit");
      await expect(panel(page).locator("[data-twin]")).toHaveCount(0);
    });

    test("deleting a twin gives its photos to the other, and restoring rejoins them", async ({ page }) => {
      const asked = confirmWith(page);
      await open(page, "/items/it5/edit");
      // Before: the other twin has its own photo only.
      await expect(page.locator("[data-twin-handover]")).toContainText("its photo to its twin");

      await open(page, "/items/it6/edit");
      await expect(page.locator("[data-twin-handover]")).toContainText("its 3 photos to its twin, Brass candlestick");
      await page.getByRole("button", { name: "Delete item" }).click();
      await page.waitForURL(/\/inventory/);
      expect(asked[0]).toContain("Its photos will go to its twin");

      await open(page, "/items/it5/edit");
      await expect(panel(page).locator("[data-twin]")).toHaveCount(0);

      await open(page, "/theatre/deleted");
      const row = page.locator("[data-deleted-record]", { hasText: "Brass candlestick" });
      await expect(row).toContainText("a twin of Brass candlestick");
      await row.getByRole("button", { name: "Restore" }).click();
      await expect(page.locator("main")).toContainText("a twin of Brass candlestick again");

      // Twins again, and the one that stayed now holds everything: its own
      // photo plus the three it was given.
      await open(page, "/items/it5/edit");
      await expect(panel(page).locator("[data-twin]")).toHaveCount(1);
      await expect(page.locator("[data-twin-handover]")).toContainText("its 4 photos");
    });

    test("an item that isn't a twin deletes as before", async ({ page }) => {
      const asked = confirmWith(page);
      await open(page, "/items/it21/edit");
      await expect(page.locator("[data-twin-handover]")).toHaveCount(0);
      await page.getByRole("button", { name: "Delete item" }).click();
      await page.waitForURL(/\/inventory/);
      expect(asked[0]).not.toContain("twin");
    });
  });
});

test.describe("Add item asks", () => {
  test.use(DESKTOP);

  test("“Is this another one?” when the name matches; yes links it", async ({ page }) => {
    await open(page, "/items/new");
    await page.locator('form [name="name"]').fill("brass candlestick");
    const offer = page.locator("[data-twin-offer]");
    await expect(offer).toContainText("Is this another one?", { timeout: 10_000 });
    await expect(offer.locator("[data-twin-offer-item]")).toHaveCount(2);
    await expect(offer).toContainText("same name");
    await offer.locator("[data-twin-offer-item]").first().getByRole("button", { name: "Yes, another one" }).click();
    await expect(offer).toContainText("Will be linked as a twin of Brass candlestick");

    await page.getByRole("button", { name: "Add item" }).click();
    await page.waitForURL(/\/inventory/);
    await open(page, "/items/it5/edit");
    await expect(panel(page).locator("[data-twin]")).toHaveCount(1);
  });

  test("No leaves it alone; nothing is linked", async ({ page }) => {
    await open(page, "/items/new");
    await page.locator('form [name="name"]').fill("Brass candlestick");
    const offer = page.locator("[data-twin-offer]");
    await expect(offer).toContainText("Is this another one?", { timeout: 10_000 });
    await offer.getByRole("button", { name: "No, it’s a different prop" }).click();
    await expect(offer).not.toContainText("Is this another one?");
    await expect(offer.locator('input[name="twinOf"]')).toHaveCount(0);
  });

  test("a name nobody else has asks nothing", async ({ page }) => {
    await open(page, "/items/new");
    await page.locator('form [name="name"]').fill("Spinning wheel");
    await page.waitForTimeout(1200);
    await expect(page.locator("[data-twin-offer]")).not.toContainText("Is this another one?");
  });

  test("a near-identical photo asks too, on a device with the model", async ({ page }) => {
    await open(page, "/items/new");
    await page.evaluate(() => {
      const g = globalThis as unknown as { __modelCached: boolean; __matchItems: unknown };
      g.__modelCached = true;
      g.__matchItems = [{ item_id: "it21", similarity: 0.95 }, { item_id: "it7", similarity: 0.6 }];
    });
    await page.locator('input[type=file][name="photo"]').setInputFiles(PHOTO);
    const offer = page.locator("[data-twin-offer]");
    await expect(offer.locator("[data-twin-offer-item]", { hasText: "Pewter tankard" })).toContainText(
      "its photo looks just like this one",
      { timeout: 10_000 }
    );
    // A distant match isn't offered.
    await expect(offer).not.toContainText("Chalice");
  });
});

test.describe("photos of twins", () => {
  test.use({ fixtureOptions: "twins=1" });

  test.describe("desktop", () => {
    test.use(DESKTOP);

    test("Find by photo lists both, and says they're twins", async ({ page }) => {
      await open(page, "/items/lookalike");
      // The browser's copy of the sample theatre is its own, so the pair is
      // linked there too.
      await page.evaluate(() => {
        const g = globalThis as unknown as { __matchItems: unknown; __fixtureDB: Record<string, unknown[]> };
        g.__matchItems = [
          { item_id: "it5", similarity: 0.93 },
          { item_id: "it6", similarity: 0.93 },
        ];
        g.__fixtureDB.item_twins.push(
          { item_id: "it5", org_id: "org1", twin_set: "set-candles" },
          { item_id: "it6", org_id: "org1", twin_set: "set-candles" }
        );
      });
      await page.locator("input[type=file]").setInputFiles(PHOTO);
      await expect(page.locator("[data-twins-note]")).toBeVisible({ timeout: 15_000 });
      await expect(page.locator("[data-twin-of]")).toHaveCount(2);
      await expect(page.locator("[data-twin-of]").first()).toContainText("Twin of Brass candlestick");
    });
  });

  test.describe("phone", () => {
    test.use(PHONE);

    test("the prop table marks the twin that's free", async ({ page }) => {
      await open(page, "/productions/prod1/photo");
      await page.locator("input[type=file]").first().setInputFiles(PROP_TABLE);
      const candle = page.locator('select[aria-label="Which item is “brass candlestick”"]');
      await expect(candle).toHaveCount(1, { timeout: 20_000 });
      // it5 is already on this production's list, so its twin is proposed.
      await expect(candle).toHaveValue("it6");
      await expect(candle.locator('option[value="it5"]')).toContainText("twin · already on this list");
      // Choosing the busy one by hand is still allowed, and sticks.
      await candle.selectOption("it5");
      await expect(candle).toHaveValue("it5");
    });

    test("the Twins section fits a phone", async ({ page }) => {
      await open(page, "/items/it5/edit");
      await panel(page).scrollIntoViewIfNeeded();
      expect(await smallTapTargets(page)).toEqual([]);
      await noSidewaysScroll(page);
    });
  });
});
