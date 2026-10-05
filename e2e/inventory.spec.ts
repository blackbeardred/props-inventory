import { test, expect, PHONE, DESKTOP, open, noSidewaysScroll, tappable, LIST_CELLS } from "./helpers";

// Inventory: rooms as tiles you walk into, the list and the grid, and what
// opening an item does to its picture.

const PLACE_TILES = 'ul[aria-label="Places in here"] a[href^="/inventory?place="]';
const cell = (page: import("@playwright/test").Page, name: string) =>
  page.locator(LIST_CELLS, { has: page.locator("h3", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) });

test.describe("walking in like folders (phone)", () => {
  test.use(PHONE);

  test("the top level shows the rooms, with counts, and a way to add one", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const tiles = page.locator(PLACE_TILES);
    await expect(tiles).toHaveCount(4);
    await expect(tiles.filter({ hasText: "Props Room A" })).toContainText("12 items");
    await expect(page.locator('a[href="/locations/new"]', { hasText: "Add a room" })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /Not filed/ })).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("walking into a room: breadcrumb, shelves, and add-here links", async ({ page }) => {
    await open(page, "/inventory?view=list");
    await page.locator(PLACE_TILES).filter({ hasText: "Props Room A" }).click();
    await page.waitForURL(/place=roomA/);
    await expect(page.locator("h1")).toHaveText("Props Room A");
    await expect(page.locator('nav[aria-label="Where you are"] a')).toHaveText(["Inventory", "Edit"]);
    await expect(page.locator(PLACE_TILES)).toHaveCount(2);
    await expect(page.locator(PLACE_TILES).first()).toContainText("A");
    await expect(page.locator('a[href="/locations/new?parent=roomA"]')).toHaveCount(1);
    // "Add item" — same words as at the top level — still files it here.
    await expect(page.locator('a[href="/items/new?location=roomA"]', { hasText: /^Add item$/ })).toHaveCount(1);
    const crumbs = await tappable(page, 'nav[aria-label="Where you are"] a');
    expect(crumbs.every((c) => c.hit), JSON.stringify(crumbs)).toBe(true);
  });

  test("All covers boxes inside; Loose here is only what sits in the room itself", async ({ page }) => {
    await open(page, "/inventory?place=roomA&view=list");
    const all = await page.locator(LIST_CELLS).count();
    const places = await page.locator(`${LIST_CELLS} h3 + p`).allInnerTexts();
    expect(places.every((p) => p.includes("Props Room A"))).toBe(true);
    expect(places.some((p) => p.includes("/")), "includes things in shelves and boxes").toBe(true);
    await page.getByRole("link", { name: /Loose here/ }).click();
    await page.waitForURL(/only=here/);
    const loose = await page.locator(LIST_CELLS).count();
    expect(loose).toBeGreaterThan(0);
    expect(loose).toBeLessThan(all);
  });

  test("a deep box's breadcrumb leads back up through every level", async ({ page }) => {
    await open(page, "/inventory?place=shake");
    const crumbs = await page.locator('nav[aria-label="Where you are"] a').evaluateAll((as) =>
      as.map((a) => [a.textContent?.trim(), a.getAttribute("href")])
    );
    expect(crumbs).toContainEqual(["Props Room A", expect.stringContaining("place=roomA")]);
    expect(crumbs).toContainEqual(["A", expect.stringContaining("place=shelfA")]);
  });

  test("search inside a place stays inside it", async ({ page }) => {
    await open(page, "/inventory?place=roomB");
    const box = page.locator("main input[type=text]");
    await expect(box).toHaveAttribute("placeholder", "Search in Props Room B");
    await box.fill("brass");
    await expect(page).toHaveURL(/place=roomB.*q=brass|q=brass.*place=roomB/);
    await expect(page.locator("main")).toContainText("in Props Room B");
    const hits = await page.locator('main a[href^="/items/"]').allInnerTexts();
    expect(hits.every((t) => !t.includes("Props Room A"))).toBe(true);
  });

  test("desk jobs (labels, export, import) are left to the desktop", async ({ page }) => {
    await open(page, "/inventory?place=roomA");
    await expect(page.getByRole("link", { name: "Print labels" })).toBeHidden();
    await expect(page.getByRole("link", { name: "Export" })).toBeHidden();
  });
});

