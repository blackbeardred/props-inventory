import { test, expect, PHONE, DESKTOP, open, noSidewaysScroll, tappable, smallTapTargets, LIST_CELLS } from "./helpers";

// Three tabs (Inventory, Productions, Theatre), the old addresses that still
// have to work, and the phone layout rules from the Day 22 audit.

test.describe("on a phone", () => {
  test.use(PHONE);

  test("three tabs, one lit for the section you're in", async ({ page }) => {
    await open(page, "/inventory");
    const tabs = page.locator('nav[aria-label="Main"] ul a');
    await expect(tabs).toHaveText(["Inventory", "Productions", "Theatre"]);
    for (const [path, lit] of [
      ["/inventory", 0],
      ["/items/new", 0],
      ["/locations/new", 0],
      ["/productions", 1],
      ["/productions/prod1", 1],
      ["/theatre", 2],
    ] as const) {
      await open(page, path);
      const current = await tabs.evaluateAll((as) => as.map((a) => a.getAttribute("aria-current")));
      expect(current, `tab lit on ${path}`).toEqual([0, 1, 2].map((i) => (i === lit ? "page" : null)));
    }
  });

  test("the tab bar can be tapped, is thumb height, and nothing hides under it", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const tabs = await tappable(page, 'nav[aria-label="Main"] a');
    expect(tabs.filter((t) => t.onScreen)).toHaveLength(3);
    expect(tabs.every((t) => t.hit), JSON.stringify(tabs)).toBe(true);
    expect((await tappable(page, 'header a[href="/theatre"]')).every((t) => t.hit)).toBe(true);
    const heights = await page.$$eval('nav[aria-label="Main"] a', (as) =>
      as.filter((a) => a.getClientRects().length).map((a) => a.getBoundingClientRect().height)
    );
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
    const clears = await page.evaluate((cells) => {
      window.scrollTo(0, document.body.scrollHeight);
      const all = [...document.querySelectorAll(cells)];
      const last = all[all.length - 1].getBoundingClientRect();
      const bar = [...document.querySelectorAll('nav[aria-label="Main"]')].find((n) => n.getClientRects().length)!;
      return last.bottom <= bar.getBoundingClientRect().top;
    }, LIST_CELLS);
    expect(clears, "the last item scrolls clear of the tab bar").toBe(true);
  });

  test("the first item is within reach without scrolling", async ({ page }) => {
    for (const path of ["/inventory?view=list", "/inventory?place=roomA&view=list"]) {
      await open(page, path);
      const top = await page.locator(LIST_CELLS).first().evaluate((el) => el.getBoundingClientRect().top);
      // Search, the place tiles and the view toggles sit above it now, so
      // this is a guard against creep (it was 645 before Day 24's
      // compaction), with room for font differences between machines.
      expect(top, path).toBeLessThan(460);
    }
  });

  test("no page scrolls sideways", async ({ page }) => {
    for (const path of [
      "/inventory",
      "/inventory?place=roomA",
      "/inventory?view=grid",
      "/productions",
      "/productions/prod1",
      "/productions/prod1/checklist",
      "/productions/prod1/photo",
      "/theatre",
      "/items/new",
      "/items/it0/edit",
      "/locations/new",
    ]) {
      await open(page, path);
      await noSidewaysScroll(page);
    }
  });

  test("tap targets are at least 40px", async ({ page }) => {
    for (const path of [
      "/inventory",
      "/inventory?place=roomA",
      "/productions",
      "/productions/prod1/checklist",
      "/productions/prod1/photo",
      "/theatre",
      "/items/new",
    ]) {
      await open(page, path);
      expect(await smallTapTargets(page), path).toEqual([]);
    }
  });

  test("a narrower phone (375) and a wider one (430) both hold up", async ({ browser }) => {
    for (const width of [375, 430]) {
      const context = await browser.newContext({ ...PHONE, viewport: { width, height: 860 } });
      const page = await context.newPage();
      for (const path of ["/inventory", "/productions/prod1", "/theatre"]) {
        await open(page, path);
        await noSidewaysScroll(page);
      }
      await context.close();
    }
  });
});

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the nav is in the header and the tab bar is gone", async ({ page }) => {
    await open(page, "/inventory");
    await expect(page.locator('header nav[aria-label="Main"] a')).toHaveText(["Inventory", "Productions", "Theatre"]);
    await expect(page.locator('nav[aria-label="Main"].md\\:hidden')).toBeHidden();
    expect((await tappable(page, "header nav a")).every((t) => t.hit)).toBe(true);
  });

  test("the list is two columns and buttons keep their desktop size", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const columns = await page.$$eval(LIST_CELLS, (lis) =>
      new Set(lis.slice(0, 6).map((l) => Math.round(l.getBoundingClientRect().left))).size
    );
    expect(columns).toBe(2);
    const add = await page.getByRole("link", { name: "Add item" }).boundingBox();
    expect(add!.height).toBeLessThan(40);
  });

  test("a pull-list line stays within reading width", async ({ page }) => {
    await open(page, "/productions/prod1");
    const span = await page.evaluate(() => {
      const li = document.querySelector("[data-pull-row]")!;
      const name = li.querySelector("p")!.getBoundingClientRect();
      const last = [...li.querySelectorAll("button")].pop()!.getBoundingClientRect();
      return last.right - name.left;
    });
    expect(span).toBeLessThanOrEqual(768);
  });
});

test.describe("old addresses", () => {
  test.use(DESKTOP);

  test("redirect to where those pages went, keeping what they asked for", async ({ page }) => {
    const cases: [string, string][] = [
      ["/items", "/inventory"],
      // Printed QR labels carry this one.
      ["/items?location=roomA", "/inventory?place=roomA"],
      ["/locations", "/inventory"],
      ["/search?q=brass", "/inventory?q=brass"],
    ];
    for (const [from, to] of cases) {
      await open(page, from);
      const url = new URL(page.url());
      expect(url.pathname + url.search, from).toMatch(new RegExp(`^${to.replace(/[?]/g, "\\?")}`));
    }
    for (const from of ["/account", "/organization"]) {
      await open(page, from);
      expect(new URL(page.url()).pathname, from).toBe("/theatre");
    }
  });

  test("signed in, the login page bounces to Inventory; signed out, the app sends you to log in", async ({ page, context }) => {
    await open(page, "/login");
    expect(new URL(page.url()).pathname).toBe("/inventory");
    await context.addCookies([{ name: "e2e-signed-out", value: "1", domain: "localhost", path: "/" }]);
    await open(page, "/inventory");
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe("/inventory");
  });
});
