import { test, expect, DESKTOP, PHONE, open, LIST_CELLS } from "./helpers";
import path from "node:path";
import type { Page } from "@playwright/test";

// Adding an item from a photo: the name, category, description and hidden
// search tags fill themselves in. (In the fixture build every real photo
// reads as "White cup", the user's own example; see e2e/fixtures.)

const PHOTO = path.join(__dirname, "fixtures", "prop-table.jpg");
// A second photo, for choosing a different one: a browser doesn't report
// the same file being picked twice.
const ANOTHER = path.join(__dirname, "fixtures", "white-cup.jpg");
const UNREADABLE = path.join(__dirname, "fixtures", "unreadable.png");
const field = (page: Page, name: string) => page.locator(`form [name="${name}"]`);
const status = (page: Page) => page.locator("[data-photo-autofill] [role=status]");

test.describe("desktop", () => {
  test.use(DESKTOP);

  test("a photo of a white cup fills in “White cup”, its description, and hidden tags that search finds", async ({ page }) => {
    await open(page, "/items/new");
    await page.locator('input[type=file][name="photo"]').setInputFiles(PHOTO);
    await expect(status(page)).toContainText("Reading the photo…");
    await expect(status(page)).toContainText("Filled in the name and description from the photo");
    await expect(field(page, "name")).toHaveValue("White cup");
    await expect(field(page, "description")).toHaveValue("Plain white ceramic cup with a curved handle, no markings.");
    await expect(field(page, "category")).toHaveValue("prop");
    await expect(field(page, "condition")).toHaveValue("");
    await expect(field(page, "name")).toHaveAttribute("data-autofilled", "");
    // The tags travel with the form but are never shown.
    const tags = JSON.parse(await field(page, "photoTags").inputValue());
    expect(tags).toContain("ceramic");
    await expect(page.getByText("ceramic", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Add item" }).click();
    await page.waitForURL(/\/inventory/);
    // "tableware" is in no name or description: only the hidden tags can find it.
    await open(page, "/inventory?q=tableware");
    await expect(page.locator("main ul > li > button", { hasText: "White cup" })).toBeVisible();
  });

  test("nothing anyone typed is overwritten", async ({ page }) => {
    await open(page, "/items/new");
    await field(page, "name").fill("Teacup");
    await field(page, "category").selectOption("costume");
    await page.locator('input[type=file][name="photo"]').setInputFiles(PHOTO);
    await expect(status(page)).toContainText("Filled in the description from the photo");
    await expect(field(page, "name")).toHaveValue("Teacup");
    await expect(field(page, "category")).toHaveValue("costume");
    await expect(field(page, "name")).not.toHaveAttribute("data-autofilled", "");
  });

  test("Undo empties what it filled; an edited field is the person's own", async ({ page }) => {
    await open(page, "/items/new");
    await page.locator('input[type=file][name="photo"]').setInputFiles(PHOTO);
    await expect(field(page, "name")).toHaveValue("White cup");
    await status(page).getByRole("button", { name: "Undo" }).click();
    await expect(field(page, "name")).toHaveValue("");
    await expect(field(page, "description")).toHaveValue("");
    expect(JSON.parse(await field(page, "photoTags").inputValue())).toEqual([]);

    // Undo can itself be undone, without choosing the photo again.
    await status(page).getByRole("button", { name: "Fill in from the photo again" }).click();
    await expect(field(page, "name")).toHaveValue("White cup");
    expect(JSON.parse(await field(page, "photoTags").inputValue())).toContain("ceramic");

    // Edit the name: the mark goes, and a different photo leaves it alone.
    await field(page, "name").fill("White cup, chipped");
    await expect(field(page, "name")).not.toHaveAttribute("data-autofilled", "");
    await field(page, "description").fill("");
    await page.locator('input[type=file][name="photo"]').setInputFiles(ANOTHER);
    await expect(status(page)).toContainText("Filled in the description from the photo");
    await expect(field(page, "name")).toHaveValue("White cup, chipped");
  });

  test("a photo it can't read leaves the form as it was", async ({ page }) => {
    await open(page, "/items/new");
    await page.locator('input[type=file][name="photo"]').setInputFiles(UNREADABLE);
    await expect(status(page)).toContainText("Couldn’t read the photo, so fill in the details yourself.");
    await expect(field(page, "name")).toHaveValue("");
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("hexagon → Take picture → Add as a new prop arrives already filled in", async ({ page }) => {
    await open(page, "/inventory");
    await page.locator("[data-quick-actions] button[data-hex-toggle]").click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("menuitem", { name: /Take picture/ }).click(),
    ]);
    await chooser.setFiles(PHOTO);
    await page.getByRole("menuitem", { name: /Add as a new prop/ }).click();
    await page.waitForURL("**/items/new");
    await expect(field(page, "name")).toHaveValue("White cup");
    await expect(status(page)).toContainText("Filled in");
  });

  test("the photo comes first on the form", async ({ page }) => {
    await open(page, "/items/new");
    const photoTop = await page.locator('input[type=file][name="photo"]').evaluate((el) => el.closest("label, div")!.getBoundingClientRect().top);
    const nameTop = await field(page, "name").evaluate((el) => el.getBoundingClientRect().top);
    expect(photoTop).toBeLessThan(nameTop);
  });
});

test.describe("the item list", () => {
  test.use(DESKTOP);

  test("never shows the hidden tags", async ({ page }) => {
    await open(page, "/items/new");
    await page.locator('input[type=file][name="photo"]').setInputFiles(PHOTO);
    await expect(field(page, "name")).toHaveValue("White cup");
    await page.getByRole("button", { name: "Add item" }).click();
    await page.waitForURL(/\/inventory/);
    await open(page, "/inventory?view=list");
    const cup = page.locator(LIST_CELLS, { hasText: "White cup" });
    await cup.locator("h3").click();
    await expect(cup).not.toContainText("tableware");
  });
});
