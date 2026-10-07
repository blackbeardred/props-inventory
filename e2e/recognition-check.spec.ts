import { test, expect, DESKTOP, open } from "./helpers";
import type { Page } from "@playwright/test";

// The recognition check on /items/fingerprints: each confirmed photo held
// out, and the right item looked for among everything else. The browser's
// copy of the sample theatre is seeded with fingerprints here: unit vectors
// along different axes, so which item is closest is known in advance.

test.use(DESKTOP);
const check = (page: Page) => page.locator("[data-recognition-check]");

async function seed(page: Page) {
  await page.evaluate(() => {
    const vec = (pairs: [number, number][]) => {
      const values = new Array(512).fill(0);
      for (const [i, x] of pairs) values[i] = x;
      return `[${values.join(",")}]`;
    };
    const db = (globalThis as unknown as { __fixtureDB: Record<string, unknown[]> }).__fixtureDB;
    const model = "clip-vit-base-patch32";
    db.item_photo_embeddings.push(
      { item_id: "it5", org_id: "org1", photo_url: "p5.jpg", model, embedding: vec([[0, 1]]) },
      { item_id: "it21", org_id: "org1", photo_url: "p21.jpg", model, embedding: vec([[1, 1]]) },
      { item_id: "it7", org_id: "org1", photo_url: "p7.jpg", model, embedding: vec([[2, 1]]) }
    );
    db.item_reference_photos.push(
      // A photo of the candlestick that's closest to the candlestick: found first.
      { id: "ref-a", item_id: "it5", org_id: "org1", photo_path: "org1/it5/ref-a.jpg", source: "find_by_photo", model, embedding: vec([[0, 1], [1, 0.1]]) },
      // A photo of the tankard that looks more like the candlestick: missed, second.
      { id: "ref-b", item_id: "it21", org_id: "org1", photo_path: "org1/it21/ref-b.jpg", source: "prop_table", model, embedding: vec([[0, 0.9], [1, 0.3]]) },
      // The only picture of the fishing net: nothing to find it by.
      { id: "ref-c", item_id: "it8", org_id: "org1", photo_path: "org1/it8/ref-c.jpg", source: "find_by_photo", model, embedding: vec([[3, 1]]) }
    );
  });
}

test("with nothing confirmed, it says how to get something to test", async ({ page }) => {
  await open(page, "/items/fingerprints");
  await check(page).getByRole("button", { name: "Run the check" }).click();
  await expect(check(page)).toContainText("Nothing to test yet");
});

test("scores each confirmed photo against everything else, and lists the misses", async ({ page }) => {
  await open(page, "/items/fingerprints");
  await seed(page);
  await check(page).getByRole("button", { name: "Run the check" }).click();
  const scores = check(page).locator("[data-check-scores]");
  await expect(scores).toContainText("Right item first1 of 2 (50%)");
  await expect(scores).toContainText("In the top three2 of 2 (100%)");
  await expect(check(page)).toContainText("1 more photo is the only picture of its item");
  const misses = check(page).locator("[data-check-misses] li");
  await expect(misses).toHaveCount(1);
  await expect(misses.first()).toContainText("A photo of Pewter tankard found Brass candlestick first. The right one came 2nd.");
  await expect(misses.first().locator("a")).toHaveAttribute("href", "/items/it21/edit");
  // Most items in the sample have a photo and no fingerprint: said plainly.
  await expect(check(page)).toContainText("have a photo but no fingerprint");
});

test("twins count as the right answer", async ({ page }) => {
  await open(page, "/items/fingerprints");
  await seed(page);
  await page.evaluate(() => {
    const db = (globalThis as unknown as { __fixtureDB: Record<string, unknown[]> }).__fixtureDB;
    // The tankard and the candlestick as twins: the "miss" becomes a hit.
    db.item_twins.push({ item_id: "it5", org_id: "org1", twin_set: "S" }, { item_id: "it21", org_id: "org1", twin_set: "S" });
  });
  await check(page).getByRole("button", { name: "Run the check" }).click();
  await expect(check(page).locator("[data-check-scores]")).toContainText("Right item first2 of 2 (100%)");
  await expect(check(page).locator("[data-check-misses]")).toHaveCount(0);
});

test("the comparison reads every photo both ways and scores both", async ({ page }) => {
  await open(page, "/items/fingerprints");
  await seed(page);
  await page.evaluate(() => {
    const g = globalThis as unknown as { __modelCached: boolean; __downloads: boolean };
    g.__modelCached = true;
    g.__downloads = true;
  });
  await check(page).getByRole("button", { name: "Run the check" }).click();
  await check(page).getByRole("button", { name: "Compare the two readings" }).click();
  const compare = check(page).locator("[data-check-compare]");
  await expect(compare).toBeVisible({ timeout: 15_000 });
  await expect(compare).toContainText("One reading: first");
  await expect(compare).toContainText("Three readings: first");
});
