import { test, expect, DESKTOP, PHONE, open, smallTapTargets, noSidewaysScroll } from "./helpers";
import { readFileSync } from "node:fs";
import { readZip } from "../src/lib/zip";

// The training set: every confirmed picture, one folder per prop (twins share
// one), as a .zip. In the sample theatre, pictures=1 gives the second brass
// candlestick (it6) two confirmed pictures, and twins=1 makes it5 and it6
// twins. The fixture's storage hands out "picture of <path>" as each file
// once a test sets window.__downloads.

const panel = (page: import("@playwright/test").Page) => page.locator("[data-training-set]");

test.describe("desktop", () => {
  test.use(DESKTOP);

  test("Theatre links to it", async ({ page }) => {
    await open(page, "/theatre");
    await expect(page.locator('#photos a[href="/items/training-set"]')).toHaveText("Training set");
  });

  test("with nothing confirmed it says how pictures get kept", async ({ page }) => {
    await open(page, "/items/training-set");
    await expect(page.locator("main")).toContainText("No confirmed pictures yet");
    await expect(panel(page).getByRole("button", { name: /Download training set/ })).toBeDisabled();
    // Every item's own photo can still go.
    await panel(page).getByText("Also include items that only have their own photo").click();
    await expect(panel(page).getByRole("button", { name: /Download training set/ })).toBeEnabled();
  });

  test.describe("with confirmed pictures and twins", () => {
    test.use({ fixtureOptions: "pictures=1&twins=1" });

    test("twins share a label; the zip holds their photos, labels.csv and a README", async ({ page }) => {
      await open(page, "/items/training-set");
      await expect(panel(page)).toContainText("2 confirmed pictures");
      await panel(page).getByText("What’s in it").click();
      const labels = panel(page).locator("[data-training-labels] li");
      await expect(labels).toHaveCount(1);
      await expect(labels.first()).toContainText("brass-candlestick/ · 2 twins");
      await expect(labels.first()).toContainText("4/10");

      await page.evaluate(() => {
        (globalThis as unknown as { __downloads: boolean }).__downloads = true;
      });
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        panel(page).getByRole("button", { name: /Download training set/ }).click(),
      ]);
      expect(download.suggestedFilename()).toMatch(/^training-set-\d{4}-\d{2}-\d{2}\.zip$/);
      await expect(panel(page).getByRole("status")).toContainText("Saved 4 pictures.");

      const files = readZip(new Uint8Array(readFileSync((await download.path())!)));
      expect(files.map((f) => f.name)).toEqual([
        "README.txt",
        "labels.csv",
        "brass-candlestick/it5-photo.jpg",
        "brass-candlestick/it6-photo.jpg",
        "brass-candlestick/refit61-find-by-photo.jpg",
        "brass-candlestick/refit62-find-by-photo.jpg",
      ]);
      const text = (name: string) => new TextDecoder().decode(files.find((f) => f.name === name)!.data);
      expect(text("brass-candlestick/it6-photo.jpg")).toBe("picture of p6.jpg");
      expect(text("labels.csv").split("\r\n")[0]).toBe("file,label,item_id,item_name,category,source,similarity");
      expect(text("labels.csv")).toContain("brass-candlestick/refit61-find-by-photo.jpg,brass-candlestick,it6,Brass candlestick,prop,find_by_photo,0.800");
      expect(text("README.txt")).toContain("Training set for SPARC");
      expect(text("README.txt")).toContain("1 label, 4 pictures.");
    });

    test("everything, if asked; a picture that can't be fetched is listed, not fatal", async ({ page }) => {
      await open(page, "/items/training-set");
      await panel(page).getByText("Also include items that only have their own photo").click();
      await expect(panel(page).locator("dd").first()).not.toHaveText("1");
      await page.evaluate(() => {
        (globalThis as unknown as { __downloads: boolean }).__downloads = true;
      });
      const [download] = await Promise.all([
        page.waitForEvent("download"),
        panel(page).getByRole("button", { name: /Download training set/ }).click(),
      ]);
      const files = readZip(new Uint8Array(readFileSync((await download.path())!)));
      // Every item with a photo gets a folder; twins still share one.
      const folders = new Set(files.map((f) => f.name.split("/")[0]).filter((name) => !name.includes(".")));
      expect(folders.has("brass-candlestick")).toBe(true);
      expect(folders.has("brass-candlestick-2")).toBe(false);
      expect(folders.has("pewter-tankard")).toBe(true);
    });
  });
});

test.describe("phone", () => {
  test.use({ ...PHONE, fixtureOptions: "pictures=1" });

  test("fits a phone", async ({ page }) => {
    await open(page, "/items/training-set");
    await panel(page).getByText("What’s in it").click();
    expect(await smallTapTargets(page)).toEqual([]);
    await noSidewaysScroll(page);
  });
});
