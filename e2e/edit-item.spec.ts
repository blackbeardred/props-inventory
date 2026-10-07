import { test, expect, PHONE, DESKTOP, open, smallTapTargets, noSidewaysScroll } from "./helpers";

// The item page, in two columns: the item's name as the title with where
// it's kept above it, status as chips, the photo on the left with its own
// buttons, the details on the right ("Kept in" first), then twins and the
// folded-away search tags, and Delete last.

test.describe("desktop", () => {
  test.use({ ...DESKTOP, fixtureOptions: "twins=1" });

  test("title, breadcrumb and status chips", async ({ page }) => {
    await open(page, "/items/it6/edit");
    await expect(page.locator("main h1")).toHaveText("Brass candlestick");
    const crumbs = page.locator("[data-item-crumbs] a");
    await expect(crumbs).toHaveText(["Inventory", "Loft"]);
    await expect(crumbs.nth(1)).toHaveAttribute("href", "/inventory?place=loft");
    await expect(page.locator("[data-item-status]")).toContainText("Twin of Brass candlestick");
  });

  test("a nested place shows its whole trail", async ({ page }) => {
    // The basket (it3) is in the Shakespeare Box, on shelf A of Props Room A.
    await open(page, "/items/it3/edit");
    await expect(page.locator("[data-item-crumbs] a")).toHaveText(["Inventory", "Props Room A", "A", "Shakespeare Box"]);
  });

  test("on a pull list and not checked: said in the chips, linked", async ({ page }) => {
    await open(page, "/items/it8/edit");
    const status = page.locator("[data-item-status]");
    await expect(status).toContainText("Pulled for Noises Off!");
    await expect(status).toContainText("NOT CHECKED · Noises Off!");
    await expect(status.locator('a[href="/productions/prod1/checklist"]')).toHaveCount(1);
  });

  test("photo on the left, Kept in first on the right", async ({ page }) => {
    await open(page, "/items/it6/edit");
    const photo = await page.locator("[data-photo-large]").boundingBox();
    const keptIn = await page.getByText("Kept in", { exact: true }).boundingBox();
    expect(photo!.x).toBeLessThan(keptIn!.x);
    const name = await page.locator('input[name="name"]').boundingBox();
    expect(keptIn!.y).toBeLessThan(name!.y);
    await expect(page.locator("[data-search-tags]")).not.toHaveAttribute("open", "");
  });

  test("Remove is a toggle that posts removePhoto, and can be taken back", async ({ page }) => {
    await open(page, "/items/it6/edit");
    const remove = page.locator("[data-photo-large] label", { hasText: "Remove" });
    await remove.click();
    await expect(remove).toContainText("Removed when you save · keep it");
    await expect(page.locator('input[name="removePhoto"]')).toBeChecked();
    await remove.click();
    await expect(page.locator('input[name="removePhoto"]')).not.toBeChecked();
  });

  test("Replace photo opens the file picker", async ({ page }) => {
    await open(page, "/items/it6/edit");
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: "Replace photo" }).click(),
    ]);
    expect(chooser).toBeTruthy();
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("Save stays in reach at the top of the page, clear of the hexagon", async ({ page }) => {
    await open(page, "/items/it6/edit");
    const save = page.getByRole("button", { name: "Save changes" });
    await expect(save).toBeInViewport();
    const box = await save.boundingBox();
    // To the right of the thumb hexagon, above the tab bar.
    expect(box!.x).toBeGreaterThan(160);
    expect(box!.y + box!.height).toBeLessThan(844 - 56);
  });

  test("fits a phone", async ({ page }) => {
    await open(page, "/items/it6/edit");
    expect(await smallTapTargets(page)).toEqual([]);
    await noSidewaysScroll(page);
  });
});
