import { test, expect, DESKTOP, PHONE, open, smallTapTargets, noSidewaysScroll } from "./helpers";
import type { Page } from "@playwright/test";

// Deleting a duplicate: Delete item asks "Is this a duplicate?", already set
// to the likeliest twin, and the duplicate's photos go to the item chosen
// (its extra pictures, and its own photo as one more). The twin's photos
// aren't shown anywhere, so the count in the twin's own Delete section
// ("its 2 photos") is how a test can see they arrived.
//
// In the sample theatre it5 and it6 are both "Brass candlestick".

const choice = (page: Page) => page.locator("[data-twin-choice]");
const option = (page: Page, text: string | RegExp) => choice(page).locator("label", { hasText: text });
const photosOf = async (page: Page, id: string) => {
  await open(page, `/items/${id}/edit`);
  const text = (await choice(page).locator("p").first().textContent()) ?? "";
  return /its photo will/.test(text) ? 1 : Number(/its (\d+) photos/.exec(text)?.[1] ?? 0);
};
const confirmWith = (page: Page) => {
  const asked: string[] = [];
  page.on("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.accept();
  });
  return asked;
};

test.describe("desktop", () => {
  test.use(DESKTOP);

  test("a same-named item is suggested and already chosen; its photo goes there", async ({ page }) => {
    const asked = confirmWith(page);
    expect(await photosOf(page, "it5")).toBe(1);

    await open(page, "/items/it6/edit");
    await expect(choice(page)).toContainText("Is this a duplicate?");
    await expect(choice(page)).toContainText("its photo will go to it");
    const twin = option(page, "A duplicate of Brass candlestick");
    await expect(twin).toContainText("Costume Storage · same name");
    await expect(twin.locator("input")).toBeChecked();

    await page.getByRole("button", { name: "Delete as a duplicate" }).click();
    await page.waitForURL(/\/inventory/);
    expect(asked[0]).toContain('Delete "Brass candlestick" as a duplicate of "Brass candlestick"?');
    expect(asked[0]).toContain('Its photo will go to "Brass candlestick"');
    expect(asked[0]).toContain("Recently deleted for 30 days");
    await expect(page.locator("[data-deleted-bar]")).toContainText(/Deleted\s+Brass candlestick/);

    // The twin has its own photo and the duplicate's.
    expect(await photosOf(page, "it5")).toBe(2);

    await open(page, "/theatre/deleted");
    const row = page.locator("[data-deleted-record]", { hasText: "Brass candlestick" });
    await expect(row).toContainText("a duplicate of Brass candlestick");
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(page.locator("main")).toContainText("Its photos stay with Brass candlestick");
    // Restoring the duplicate doesn't take them back.
    expect(await photosOf(page, "it5")).toBe(2);
  });

  test("“No, just delete it” moves nothing", async ({ page }) => {
    confirmWith(page);
    await open(page, "/items/it6/edit");
    await option(page, "No, just delete it").click();
    await page.getByRole("button", { name: "Delete item" }).click();
    await page.waitForURL(/\/inventory/);
    expect(await photosOf(page, "it5")).toBe(1);
    await open(page, "/theatre/deleted");
    await expect(page.locator("[data-deleted-record]", { hasText: "Brass candlestick" })).not.toContainText("duplicate");
  });

  test("nothing chosen until there's a likely twin; any item can be found by searching", async ({ page }) => {
    const asked = confirmWith(page);
    // Fishing Net has no namesake, so nothing starts chosen.
    await open(page, "/items/it8/edit");
    await expect(option(page, "No, just delete it").locator("input")).toBeChecked();
    await option(page, "A duplicate of…").click();
    const button = page.getByRole("button", { name: "Delete item" });
    await expect(button).toBeDisabled();
    await expect(page.getByText("Search for the item it duplicates first.")).toBeVisible();

    const box = page.locator("[data-twin-search] input[type=text]");
    await box.fill("tankard");
    // Enter in the search box must not submit the delete form.
    await box.press("Enter");
    await page.waitForTimeout(400);
    expect(asked).toEqual([]);
    await expect(page).toHaveURL(/\/items\/it8\/edit/);

    await page.locator("[data-twin-search] li button", { hasText: "Pewter tankard" }).first().click();
    await expect(choice(page)).toContainText("Pewter tankard");
    await page.getByRole("button", { name: "Delete as a duplicate" }).click();
    await page.waitForURL(/\/inventory/);
    expect(asked[0]).toContain('as a duplicate of "Pewter tankard"');
    expect(await photosOf(page, "it21")).toBe(2);
  });

  test("cancelling the confirm deletes and moves nothing", async ({ page }) => {
    page.on("dialog", (dialog) => void dialog.dismiss());
    await open(page, "/items/it6/edit");
    await page.getByRole("button", { name: "Delete as a duplicate" }).click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/items\/it6\/edit/);
    expect(await photosOf(page, "it5")).toBe(1);
  });

  test("an item with no photos isn't asked about", async ({ page }) => {
    // it4 (Bells) has no photo and no extra pictures: nothing to hand over.
    await open(page, "/items/it4/edit");
    await expect(choice(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete item" })).toBeEnabled();
  });
});

test.describe("with extra pictures", () => {
  test.use({ ...DESKTOP, fixtureOptions: "pictures=1" });

  test("the duplicate's extra pictures and its photo all go to the twin", async ({ page }) => {
    const asked = confirmWith(page);
    await open(page, "/items/it6/edit");
    await expect(choice(page)).toContainText("its 3 photos will go to it");
    await page.getByRole("button", { name: "Delete as a duplicate" }).click();
    await page.waitForURL(/\/inventory/);
    expect(asked[0]).toContain('Its 3 photos will go to "Brass candlestick"');
    expect(await photosOf(page, "it5")).toBe(4);
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("the choices are thumb-sized and nothing scrolls sideways", async ({ page }) => {
    await open(page, "/items/it6/edit");
    await option(page, "A duplicate of another item…").click();
    await expect(page.locator("[data-twin-search] input[type=text]")).toBeVisible();
    for (const label of await choice(page).locator("label").all()) {
      expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await smallTapTargets(page)).toEqual([]);
    await noSidewaysScroll(page);
  });
});
