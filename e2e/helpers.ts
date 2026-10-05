import { test as base, expect, type Locator, type Page } from "@playwright/test";

/**
 * The shared test setup.
 *
 * Every test starts from the same sample theatre (POST /api/e2e/reset) and
 * fails if the page logged an error or threw — the kind of thing a test can
 * otherwise pass straight over. A test that expects errors (the offline
 * checks, say) opts out with `test.use({ consoleErrors: "ignore" })`.
 */
export const test = base.extend<{
  consoleErrors: "fail" | "ignore";
  /** Extra setup for the sample theatre, e.g. "role=member" (see e2e/fixtures/db.ts). */
  fixtureOptions: string;
  resetFixtures: void;
}>({
  consoleErrors: ["fail", { option: true }],
  fixtureOptions: ["", { option: true }],
  resetFixtures: [
    async ({ request, fixtureOptions }, provide) => {
      const reset = await request.post(`/api/e2e/reset${fixtureOptions ? `?${fixtureOptions}` : ""}`);
      expect(reset.ok(), "the fixture build answers /api/e2e/reset").toBeTruthy();
      await provide();
    },
    { auto: true },
  ],
  // The second argument is Playwright's fixture callback, conventionally
  // `use` — named otherwise so the React hooks lint rule leaves it alone.
  page: async ({ page, consoleErrors }, provide) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      // "Failed to load resource" doesn't say which; the response handler
      // below records the address instead.
      if (message.text().startsWith("Failed to load resource")) return;
      errors.push(`console: ${message.text().slice(0, 300)}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.request().method()} ${response.url()}`);
    });
    await provide(page);
    if (consoleErrors === "fail") expect(errors, "no errors in the browser console").toEqual([]);
  },
});

export { expect };

/** A phone: 390 wide, touch, a mobile user agent. */
export const PHONE = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
} as const;

/** A desktop browser. */
export const DESKTOP = { viewport: { width: 1280, height: 900 } } as const;

/** Waits for the page and its first round of requests to settle. */
export async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "networkidle" });
}

/** The page is no wider than the window: nothing scrolls sideways. */
export async function noSidewaysScroll(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll, "page doesn't scroll sideways").toBeLessThanOrEqual(width);
}

/**
 * A real finger drag, through the Chrome DevTools protocol, so the page sees
 * genuine TouchEvents — Playwright itself only taps. Scrolls the target to
 * the middle of the screen first (the tab bar covers the bottom), starts
 * near its right-hand side (or `fromX`), and moves in ten steps.
 * `during` runs with the finger still down, to look at the half-swiped row.
 */
export async function swipe(
  page: Page,
  target: Locator,
  dx: number,
  { dy = 0, fromX, during }: { dy?: number; fromX?: number; during?: () => Promise<void> } = {}
) {
  await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
  // The thumb hexagon flies out while the page scrolls and back once it settles.
  await page.waitForTimeout(400);
  const box = await target.boundingBox();
  if (!box) throw new Error("swipe target isn't on screen");
  const x = fromX ?? box.x + box.width - 30;
  const y = box.y + Math.min(box.height / 2, 40);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }],
    });
    await page.waitForTimeout(16);
  }
  if (during) await during();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(250);
}

/** Elements the given selector matches that are visible but shorter than
 *  a thumb (40px) — buttons, links, fields. */
export async function smallTapTargets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("a, button, input:not([type=hidden]), select, summary, label:has(input[type=checkbox]), label:has(input[type=radio])")]
      .filter((e) => {
        if (!e.getClientRects().length) return false;
        if (e.closest(".sr-only") || e.classList.contains("sr-only")) return false;
        // A tick box or radio button is tapped through its label, checked above.
        if (e.matches("input[type=checkbox], input[type=radio]")) return false;
        // The hexagon controls are deliberately small and sit on a larger
        // tappable card.
        if (e.matches("[data-cell-button], [data-hex-toggle], [data-tile-button]")) return false;
        const panel = e.closest("[data-cell-panel]") as HTMLElement | null;
        if (panel && panel.style.gridTemplateRows === "0fr") return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height < 40;
      })
      .map((e) => `${((e as HTMLElement).innerText || e.getAttribute("aria-label") || (e as HTMLInputElement).name || e.tagName).trim().slice(0, 30)} (${Math.round(e.getBoundingClientRect().height)}px)`)
  );
}

/**
 * For each element the selector matches: is it on screen, and is it the
 * thing a tap at its centre would land on (nothing drawn over it)?
 */
export async function tappable(page: Page, selector: string) {
  return page.evaluate((selector) =>
    [...document.querySelectorAll(selector)]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden")
      .map((e) => {
        const r = e.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const label = ((e as HTMLElement).innerText || e.getAttribute("aria-label") || "").trim().slice(0, 30);
        if (y < 0 || y > innerHeight) return { label, onScreen: false, hit: false };
        const top = document.elementFromPoint(x, y);
        return { label, onScreen: true, hit: !!top && (e === top || e.contains(top)) };
      }),
    selector
  );
}

/** The item cards in the Inventory list (not the place tiles above them). */
export const LIST_CELLS = "main li:has([data-cell-panel])";
