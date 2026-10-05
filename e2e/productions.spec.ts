import { test, expect, PHONE, DESKTOP, open, tappable, smallTapTargets } from "./helpers";
import path from "node:path";

// A production: its pull list, the walk-round checklist, and marking things
// from a photo of the prop table.

const PROP_TABLE = path.join(__dirname, "fixtures", "prop-table.jpg");
const row = (page: import("@playwright/test").Page, name: string) =>
  page.locator("[data-pull-row]", { hasText: name });
const status = (page: import("@playwright/test").Page, name: string) =>
  row(page, name).locator('button[aria-pressed="true"]');

test.describe("pull list (phone)", () => {
  test.use(PHONE);

  test("pulled-but-unticked says so, under the name; others say nothing extra", async ({ page }) => {
    await open(page, "/productions/prod1");
    await expect(row(page, "Fishing Net")).toContainText("not checked");
    await expect(status(page, "Fishing Net")).toHaveText("Pulled");
    await expect(row(page, "Fishing Net")).toContainText("Props Room A / A");
    await expect(row(page, "Yorick")).not.toContainText("not checked");
    await expect(row(page, "Brass candlestick")).not.toContainText("not checked");
    await expect(page.getByRole("button", { name: "Save" })).toHaveCount(0);
  });

  test("Pending · Pulled · Returned stay put whatever is chosen", async ({ page }) => {
    await open(page, "/productions/prod1");
    const xs = await page.$$eval('[data-pull-row] button[value="pulled"]', (bs) =>
      bs.map((b) => Math.round(b.getBoundingClientRect().left))
    );
    expect(new Set(xs).size, "Pulled is at the same x on every row").toBe(1);
    const before = await row(page, "Brass candlestick").locator('button[value="returned"]').boundingBox();
    await expect(status(page, "Brass candlestick")).toHaveText("Pending");
    await row(page, "Brass candlestick").locator('button[value="returned"]').tap();
    await expect(status(page, "Brass candlestick")).toHaveText("Returned");
    const after = await row(page, "Brass candlestick").locator('button[value="returned"]').boundingBox();
    expect(Math.round(after!.x)).toBe(Math.round(before!.x));
    expect(Math.round(after!.width)).toBe(Math.round(before!.width));
  });

  test("on a phone the list runs edge to edge", async ({ page }) => {
    await open(page, "/productions/prod1");
    const span = await row(page, "Brass candlestick").evaluate((li) => {
      const r = li.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.right)];
    });
    expect(span).toEqual([0, 390]);
  });

  test("the four production buttons are on screen, and Delete list sits well away from the title", async ({ page }) => {
    await open(page, "/productions/prod1");
    const buttons = await tappable(
      page,
      'main a[href$="/edit"], main a[href$="/photo"], main a[href$="/checklist"], main a[href$="/issues"]'
    );
    expect(buttons.every((b) => b.onScreen && b.hit), JSON.stringify(buttons)).toBe(true);
    const gap = await page.evaluate(() => {
      const title = document.querySelector("main h2")!.getBoundingClientRect();
      const del = [...document.querySelectorAll("main button")].find((b) => (b as HTMLElement).innerText.includes("Delete this list"))!;
      return del.getBoundingClientRect().top - title.top;
    });
    expect(gap).toBeGreaterThan(150);
  });

  test("productions are cards on a phone", async ({ page }) => {
    await open(page, "/productions");
    await expect(page.locator("main ul.md\\:hidden > li")).toHaveCount(1);
    await expect(page.locator("main table")).toBeHidden();
  });
});

test.describe("checklist (phone)", () => {
  test.use(PHONE);

  test("NOT CHECKED, and why, matching the pull list", async ({ page }) => {
    await open(page, "/productions/prod1/checklist");
    const net = page.locator("main li", { hasText: "Fishing Net" }).first();
    await expect(net).toContainText("NOT CHECKED");
    await expect(net).toContainText("marked pulled");
    await expect(page.locator("main li", { hasText: "Brass candlestick" }).first()).not.toContainText("marked pulled");
    expect(await smallTapTargets(page)).toEqual([]);
  });

  test("ticking a line marks it checked and pulled", async ({ page }) => {
    await open(page, "/productions/prod1/checklist");
    const candle = page.locator("main li", { hasText: "Brass candlestick" }).first();
    await candle.locator("input[type=checkbox]").check();
    await expect(candle).toContainText(/Checked/);
    await open(page, "/productions/prod1");
    await expect(status(page, "Brass candlestick")).toHaveText("Pulled");
  });

  test("Not needed, and Put back", async ({ page }) => {
    await open(page, "/productions/prod1/checklist");
    const candle = page.locator("main li", { hasText: "Brass candlestick" }).first();
    await candle.getByRole("button", { name: "Not needed" }).click();
    await expect(candle).toContainText("Not needed after all");
    await candle.getByRole("button", { name: "Put back" }).click();
    await expect(candle).toContainText("NOT CHECKED");
  });
});

test.describe("marking from a photo", () => {
  test.use(PHONE);

  test("a big button to take or choose the photo", async ({ page }) => {
    await open(page, "/productions/prod1/photo");
    const size = await page.evaluate(() => {
      const label = [...document.querySelectorAll("main label")].find((l) => (l as HTMLElement).innerText.includes("Take or choose"));
      const r = label?.getBoundingClientRect();
      return r ? { h: r.height, w: r.width } : null;
    });
    expect(size).not.toBeNull();
    expect(size!.h).toBeGreaterThanOrEqual(52);
    expect(size!.w).toBeGreaterThanOrEqual(300);
  });

  test("the photo is read into rows, matched by name, and only a plain name match starts ticked", async ({ page }) => {
    await open(page, "/productions/prod1/photo");
    await page.locator("input[type=file]").first().setInputFiles(PROP_TABLE);
    const selects = page.locator('select[aria-label^="Which item"]');
    await expect(selects).toHaveCount(4, { timeout: 20_000 });
    // "brass candlestick" names an item plainly; "goblet" names nothing.
    await expect(page.locator('select[aria-label="Which item is “goblet”"]')).toHaveValue("");
    const candle = await page.locator('select[aria-label="Which item is “brass candlestick”"]').inputValue();
    expect(candle).toMatch(/^it[56]$/);
  });
});

test.describe("desktop", () => {
  test.use(DESKTOP);

  test("pull issues page opens", async ({ page }) => {
    await open(page, "/productions/prod1/issues");
    await expect(page.locator("main h1")).toBeVisible();
  });
});
