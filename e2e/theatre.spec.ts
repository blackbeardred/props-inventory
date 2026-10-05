import { test, expect, PHONE, open, noSidewaysScroll } from "./helpers";

// Theatre: what used to be Account and Organization.

test.use(PHONE);

test("every section is there, with the invite code", async ({ page }) => {
  await open(page, "/theatre");
  for (const id of ["members", "photos", "theatres", "you"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await expect(page.getByText("163ECD01").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(1);
  await expect(page.locator('a[href="/items/fingerprints"]')).toHaveCount(1);
  await expect(page.locator('a[href="/items/lookalike"]')).toHaveCount(1);
  await expect(page.getByText(/Install the app|Installed on this device/).first()).toBeVisible();
  await noSidewaysScroll(page);
});

test("the avatar in the header goes here", async ({ page }) => {
  await open(page, "/inventory");
  await page.locator('header a[href^="/theatre"]:visible').first().click();
  await page.waitForURL(/\/theatre/);
});

test("the fingerprint page counts what's outstanding", async ({ page }) => {
  await open(page, "/items/fingerprints");
  await expect(page.locator("main")).not.toContainText("Couldn't read the inventory");
  await expect(page.locator("main h1")).toBeVisible();
});
