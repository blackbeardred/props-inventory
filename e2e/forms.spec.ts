import { test, expect, PHONE, DESKTOP, open } from "./helpers";

// The add and edit forms: Ctrl/⌘+Enter, and arriving with a place chosen.

test.describe("desktop", () => {
  test.use(DESKTOP);

  test("Ctrl+Enter saves the edit form once; plain Enter in the notes is a new line", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(r.url());
    });
    await open(page, "/items/it0/edit");
    await expect(page.getByText(/or (Ctrl|⌘) \+ Enter/)).toBeVisible();
    await page.locator('textarea[name="description"]').click();
    await page.keyboard.type("line one");
    await page.keyboard.press("Enter");
    expect(posts, "Enter in the description doesn't save").toHaveLength(0);
    await page.keyboard.press("Control+Enter");
    await page.keyboard.press("Control+Enter");
    await page.waitForURL(/\/inventory(\?|$)/);
    expect(posts, "one save, however many presses").toHaveLength(1);
  });

  test("an empty required name stops the save; ⌘+Enter works as well", async ({ page }) => {
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(r.url());
    });
    await open(page, "/items/it0/edit");
    await page.locator('input[name="name"]').fill("");
    await page.locator('input[name="name"]').press("Control+Enter");
    await page.waitForTimeout(800);
    expect(posts).toHaveLength(0);
    await page.locator('input[name="name"]').fill("Renamed broom");
    await page.locator('input[name="name"]').press("Meta+Enter");
    await page.waitForURL(/\/inventory(\?|$)/);
    expect(posts).toHaveLength(1);
    await open(page, "/inventory?q=Renamed");
    await expect(page.locator("main")).toContainText("Renamed broom");
  });

  test("the add form has the shortcut too", async ({ page }) => {
    await open(page, "/items/new");
    await expect(page.getByText(/or (Ctrl|⌘) \+ Enter/)).toBeVisible();
  });

  test("Add item inside a place arrives with that place chosen", async ({ page }) => {
    await open(page, "/items/new?location=shelfB");
    await expect(page.locator('input[type="hidden"][name="locationId"]')).toHaveValue("shelfB");
  });

  test("Add a shelf inside a room arrives with the room chosen", async ({ page }) => {
    await open(page, "/locations/new?parent=roomA");
    await expect(page.locator('input[type="hidden"][name="parentLocationId"]')).toHaveValue("roomA");
  });
});

test.describe("phone", () => {
  test.use(PHONE);

  test("no Ctrl hint on a phone", async ({ page }) => {
    await open(page, "/items/it0/edit");
    await expect(page.getByText(/\+ Enter/)).toBeHidden();
  });
});
