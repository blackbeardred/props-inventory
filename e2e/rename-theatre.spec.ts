import { test, expect, DESKTOP, open } from "./helpers";

// Owners can rename the theatre (migration 012). The sample theatre is
// "SPARC" and the signed-in person owns it.

test.use(DESKTOP);

const form = (page: import("@playwright/test").Page) => page.locator("[data-rename-theatre]");

test("an owner renames the theatre, and the new name shows", async ({ page }) => {
  await open(page, "/theatre");
  await expect(page.locator("#members h2")).toHaveText("SPARC");
  await form(page).getByLabel("Theatre name").fill("  Sparc   Repertory  ");
  await form(page).getByRole("button", { name: "Rename" }).click();
  await page.waitForURL(/notice=theatre-renamed/);
  await expect(page.locator("main")).toContainText("Renamed");
  await expect(page.locator("#members h2")).toHaveText("Sparc Repertory");
  await expect(form(page).getByLabel("Theatre name")).toHaveValue("Sparc Repertory");
});

test("a name of only spaces is refused", async ({ page }) => {
  await open(page, "/theatre");
  await form(page).getByLabel("Theatre name").fill("    ");
  await form(page).getByRole("button", { name: "Rename" }).click();
  await page.waitForURL(/error=/);
  await expect(page.locator("main")).toContainText("A theatre needs a name.");
  await expect(page.locator("#members h2")).toHaveText("SPARC");
});

test.describe("a member", () => {
  test.use({ fixtureOptions: "role=member" });
  test("sees the name but no way to change it", async ({ page }) => {
    await open(page, "/theatre");
    await expect(page.locator("#members h2")).toHaveText("SPARC");
    await expect(form(page)).toHaveCount(0);
  });
});

test.describe("before migration 012 is run", () => {
  test.use({ fixtureOptions: "pre012=1" });
  test("renaming says what to run", async ({ page }) => {
    await open(page, "/theatre");
    await form(page).getByLabel("Theatre name").fill("New name");
    await form(page).getByRole("button", { name: "Rename" }).click();
    await page.waitForURL(/error=/);
    await expect(page.locator("main")).toContainText("run migration 012");
    await expect(page.locator("#members h2")).toHaveText("SPARC");
  });
});
