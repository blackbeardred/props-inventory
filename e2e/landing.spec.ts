import { test, expect, DESKTOP, PHONE, open, noSidewaysScroll, smallTapTargets } from "./helpers";

// The front door (built from the Figma landing page, Nov 2026) and the
// privacy policy, both open to anyone signed out.

const signedOut = { cookies: [{ name: "e2e-signed-out", value: "1", domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const }], origins: [] };
const TABLET = { viewport: { width: 768, height: 1024 } } as const;
const WIDE = { viewport: { width: 1440, height: 900 } } as const;

test.describe("signed out", () => {
  test.use({ ...DESKTOP, storageState: signedOut });

  test("the landing page says what Propolis is, in the designs' order and words", async ({ page }) => {
    await open(page, "/");
    await expect(page.locator("h1")).toHaveText("Every prop, every costume, exactly where you left it.");
    await expect(page.locator("main")).not.toContainText("Day 1");
    await expect(page.locator("main h2")).toHaveText([
      "Everything backstage, findable.",
      "From the shelf to the stage in three steps.",
      "Built for the people behind the curtain.",
      "Bring order to the prop room.",
    ]);
    await expect(page.locator("#what-it-does li")).toHaveCount(6);
    await expect(page.locator("#how-it-works li")).toHaveCount(3);
    await expect(page.locator("#who-its-for li")).toHaveCount(4);
    await expect(page.locator("#who-its-for")).toContainText("Directors");
    // American English, like the designs.
    await expect(page.locator("main")).not.toContainText(/theatre|colour/i);
    await expect(page.getByRole("link", { name: "Start your theater" }).first()).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Join with an invite code" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    await page.getByRole("link", { name: "Privacy" }).click();
    await page.waitForURL(/\/privacy$/);
    await expect(page.locator("h1")).toHaveText("Privacy policy");
    await expect(page.locator("main")).toContainText("Anthropic");
    await expect(page.locator("main")).toContainText("Arjun Bhatkhande");
    await expect(page.getByRole("link", { name: "arjunallenbhatkhande@gmail.com" }).first()).toHaveAttribute("href", "mailto:arjunallenbhatkhande@gmail.com");
  });

  test("the menu links scroll to their sections", async ({ page }) => {
    await open(page, "/");
    const nav = page.getByRole("navigation", { name: "On this page" });
    await expect(nav.getByRole("link")).toHaveText(["What it does", "How it works", "Who it’s for"]);
    await nav.getByRole("link", { name: "Who it’s for" }).click();
    await expect(page).toHaveURL(/#who-its-for$/);
    await expect(page.locator("#who-its-for h2")).toBeInViewport();
    await page.getByRole("link", { name: "See how it works" }).click();
    await expect(page.locator("#how-it-works h2")).toBeInViewport();
  });

  test("the honeycomb's cells are true hexagons, with the search card over them", async ({ page }) => {
    await open(page, "/");
    const cells = page.locator("[data-landing-honeycomb] .hex.h-full");
    await expect(cells).toHaveCount(6);
    for (const box of await cells.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()))) {
      expect(box.width / box.height).toBeCloseTo(1.155, 1);
    }
    await expect(page.locator("[data-landing-search-card]:visible")).toHaveCount(1);
    await expect(page.locator("[data-landing-search-card]:visible")).toContainText("3 matches");
    await expect(page.locator('img[src="/landing/doublet.jpg"]')).toBeVisible();
  });

  test("sign-up links to the privacy policy", async ({ page }) => {
    await open(page, "/signup");
    await expect(page.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy");
  });
});

test.describe("at each width", () => {
  for (const [name, size] of [["phone", PHONE], ["tablet", TABLET], ["laptop", DESKTOP], ["desktop", WIDE]] as const) {
    test(`${name}: fits, and every link is thumb-sized`, async ({ browser }) => {
      const context = await browser.newContext({ ...size, storageState: signedOut });
      const page = await context.newPage();
      await open(page, "/");
      await noSidewaysScroll(page);
      expect(await smallTapTargets(page)).toEqual([]);
      const cells = await page.locator("[data-landing-honeycomb] .hex.h-full").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width / e.getBoundingClientRect().height));
      for (const r of cells) expect(r).toBeCloseTo(1.155, 1);
      await context.close();
    });
  }
});

test.describe("signed out, on a phone", () => {
  test.use({ ...PHONE, storageState: signedOut });

  test("the section links are chips under the bar, and the hero stacks", async ({ page }) => {
    await open(page, "/");
    const chips = page.locator("[data-jump-links] a");
    await expect(chips).toHaveText(["What it does", "How it works", "Who it’s for"]);
    await expect(page.getByRole("navigation", { name: "On this page" })).toBeHidden();
    expect(await page.locator("[data-nav-primary]").innerText()).toBe("Try it");
    await chips.nth(1).click();
    await expect(page.locator("#how-it-works h2")).toBeInViewport();
    for (const path of ["/privacy"]) {
      await open(page, path);
      await noSidewaysScroll(page);
      expect(await smallTapTargets(page), path).toEqual([]);
    }
  });
});

test.describe("signed in", () => {
  test.use(DESKTOP);
  test("the landing page offers the way back in", async ({ page }) => {
    await open(page, "/");
    await expect(page.getByRole("link", { name: "Open my inventory" }).first()).toHaveAttribute("href", "/inventory");
    await expect(page.getByRole("link", { name: "Start your theater" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);
  });
});
