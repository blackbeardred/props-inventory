import { test, expect, DESKTOP, PHONE, open } from "./helpers";

// The copyright notice: on every page, once, and never under the phone's tab
// bar. The wording lives in src/lib/copyright.ts.

const NOTICE = /^© 2026(–\d{4})? Propolis\. All rights reserved\.$/;
const signedOut = { name: "e2e-signed-out", value: "1", domain: "localhost", path: "/" };

test.describe("signed out", () => {
  test.use(DESKTOP);
  test.beforeEach(async ({ context }) => {
    await context.addCookies([signedOut]);
  });

  test("the landing page carries it in its own footer, and only there", async ({ page }) => {
    await open(page, "/");
    await expect(page.locator("footer [data-copyright]")).toHaveText(NOTICE);
    await expect(page.getByText(/All rights reserved/)).toHaveCount(1);
  });

  for (const path of ["/login", "/signup", "/forgot-password", "/privacy", "/survey"]) {
    test(`${path} has it at the foot of the page, once`, async ({ page }) => {
      await open(page, path);
      await expect(page.locator("[data-site-footer]")).toHaveText(NOTICE);
      await expect(page.getByText(/All rights reserved/)).toHaveCount(1);
      // Below the page's content, not beside or over it.
      const main = await page.locator("main").boundingBox();
      const footer = await page.locator("[data-site-footer]").boundingBox();
      expect(footer!.y).toBeGreaterThanOrEqual(main!.y + main!.height - 1);
    });
  }
});

test.describe("signed in, on a computer", () => {
  test.use(DESKTOP);

  test("at the foot of the content, once", async ({ page }) => {
    for (const path of ["/inventory", "/productions", "/theatre"]) {
      await open(page, path);
      await expect(page.locator("[data-app-footer]")).toHaveText(NOTICE);
      await expect(page.locator("[data-site-footer]")).toHaveCount(0);
      await expect(page.getByText(/All rights reserved/)).toHaveCount(1);
    }
  });

  test("it's left off when a page is printed", async ({ page }) => {
    await open(page, "/inventory");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("[data-app-footer]")).toBeHidden();
  });
});

test.describe("signed in, on a phone", () => {
  test.use(PHONE);

  test("scrolled to the bottom, it sits clear of the tab bar", async ({ page }) => {
    await open(page, "/inventory");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const footer = page.locator("[data-app-footer]");
    await expect(footer).toBeInViewport();
    const tabBar = await page.locator('nav[aria-label="Main"].fixed').boundingBox();
    const box = await footer.boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(tabBar!.y);
  });
});
