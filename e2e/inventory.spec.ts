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

test.describe("grid tiles open beneath their row", () => {
  // Every tile's place on screen, by id.
  async function places(page: import("@playwright/test").Page) {
    return page.$$eval("[data-item-tile]", (els) =>
      Object.fromEntries(
        els.map((li) => {
          const r = li.getBoundingClientRect();
          return [li.getAttribute("data-id")!, { x: Math.round(r.left), y: Math.round(r.top + scrollY), w: Math.round(r.width) }];
        })
      )
    );
  }
  async function panel(page: import("@playwright/test").Page) {
    return page.evaluate(() => {
      const ul = document.querySelector("[data-item-grid]")!.getBoundingClientRect();
      const p = document.querySelector("[data-tile-panel]");
      if (!p) return null;
      const r = p.getBoundingClientRect();
      const ph = p.querySelector("[data-tile-photo]")?.getBoundingClientRect();
      const h3 = p.querySelector("h3")!.getBoundingClientRect();
      const dl = p.querySelector("dl")?.getBoundingClientRect();
      const notch = p.querySelector("[data-tile-notch]")!.getBoundingClientRect();
      return {
        gridWidth: ul.width,
        left: r.left - ul.left,
        width: r.width,
        top: r.top + scrollY,
        photo: ph ? { w: Math.round(ph.width), h: Math.round(ph.height), right: ph.right, bottom: ph.bottom } : null,
        nameTop: h3.top,
        dlLeft: dl?.left ?? 0,
        notchX: notch.left + notch.width / 2,
      };
    });
  }

  test.describe("phone", () => {
    test.use(PHONE);

    test("opening a right-hand tile moves nothing sideways and pulls nothing up", async ({ page }) => {
      await open(page, "/inventory?view=grid");
      const before = await places(page);
      const ids = await page.$$eval("[data-item-tile]", (els) => els.map((li) => li.getAttribute("data-id")!));
      // Tile 3 is on the right of the second row; tile 4 starts the third.
      const tile = page.locator("[data-item-tile]").nth(3);
      await tile.locator("h3").tap();
      await page.waitForTimeout(600);
      const after = await places(page);
      // The opened tile, its row-mate and everything above stay put.
      for (const id of ids.slice(0, 4)) expect(after[id], id).toEqual(before[id]);
      // Everything after keeps its column and moves straight down, by the
      // same distance: nothing jumps up into the opened tile's place.
      const drop = after[ids[4]].y - before[ids[4]].y;
      expect(drop).toBeGreaterThan(200);
      for (const id of ids.slice(4)) {
        expect(after[id].x, id).toBe(before[id].x);
        expect(after[id].y - before[id].y, id).toBe(drop);
      }
      // The details sit across the grid, between the rows, photo full width.
      const g = (await panel(page))!;
      expect(Math.abs(g.width - g.gridWidth)).toBeLessThan(1);
      expect(g.top).toBeGreaterThan(before[ids[3]].y);
      expect(g.top).toBeLessThan(after[ids[4]].y);
      expect(Math.abs(g.photo!.w - g.width)).toBeLessThan(3);
      expect(g.photo!.w).toBe(g.photo!.h);
      expect(g.nameTop).toBeGreaterThanOrEqual(g.photo!.bottom);
      // The notch points at the right-hand column.
      const tileBox = (await tile.boundingBox())!;
      expect(Math.abs(g.notchX - (tileBox.x + tileBox.width / 2))).toBeLessThan(4);
      await expect(page.locator("[data-tile-panel]").getByRole("link", { name: /Edit this item/ })).toHaveCount(1);
      await expect(tile.locator("[data-tile-button]")).toHaveAttribute("aria-expanded", "true");
      await expect(tile).toHaveAttribute("data-open", "");
      await noSidewaysScroll(page);

      await tile.locator("h3").tap();
      await page.waitForTimeout(400);
      expect(await panel(page)).toBeNull();
      expect(await places(page)).toEqual(before);
    });

    test("a left-hand tile too: its row-mate stays beside it", async ({ page }) => {
      await open(page, "/inventory?view=grid");
      const before = await places(page);
      const ids = await page.$$eval("[data-item-tile]", (els) => els.map((li) => li.getAttribute("data-id")!));
      await page.locator("[data-item-tile]").nth(2).locator("h3").tap();
      await page.waitForTimeout(600);
      const after = await places(page);
      expect(after[ids[2]]).toEqual(before[ids[2]]);
      expect(after[ids[3]]).toEqual(before[ids[3]]);
      for (const id of ids.slice(4)) expect(after[id].x, id).toBe(before[id].x);
    });

    test("opening another closes the first; Close and Escape close it", async ({ page }) => {
      await open(page, "/inventory?view=grid");
      await page.locator("[data-item-tile]").nth(0).locator("h3").tap();
      await page.locator("[data-item-tile]").nth(5).locator("h3").tap();
      await expect(page.locator("[data-item-tile][data-open]")).toHaveCount(1);
      await expect(page.locator("[data-item-tile]").nth(5)).toHaveAttribute("data-open", "");
      await expect(page.locator("[data-tile-panel]")).toHaveCount(1);
      await page.locator("[data-tile-panel]").getByRole("button", { name: "Close" }).tap();
      await expect(page.locator("[data-tile-panel]")).toHaveCount(0);
    });
  });

  test.describe("desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("a 320px photo beside the details, under the row; keyboard works", async ({ page }) => {
      await open(page, "/inventory?view=grid");
      const tile = (i: number) => page.locator("[data-item-tile]").nth(i);
      const before = await places(page);
      await tile(2).locator("h3").click();
      await page.waitForTimeout(600);
      const g = (await panel(page))!;
      expect(Math.abs(g.width - g.gridWidth)).toBeLessThan(1);
      expect([g.photo!.w, g.photo!.h]).toEqual([320, 320]);
      expect(g.dlLeft).toBeGreaterThan(g.photo!.right);
      // The whole first row (five across) is untouched.
      const after = await places(page);
      const ids = Object.keys(before);
      for (const id of ids.slice(0, 5)) expect(after[id], id).toEqual(before[id]);

      await tile(2).locator("[data-tile-button]").focus();
      await page.keyboard.press("Enter");
      await expect(tile(2)).not.toHaveAttribute("data-open", "");
      await page.keyboard.press(" ");
      await expect(tile(2)).toHaveAttribute("data-open", "");
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-tile-panel]")).toHaveCount(0);
      expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-tile-button"))).toBe(true);
      await page.keyboard.press("Enter");
      const kept = page.locator('[data-tile-panel] dl a[href^="/inventory?place="]');
      await kept.click();
      await page.waitForURL(/place=/);
    });

    test("with reduced motion it still opens", async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      await open(page, "/inventory?view=grid");
      await page.locator("[data-item-tile]").nth(1).locator("h3").click();
      await expect(page.locator("[data-item-tile]").nth(1)).toHaveAttribute("data-open", "");
      await expect(page.locator("[data-tile-panel] h3")).toBeVisible();
      await context.close();
    });
  });
});
