import { test, expect, DESKTOP, PHONE, open, noSidewaysScroll, LIST_CELLS } from "./helpers";
import type { Page } from "@playwright/test";

// Recently Deleted: everything deletable waits 30 days, with Undo right
// after the delete and Restore from Theatre → Recently deleted.

const bar = (page: Page) => page.locator("[data-deleted-bar]");
const records = (page: Page) => page.locator("[data-deleted-record]");
const record = (page: Page, label: string) => records(page).filter({ hasText: label });
const cell = (page: Page, name: string) =>
  page.locator(LIST_CELLS, { has: page.locator("h3", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) });
const acceptConfirms = (page: Page) => page.on("dialog", (dialog) => void dialog.accept());

async function deleteItem(page: Page, id: string) {
  await open(page, `/items/${id}/edit`);
  await page.getByRole("button", { name: "Delete item" }).click();
  await page.waitForURL(/\/inventory/);
}

test.describe("desktop", () => {
  test.use(DESKTOP);

  test("deleting an item says it can be restored, then offers Undo", async ({ page }) => {
    let asked = "";
    page.on("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.accept();
    });
    await deleteItem(page, "it8");
    expect(asked).toContain("Recently deleted for 30 days");
    await expect(bar(page)).toContainText(/Deleted\s+Fishing Net/);
    // Out of the address straight away, so a reload doesn't offer it twice.
    await expect(page).not.toHaveURL(/deleted=/);
    await open(page, "/inventory?view=list");
    await expect(cell(page, "Fishing Net")).toHaveCount(0);
  });

  test("Undo puts an item back, pull-list line and all", async ({ page }) => {
    acceptConfirms(page);
    await deleteItem(page, "it8");
    await bar(page).getByRole("button", { name: "Undo" }).click();
    await expect(bar(page)).toContainText(/Restored\s+Fishing Net/);
    await expect(page.locator(LIST_CELLS, { hasText: "Fishing Net" })).toHaveCount(1);
    await open(page, "/productions/prod1");
    const line = page.locator("[data-pull-row]", { hasText: "Fishing Net" });
    await expect(line).toHaveCount(1);
    await expect(line.locator('button[aria-pressed="true"]')).toHaveText("Pulled");
    await open(page, "/theatre/deleted");
    await expect(records(page)).toHaveCount(0);
  });

  test("Recently deleted lists it with where it was, and Restore brings it back", async ({ page }) => {
    acceptConfirms(page);
    await deleteItem(page, "it0");
    await open(page, "/theatre/deleted");
    const row = record(page, "Antique Brass Broom");
    await expect(row).toContainText("Item");
    await expect(row).toContainText("Props Room A / A");
    await expect(row).toContainText(/Deleted today by testname/);
    await expect(row).toContainText("gone for good in 30 days");
    await row.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Restored Antique Brass Broom")).toBeVisible();
    await expect(records(page)).toHaveCount(0);
    await page.getByRole("link", { name: "Go to it →" }).click();
    await page.waitForURL(/\/items\/it0\/edit/);
  });

  test("a place: its shelves and items move out, and go back in when it's restored", async ({ page }) => {
    acceptConfirms(page);
    await open(page, "/locations/roomA/edit");
    await page.getByRole("button", { name: "Delete location" }).click();
    await page.waitForURL(/\/inventory/);
    await expect(bar(page)).toContainText(/Deleted\s+Props Room A/);
    const tiles = page.locator('ul[aria-label="Places in here"] a[href^="/inventory?place="]');
    // Its two shelves are rooms of their own now.
    await expect(tiles.filter({ hasText: /^A/ })).toHaveCount(1);
    await open(page, "/theatre/deleted");
    await expect(record(page, "Props Room A")).toContainText("2 places and 3 items were in it");
    await record(page, "Props Room A").getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Restored Props Room A")).toBeVisible();
    await open(page, "/inventory");
    await expect(tiles).toHaveCount(4);
    await open(page, "/inventory?place=roomA&view=list");
    await expect(tiles).toHaveCount(2);
    await expect(page.locator(LIST_CELLS)).toHaveCount(12);
  });

  test("a production comes back with its pull list and every line", async ({ page }) => {
    acceptConfirms(page);
    await open(page, "/productions/prod1/edit");
    await page.getByRole("button", { name: /Delete production/ }).click();
    await page.waitForURL(/\/productions(\?|$)/);
    await expect(bar(page)).toContainText(/Deleted\s+Noises Off!/);
    await open(page, "/theatre/deleted");
    await expect(record(page, "Noises Off!")).toContainText("1 pull list, 3 lines");
    await record(page, "Noises Off!").getByRole("button", { name: "Restore" }).click();
    await open(page, "/productions/prod1");
    await expect(page.locator("[data-pull-row]")).toHaveCount(3);
  });

  test("a list can't come back before its production; restoring both in order works", async ({ page }) => {
    acceptConfirms(page);
    await open(page, "/productions/prod1");
    await page.getByRole("button", { name: "Delete this list" }).click();
    await page.waitForURL(/\/productions\/prod1/);
    await open(page, "/productions/prod1/edit");
    await page.getByRole("button", { name: /Delete production/ }).click();
    await page.waitForURL(/\/productions(\?|$)/);
    await open(page, "/theatre/deleted");
    await expect(record(page, "Pull List")).toContainText("from Noises Off! · 3 lines");
    await record(page, "Pull List").getByRole("button", { name: "Restore" }).click();
    await expect(page.locator("main")).toContainText("Restore that first");
    await records(page).filter({ hasText: /^Production/ }).getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Restored Noises Off!")).toBeVisible();
    await record(page, "Pull List").getByRole("button", { name: "Restore" }).click();
    await expect(records(page)).toHaveCount(0);
    await open(page, "/productions/prod1");
    await expect(page.locator("[data-pull-row]")).toHaveCount(3);
  });

  test("an owner can delete something forever", async ({ page }) => {
    acceptConfirms(page);
    await deleteItem(page, "it0");
    await open(page, "/theatre/deleted");
    await record(page, "Antique Brass Broom").getByRole("button", { name: "Delete forever" }).click();
    await expect(page.getByText("Antique Brass Broom is gone for good")).toBeVisible();
    await expect(records(page)).toHaveCount(0);
  });

  test("Theatre links to it, with how many are waiting", async ({ page }) => {
    acceptConfirms(page);
    await deleteItem(page, "it0");
    await open(page, "/theatre");
    const link = page.locator("#deleted a[href='/theatre/deleted']");
    await expect(link).toContainText("1");
    await link.click();
    await page.waitForURL(/\/theatre\/deleted/);
    await expect(page.locator('nav[aria-label="Main"] a[aria-current="page"]').first()).toHaveText("Theatre");
  });
});

