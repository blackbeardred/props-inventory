import { test, expect, DESKTOP, open } from "./helpers";

// Search tags for items that never went through the item form (imports, the
// test links' sample theatre): filled in in the background, a few at a time.
// The fixture tagger answers only with tagging=1, and tags an item with its
// name's words, "tagged", and "wood" for anything oak, pine or mahogany.

test.use(DESKTOP);

async function matches(page: import("@playwright/test").Page, term: string) {
  const box = page.locator("main input[type=text]");
  await box.fill("");
  await box.fill(term);
  const summary = page.locator("main", { hasText: new RegExp(`(\\d+|No) match(es)? for “${term}”`) });
  await expect(summary).toBeVisible();
  const text = await page.locator("main").innerText();
  const m = text.match(new RegExp(`(\\d+) match(?:es)? for “${term}”`));
  return m ? Number(m[1]) : 0;
}

test.describe("with a tagger", () => {
  test.use({ fixtureOptions: "tagging=1" });

  test("untagged items get tags on their own, and a search for wood finds the oak chair", async ({ page }) => {
    await open(page, "/inventory?view=list");
    expect(await matches(page, "tagged")).toBe(0);
    // 21 of the 22 sample items start untagged (the Silver Tray has tags).
    await expect.poll(() => matches(page, "tagged"), { timeout: 30_000, intervals: [2000] }).toBe(21);
    await page.locator("main input[type=text]").fill("wood");
    await expect(page.locator("main")).toContainText("Ladderback chair, carved oak");
    // An item that already had tags keeps them.
    expect(await matches(page, "metal")).toBeGreaterThanOrEqual(1);
  });
});

test("with no tagger (no key, spend limit), it gives up quietly for the visit", async ({ page }) => {
  await open(page, "/inventory?view=list");
  await page.waitForTimeout(4500);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("tags-caught-up:")).length)).toBe(1);
  expect(await matches(page, "tagged")).toBe(0);
});

test.describe("Refresh all search tags (Theatre)", () => {
  test.use({ fixtureOptions: "tagging=1" });

  test("an owner re-tags every item, with progress", async ({ page }) => {
    await open(page, "/theatre");
    const section = page.locator("#tags");
    await expect(section).toContainText("what it’s made of and its colours");
    await section.getByRole("button", { name: "Refresh all search tags" }).click();
    await expect(section.getByRole("status")).toContainText("Done: all 22 items have fresh tags.", { timeout: 30_000 });
    await open(page, "/inventory?view=list");
    // Every item now carries the fixture tagger's mark, the Silver Tray included.
    expect(await matches(page, "tagged")).toBe(22);
  });
});

test.describe("Refresh all search tags, as a member", () => {
  test.use({ fixtureOptions: "role=member" });

  test("is for owners", async ({ page }) => {
    await open(page, "/theatre");
    await expect(page.locator("#tags")).toContainText("An owner can refresh every item’s tags here.");
    await expect(page.locator("#tags button")).toHaveCount(0);
  });
});

test("with no tagger, refreshing stops and says why", async ({ page }) => {
  await open(page, "/theatre");
  await page.locator("#tags").getByRole("button", { name: "Refresh all search tags" }).click();
  await expect(page.locator("#tags").getByRole("status")).toContainText("Stopped after 0 of 22", { timeout: 20_000 });
  await expect(page.locator("#tags").getByRole("status")).toContainText("API key");
});
