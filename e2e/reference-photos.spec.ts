import { test, expect, DESKTOP, PHONE, open, smallTapTargets } from "./helpers";
import path from "node:path";
import type { Page } from "@playwright/test";

// A photo someone confirms as one of the theatre's items is kept as another
// picture of it (migration 008): "That's it" on Find by photo, or a ticked
// match on the prop-table screen. Only confirmed matches, and never shown.
//
// These pictures are written from the browser, so the checks read the
// browser's own copy of the sample theatre (window.__fixtureDB) and the
// files it uploaded (window.__storage). Picture matches are opt-in in the
// fixture build: a test sets window.__matchItems before choosing a photo.

const PHOTO = path.join(__dirname, "fixtures", "white-cup.jpg");
const PROP_TABLE = path.join(__dirname, "fixtures", "prop-table.jpg");

type Picture = {
  item_id: string;
  org_id: string;
  photo_path: string;
  source: string;
  similarity: number | null;
  embedding: string | null;
  created_by: string;
};

const pictures = (page: Page) =>
  page.evaluate(
    () =>
      ((globalThis as unknown as { __fixtureDB?: Record<string, unknown[]> }).__fixtureDB
        ?.item_reference_photos ?? []) as Picture[]
  );
const uploaded = (page: Page) =>
  page.evaluate(
    () => (globalThis as unknown as { __storage?: { uploaded: string[] } }).__storage?.uploaded ?? []
  );
const matchesWillBe = (page: Page, matches: { item_id: string; similarity: number }[]) =>
  page.evaluate((m) => {
    (globalThis as unknown as { __matchItems: unknown }).__matchItems = m;
  }, matches);
const result = (page: Page, name: string) => page.locator("main li", { hasText: name });

test.describe("Find by photo", () => {
  test.use(DESKTOP);

  test("“That’s it” keeps the photo as another picture of that item, fingerprint and all", async ({ page }) => {
    await open(page, "/items/lookalike");
    await matchesWillBe(page, [
      { item_id: "it21", similarity: 0.88 },
      { item_id: "it7", similarity: 0.71 },
    ]);
    await page.locator("input[type=file]").setInputFiles(PHOTO);
    await expect(result(page, "Pewter tankard")).toContainText("88% alike", { timeout: 15_000 });
    await expect(page.getByText("Found it? Tap That’s it")).toBeVisible();
    expect(await pictures(page)).toEqual([]);

    await result(page, "Pewter tankard").getByRole("button", { name: "That’s it" }).click();
    await expect(result(page, "Pewter tankard").locator("[data-confirmed-match]")).toHaveText("✓ That’s it — thanks");
    // One photo is one thing: the others can't be chosen as well.
    await expect(result(page, "Chalice, pewter").getByRole("button", { name: "That’s it" })).toBeDisabled();

    const kept = await pictures(page);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ item_id: "it21", org_id: "org1", source: "find_by_photo", similarity: 0.88, created_by: "u1" });
    expect(kept[0].photo_path).toMatch(/^org1\/it21\/ref-[0-9a-f-]+\.jpg$/);
    // The search already fingerprinted the photo, so it isn't done twice.
    expect(kept[0].embedding).toMatch(/^\[1\.000000,0\.000000,/);
    expect(await uploaded(page)).toEqual([kept[0].photo_path]);
  });

  test("nothing is kept until someone says which it is", async ({ page }) => {
    await open(page, "/items/lookalike");
    await matchesWillBe(page, [{ item_id: "it21", similarity: 0.97 }]);
    await page.locator("input[type=file]").setInputFiles(PHOTO);
    await expect(result(page, "Pewter tankard")).toContainText("Almost certainly this", { timeout: 15_000 });
    await page.waitForTimeout(500);
    expect(await pictures(page)).toEqual([]);
    expect(await uploaded(page)).toEqual([]);
  });

  test("the item’s own photo, chosen again, isn’t kept twice", async ({ page }) => {
    await open(page, "/items/lookalike");
    await matchesWillBe(page, [{ item_id: "it21", similarity: 0.996 }]);
    await page.locator("input[type=file]").setInputFiles(PHOTO);
    await result(page, "Pewter tankard").getByRole("button", { name: "That’s it" }).click({ timeout: 15_000 });
    await expect(result(page, "Pewter tankard").locator("[data-confirmed-match]")).toHaveText("✓ That’s it — thanks");
    expect(await pictures(page)).toEqual([]);
    expect(await uploaded(page)).toEqual([]);
  });

  test("a new photo starts over", async ({ page }) => {
    await open(page, "/items/lookalike");
    await matchesWillBe(page, [{ item_id: "it21", similarity: 0.8 }]);
    await page.locator("input[type=file]").setInputFiles(PHOTO);
    await result(page, "Pewter tankard").getByRole("button", { name: "That’s it" }).click({ timeout: 15_000 });
    await expect(result(page, "Pewter tankard").locator("[data-confirmed-match]")).toBeVisible();
    await page.locator("input[type=file]").setInputFiles(PROP_TABLE);
    await expect(result(page, "Pewter tankard").getByRole("button", { name: "That’s it" })).toBeEnabled({ timeout: 15_000 });
  });

  test("the pictures are never shown: not on the item, not in the inventory", async ({ page }) => {
    await open(page, "/items/lookalike");
    await matchesWillBe(page, [{ item_id: "it21", similarity: 0.8 }]);
    await page.locator("input[type=file]").setInputFiles(PHOTO);
    await result(page, "Pewter tankard").getByRole("button", { name: "That’s it" }).click({ timeout: 15_000 });
    await expect(result(page, "Pewter tankard").locator("[data-confirmed-match]")).toHaveText("✓ That’s it — thanks");
    const path_ = (await pictures(page))[0].photo_path;
    for (const where of ["/items/it21/edit", "/inventory?view=grid", "/inventory"]) {
      await open(page, where);
      expect(await page.content(), where).not.toContain("ref-");
      expect(await page.content(), where).not.toContain(path_);
    }
  });
});