test.describe("desktop", () => {
  test.use(DESKTOP);

  test("labels, export and import are in the header", async ({ page }) => {
    await open(page, "/inventory?place=roomA");
    await expect(page.getByRole("link", { name: "Print labels" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Import spreadsheet" })).toBeVisible();
  });

  test("List or Grid is remembered", async ({ page }) => {
    await open(page, "/inventory?view=grid");
    await open(page, "/inventory");
    await expect(page.locator('a[aria-current=true][href*="view="]')).toHaveText("Grid");
    await page.click('a[href*="view=list"]');
    await page.waitForURL(/view=list/);
    await open(page, "/inventory");
    await expect(page.locator('a[aria-current=true][href*="view="]')).toHaveText("List");
  });

  test("an opened cell's photo grows to 192px with the name beside it", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const broom = cell(page, "Antique Brass Broom");
    const photo = broom.locator("[data-cell-photo]");
    await broom.locator("h3").click();
    await expect.poll(async () => (await photo.boundingBox())?.width).toBe(192);
    const size = await photo.boundingBox();
    expect(size!.height).toBe(192);
    const nameLeft = await broom.locator("h3").evaluate((h) => h.getBoundingClientRect().left);
    expect(nameLeft).toBeGreaterThan(size!.x + size!.width);
    await broom.locator("h3").click();
    await expect.poll(async () => (await photo.boundingBox())?.width).toBe(48);
  });
});

test.describe("list cells (phone)", () => {
  test.use(PHONE);

  test("tap anywhere on the card to open and shut it", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const first = page.locator(LIST_CELLS).first();
    const panel = first.locator("[data-cell-panel]");
    await expect(panel).toHaveAttribute("style", /0fr/);
    await first.locator("h3").click();
    await expect(panel).toHaveAttribute("style", /1fr/);
    await first.click({ position: { x: 300, y: 20 } });
    await expect(panel).toHaveAttribute("style", /0fr/);
    await first.click({ position: { x: 200, y: 40 } });
    await expect(panel).toHaveAttribute("style", /1fr/);
    await expect(page.locator(LIST_CELLS).nth(1)).toContainText("tap for details");
  });

  test("places are full paths, so two shelves called B are told apart", async ({ page }) => {
    await open(page, "/inventory?view=list");
    await expect(cell(page, "Antique Brass Broom")).toContainText("Props Room A / A");
    const bs = (await page.locator(`${LIST_CELLS} h3 + p`).allInnerTexts()).filter((t) => t.endsWith("/ B"));
    expect(new Set(bs).size).toBeGreaterThanOrEqual(2);
  });

  test("opening grows the photo to the card's full width, square, name beneath", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const broom = cell(page, "Antique Brass Broom");
    const photo = broom.locator("[data-cell-photo]");
    const shut = await photo.boundingBox();
    expect([shut!.width, shut!.height]).toEqual([48, 48]);
    await broom.locator("h3").click();
    await page.waitForTimeout(120);
    const mid = (await photo.boundingBox())!.width;
    await page.waitForTimeout(450);
    const open1 = (await photo.boundingBox())!;
    const card = await broom.locator(":scope > div").evaluate((el) => {
      const s = getComputedStyle(el);
      return el.getBoundingClientRect().width - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
    });
    expect(Math.abs(open1.width - (card - 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(open1.width - open1.height)).toBeLessThanOrEqual(1);
    expect(mid, "it grows rather than jumps").toBeGreaterThan(48);
    expect(mid).toBeLessThan(open1.width);
    const nameTop = await broom.locator("h3").evaluate((h) => h.getBoundingClientRect().top);
    expect(nameTop).toBeGreaterThanOrEqual(open1.y + open1.height);
    await expect(photo).toHaveAttribute("alt", "Antique Brass Broom");
    await photo.click();
    await expect.poll(async () => (await photo.boundingBox())?.width).toBe(48);
    // An item without a photo still opens normally.
    const bells = cell(page, "Bells");
    await bells.locator("h3").click();
    await expect(bells.locator("[data-cell-panel]")).toHaveAttribute("style", /1fr/);
    await noSidewaysScroll(page);
  });
});

test.describe("grid", () => {
  for (const [name, use] of [
    ["wide desktop", { viewport: { width: 1526, height: 900 } }],
    ["phone", { ...PHONE, viewport: { width: 375, height: 900 } }],
  ] as const) {
    test.describe(name, () => {
      test.use(use);

      test("every photo is square and no tile stretches its row", async ({ page }) => {
        await open(page, "/inventory?view=grid");
        const tiles = await page.$$eval("[data-item-tile]", (els) =>
          els.map((li) => {
            const box = li.querySelector("[data-tile-photo]")!.getBoundingClientRect();
            const r = li.getBoundingClientRect();
            return { h: Math.round(r.height), top: Math.round(r.top), square: Math.abs(box.width - box.height) < 1.5 };
          })
        );
        expect(tiles.every((t) => t.square), "every photo box is square, the tall one included").toBe(true);
        const rows = new Map<number, number[]>();
        for (const t of tiles) rows.set(t.top, [...(rows.get(t.top) ?? []), t.h]);
        const spread = Math.max(...[...rows.values()].map((hs) => Math.max(...hs) - Math.min(...hs)));
        expect(spread, "no tile taller than its row-mates by more than a line of name").toBeLessThanOrEqual(22);
      });
    });
  }
});

test.describe("grid tiles open like list cells", () => {
  async function geometry(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const ul = document.querySelector("[data-item-tile]")!.parentElement!.getBoundingClientRect();
      const opened = document.querySelector("[data-item-tile][data-open]");
      if (!opened) return null;
      const r = opened.getBoundingClientRect();
      const ph = opened.querySelector("[data-tile-photo]")?.getBoundingClientRect();
      const h3 = opened.querySelector("h3")!.getBoundingClientRect();
      const dl = opened.querySelector("dl")?.getBoundingClientRect();
      // Rows of the closed tiles, by top, within 2px.
      const rows: { top: number; n: number }[] = [];
      for (const t of document.querySelectorAll("[data-item-tile]:not([data-open])")) {
        const top = t.getBoundingClientRect().top + scrollY;
        const row = rows.find((x) => Math.abs(x.top - top) <= 2);
        if (row) row.n++;
        else rows.push({ top, n: 1 });
      }
      rows.sort((a, b) => a.top - b.top);
      return {
        gridWidth: ul.width,
        width: r.width,
        photo: ph ? { w: Math.round(ph.width), h: Math.round(ph.height), right: ph.right, bottom: ph.bottom } : null,
        nameTop: h3.top,
        dlLeft: dl?.left ?? 0,
        rows: rows.map((x) => x.n),
      };
    });
  }

  test.describe("phone", () => {
    test.use(PHONE);

    test("a tile opens across the grid, photo full width, details beneath, no holes", async ({ page }) => {
      await open(page, "/inventory?view=grid");
      const tile = page.locator("[data-item-tile]").nth(3);
      await tile.locator("h3").tap();
      await page.waitForTimeout(600);
      const g = (await geometry(page))!;
      expect(Math.abs(g.width - g.gridWidth)).toBeLessThan(1);
      expect(Math.abs(g.photo!.w - g.width)).toBeLessThan(3);
      expect(g.photo!.w).toBe(g.photo!.h);
      expect(g.nameTop).toBeGreaterThanOrEqual(g.photo!.bottom);
      expect(g.rows.slice(0, -1).every((n) => n === 2), `rows ${g.rows}`).toBe(true);
      await expect(tile.getByRole("link", { name: /Edit this item/ })).toHaveCount(1);
      await expect(tile.locator("[data-tile-button]")).toHaveAttribute("aria-expanded", "true");
      const top = await tile.evaluate((t) => t.getBoundingClientRect().top);
      expect(top, "scrolled into view").toBeGreaterThanOrEqual(0);
      expect(top).toBeLessThan(844 - 300);
      await noSidewaysScroll(page);
      await tile.locator("h3").tap();
      await page.waitForTimeout(600);
      expect(await geometry(page)).toBeNull();
    });
  });

  test.describe("desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("a 320px photo beside the details; two can be open; keyboard works", async ({ page }) => {
      await open(page, "/inventory?view=grid");
      const tile = (i: number) => page.locator("[data-item-tile]").nth(i);
      await tile(2).locator("h3").click();
      await page.waitForTimeout(600);
      const g = (await geometry(page))!;
      expect(Math.abs(g.width - g.gridWidth)).toBeLessThan(1);
      expect([g.photo!.w, g.photo!.h]).toEqual([320, 320]);
      expect(g.dlLeft).toBeGreaterThan(g.photo!.right);
      expect(g.rows.slice(0, -1).every((n) => n === 5), `rows ${g.rows}`).toBe(true);
      await tile(0).locator("h3").click();
      await page.waitForTimeout(600);
      await expect(page.locator("[data-item-tile][data-open]")).toHaveCount(2);
      await tile(0).locator("[data-tile-button]").focus();
      await page.keyboard.press("Enter");
      await page.waitForTimeout(600);
      await expect(tile(0)).not.toHaveAttribute("data-open", "");
      await page.keyboard.press(" ");
      await page.waitForTimeout(600);
      await expect(tile(0)).toHaveAttribute("data-open", "");
      expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-tile-button"))).toBe(true);
      expect(await page.evaluate(() => !document.querySelector("[data-morphing], [data-morph-self]"))).toBe(true);
      const kept = page.locator("[data-item-tile][data-open]").last().locator('dl a[href^="/inventory?place="]');
      await kept.click();
      await page.waitForURL(/place=/);
    });

    test("no morph with reduced motion, but it still opens", async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await open(page, "/inventory?view=grid");
      const morphs = await page.evaluate(
        () =>
          new Promise<number>((done) => {
            document.querySelectorAll("[data-item-tile]")[1].querySelector("h3")!.click();
            requestAnimationFrame(() =>
              done(document.getAnimations().filter((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition")).length)
            );
          })
      );
      expect(morphs).toBe(0);
      await expect(page.locator("[data-item-tile]").nth(1)).toHaveAttribute("data-open", "");
      await context.close();
    });
  });
});