test.describe("after 30 days", () => {
  test.use({ ...DESKTOP, fixtureOptions: "deleted=old" });

  test("anything past its time is cleared when the list is opened", async ({ page }) => {
    await open(page, "/theatre/deleted");
    await expect(record(page, "Spare lantern")).toContainText("gone for good in 20 days");
    await expect(record(page, "Broken umbrella")).toHaveCount(0);
    await expect(records(page)).toHaveCount(1);
  });
});

test.describe("as a member", () => {
  test.use({ ...DESKTOP, fixtureOptions: "role=member" });

  test("can restore, but not delete forever", async ({ page }) => {
    acceptConfirms(page);
    await deleteItem(page, "it0");
    await open(page, "/theatre/deleted");
    await expect(record(page, "Antique Brass Broom").getByRole("button", { name: "Restore" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete forever" })).toHaveCount(0);
    await expect(page.getByText(/Only an owner can delete something forever/)).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("removing a pull-list line doesn't ask; Undo puts it straight back", async ({ page }) => {
    let asked = false;
    page.on("dialog", (dialog) => {
      asked = true;
      void dialog.accept();
    });
    await open(page, "/productions/prod1");
    const line = page.locator("[data-pull-row]", { hasText: "Brass candlestick" });
    await line.getByRole("button", { name: "Remove" }).click();
    await expect(bar(page)).toContainText(/Deleted\s+Brass candlestick/);
    expect(asked).toBe(false);
    await expect(line).toHaveCount(0);
    await bar(page).getByRole("button", { name: "Undo" }).click();
    await expect(bar(page)).toContainText(/Restored\s+Brass candlestick/);
    await expect(line).toHaveCount(1);
    await expect(line.locator('button[aria-pressed="true"]')).toHaveText("Pending");
  });

  test("the page fits a phone", async ({ page }) => {
    acceptConfirms(page);
    await deleteItem(page, "it0");
    await open(page, "/theatre/deleted");
    await noSidewaysScroll(page);
    await expect(record(page, "Antique Brass Broom").getByRole("button", { name: "Restore" })).toBeVisible();
  });
});