test.describe("Find by photo (phone)", () => {
  test.use(PHONE);

  test("the button is thumb-sized and the page doesn’t scroll sideways", async ({ page }) => {
    await open(page, "/items/lookalike");
    await matchesWillBe(page, [
      { item_id: "it21", similarity: 0.88 },
      { item_id: "it7", similarity: 0.71 },
    ]);
    await page.locator("input[type=file]").setInputFiles(PHOTO);
    const button = result(page, "Pewter tankard").getByRole("button", { name: "That’s it" });
    await expect(button).toBeVisible({ timeout: 15_000 });
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(await smallTapTargets(page)).toEqual([]);
    const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
    expect(scroll).toBeLessThanOrEqual(width);
  });
});

test.describe("the prop-table screen", () => {
  test.use(PHONE);

  test("a ticked match keeps its crop as another picture of that item; skipped and new ones don’t", async ({ page }) => {
    await open(page, "/productions/prod1/photo");
    // A device that already holds the model compares the crops by picture
    // straight away, so the kept crops arrive fingerprinted.
    await page.evaluate(() => {
      (globalThis as unknown as { __modelCached: boolean }).__modelCached = true;
    });
    await matchesWillBe(page, [{ item_id: "it21", similarity: 0.93 }]);
    await page.locator("input[type=file]").first().setInputFiles(PROP_TABLE);
    const selects = page.locator('select[aria-label^="Which item"]');
    await expect(selects).toHaveCount(4, { timeout: 20_000 });
    await expect(page.locator('select[aria-label="Which item is “pewter tankard”"]')).toHaveValue("it21", { timeout: 15_000 });
    const candle = await page.locator('select[aria-label="Which item is “brass candlestick”"]').inputValue();
    // "goblet" is left on Skip; "wooden chair" becomes a new item.
    await page.locator('select[aria-label="Which item is “goblet”"]').selectOption("");
    await page.locator('select[aria-label="Which item is “wooden chair”"]').selectOption("__new");

    await page.getByRole("button", { name: /^Mark \d+ items?$/ }).click();
    await page.waitForURL(/\/productions\/prod1\?marked=/);

    const kept = await pictures(page);
    const byItem = Object.fromEntries(kept.map((picture) => [picture.item_id, picture]));
    expect(Object.keys(byItem).sort()).toEqual([candle, "it21"].sort());
    expect(byItem.it21).toMatchObject({ source: "prop_table", similarity: 0.93, org_id: "org1", created_by: "u1" });
    expect(byItem.it21.embedding).not.toBeNull();
    // Matched by name only: no score, but the crop was still fingerprinted.
    expect(byItem[candle]).toMatchObject({ source: "prop_table", similarity: null });
    expect(byItem[candle].embedding).not.toBeNull();
    for (const picture of kept) expect(picture.photo_path).toMatch(new RegExp(`^org1/${picture.item_id}/ref-`));
  });

  test("without the model, the crops are kept and fingerprinted later", async ({ page }) => {
    await open(page, "/productions/prod1/photo");
    await page.locator("input[type=file]").first().setInputFiles(PROP_TABLE);
    await expect(page.locator('select[aria-label="Which item is “pewter tankard”"]')).toHaveValue("it21", { timeout: 20_000 });
    for (const thing of ["brass candlestick", "goblet", "wooden chair"]) {
      await page.locator(`select[aria-label="Which item is “${thing}”"]`).selectOption("");
    }
    await page.getByRole("button", { name: "Mark 1 item" }).click();
    await page.waitForURL(/\/productions\/prod1\?marked=/);
    const kept = await pictures(page);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ item_id: "it21", similarity: null, embedding: null });
  });
});
