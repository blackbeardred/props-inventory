import { test, expect, DESKTOP, open, LIST_CELLS } from "./helpers";
import type { Page } from "@playwright/test";

// Importing a spreadsheet that's already been imported asks first: a row is
// "already here" when an item has the same name in the same place
// (src/lib/import-duplicates.ts). In the sample theatre, Silver Tray and
// Bells are loose in Props Room A, Basket is in the Shakespeare Box, Yorick's
// skull is unfiled, and Wooden chair is in the Loft.

test.use(DESKTOP);

const ask = (page: Page) => page.locator("[data-import-duplicates]");

async function upload(page: Page, csv: string) {
  await open(page, "/items/import");
  await page.locator('input[type="file"]').setInputFiles({
    name: "props.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByRole("button", { name: /^Import \d+ items?$/ })).toBeVisible();
}

const cells = (page: Page, name: string) =>
  page.locator(LIST_CELLS, { has: page.locator("h3", { hasText: new RegExp(`^${name}$`) }) });

test("a sheet with some rows already here: import only the new ones", async ({ page }) => {
  await upload(
    page,
    [
      "Name,Location",
      "Silver Tray,Props Room A",
      "Bells,Props Room A",
      "Yorick's skull,",
      "Basket,Props Room A / A / Shakespeare Box",
      "Wooden chair,Props Room A",
      "Velvet throne,Loft",
    ].join("\n")
  );
  await page.getByRole("button", { name: "Import 6 items" }).click();
  await expect(ask(page)).toContainText("4 of these 6 rows are already in your inventory");
  await expect(ask(page).locator("li")).toHaveCount(4);
  await expect(ask(page)).toContainText("Silver Tray · Props Room A");
  await expect(ask(page)).toContainText("Yorick's skull · not filed anywhere");
  await expect(ask(page)).toContainText("Basket · Props Room A / A / Shakespeare Box");
  // The chair in the sheet is in Props Room A; the one we have is in the Loft.
  await expect(ask(page)).not.toContainText("Wooden chair");

  await ask(page).getByRole("button", { name: "Import only the 2 new ones" }).click();
  await page.waitForURL(/\/inventory\?/);
  await expect(page.locator("main")).toContainText("Imported 2 items");
  await expect(page.locator("main")).toContainText("Left out 4 rows already in your inventory.");
  await open(page, "/inventory?view=list");
  await expect(cells(page, "Velvet throne")).toHaveCount(1);
  await expect(cells(page, "Wooden chair")).toHaveCount(2);
  await expect(cells(page, "Bells")).toHaveCount(1);
  await expect(cells(page, "Basket")).toHaveCount(1);
});

test("the same file twice: it says so, Cancel stops, and it can still be forced", async ({ page }) => {
  const csv = ["Name,Location", "Bells,Props Room A", "Basket,Props Room A / A / Shakespeare Box"].join("\n");
  await upload(page, csv);
  await page.getByRole("button", { name: "Import 2 items" }).click();
  await expect(ask(page)).toContainText("You’ve already imported this");
  await expect(ask(page).getByRole("button", { name: /new ones?$/ })).toHaveCount(0);

  await ask(page).getByRole("button", { name: "Cancel" }).click();
  await expect(ask(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Import 2 items" })).toBeEnabled();

  await page.getByRole("button", { name: "Import 2 items" }).click();
  await ask(page).getByRole("button", { name: "Import all 2 again anyway" }).click();
  await page.waitForURL(/\/inventory\?/);
  await expect(page.locator("main")).toContainText("Imported 2 items");
  await open(page, "/inventory?view=list");
  await expect(cells(page, "Bells")).toHaveCount(2);
});

test("all duplicates too: imports everything, asked or not", async ({ page }) => {
  await upload(page, ["Name,Location", "Bells,Props Room A", "Brand new lamp,Loft"].join("\n"));
  await page.getByRole("button", { name: "Import 2 items" }).click();
  await ask(page).getByRole("button", { name: "Import all 2, duplicates too" }).click();
  await page.waitForURL(/\/inventory\?/);
  await expect(page.locator("main")).toContainText("Imported 2 items");
  await expect(page.locator("main")).not.toContainText("Left out");
});

test("nothing already here: no question, it just imports", async ({ page }) => {
  await upload(page, ["Name,Location", "Brand new lamp,Loft", "Another stool,"].join("\n"));
  await page.getByRole("button", { name: "Import 2 items" }).click();
  await page.waitForURL(/\/inventory\?/);
  await expect(page.locator("main")).toContainText("Imported 2 items");
});

test("changing the columns after asking takes the question away", async ({ page }) => {
  await upload(page, ["Name,Where", "Bells,Props Room A"].join("\n"));
  // "Where" is guessed as the location; Bells in Props Room A is already here.
  await page.getByRole("button", { name: "Import 1 item" }).click();
  await expect(ask(page)).toBeVisible();
  await page.locator("select").nth(1).selectOption("");
  await expect(ask(page)).toHaveCount(0);
});
