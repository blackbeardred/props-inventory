import { test, expect, PHONE, DESKTOP, open, noSidewaysScroll } from "./helpers";

// Tryout links (migration 013): a private test copy per person, no account.
// The fixture has one link, TOKEN below, labelled "Tester 1".

const TOKEN = "0123456789abcdef0123456789abcdef";
const BASE = "http://localhost:3100";
const signedOut = { name: "e2e-signed-out", value: "1", domain: "localhost", path: "/" };

test.describe("on a phone", () => {
  test.use(PHONE);

  test("a link opens a test copy with no account, labelled and with feedback", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, `/try/${TOKEN}`);
    // Public: not sent to log in.
    expect(new URL(page.url()).pathname).toBe(`/try/${TOKEN}`);
    await expect(page.locator("h1")).toHaveText("Hi Tester 1,");
    await expect(page.locator("[data-tryout-welcome]")).toContainText("This is your own copy of Propolis to try!");
    await expect(page.locator("[data-tryout-welcome]")).toContainText("“Add to Home Screen”");
    await expect(page.locator("[data-tryout-welcome]")).toContainText("if any function isn’t intuitive.");
    await expect(page).toHaveTitle("Your test copy · Propolis");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await noSidewaysScroll(page);
    // Nothing happens until the button: a link preview mustn't sign anyone in.
    expect((await context.cookies()).some((c) => c.name === "e2e-anonymous")).toBe(false);

    await page.locator("[data-open-tryout] button").click();
    await page.waitForURL("**/inventory");
    expect((await context.cookies()).some((c) => c.name === "e2e-anonymous")).toBe(true);
    const banner = page.locator("[data-tryout-banner]");
    await expect(banner).toContainText("Test copy for Tester 1.");
    const feedback = banner.getByRole("link", { name: "Send feedback" });
    await expect(feedback).toHaveAttribute("href", /^mailto:arjunallenbhatkhande@gmail\.com\?subject=Propolis%20feedback%20from%20Tester%201$/);
    await noSidewaysScroll(page);
  });

  test("a tester's account page has nothing to manage but their name", async ({ page, context }) => {
    await context.addCookies([{ name: "e2e-anonymous", value: "1", domain: "localhost", path: "/" }]);
    await open(page, "/account");
    await expect(page.locator("[data-tryout-account]")).toContainText("open the same link again");
    await expect(page.locator("#you")).toHaveCount(1);
    await expect(page.locator("#theatres")).toHaveCount(1);
    for (const id of ["email", "password"]) await expect(page.locator(`#${id}`)).toHaveCount(0);
    await expect(page.getByLabel("Join another theatre with its invite code")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Leave" })).toHaveCount(0);
    await expect(page.locator("main")).toContainText("Your test copy stays as it is");
    // A tester may still log in or sign up for real.
    await open(page, "/signup");
    expect(new URL(page.url()).pathname).toBe("/signup");
  });
});

test.describe("added to a home screen", () => {
  test.use(PHONE);

  test("the link's page offers a manifest that opens this test copy", async ({ page, context, request }) => {
    await context.addCookies([signedOut]);
    await open(page, `/try/${TOKEN}`);
    const links = page.locator('link[rel="manifest"]');
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute("href", `/try/${TOKEN}/manifest.webmanifest`);
    const manifest = await (await request.get(`/try/${TOKEN}/manifest.webmanifest`)).json();
    expect(manifest.name).toBe("Propolis");
    expect(manifest.start_url).toBe(`/try/${TOKEN}?open=1`);
    expect(manifest.id).toBe(`/try/${TOKEN}`);
    expect(manifest.icons.length).toBeGreaterThan(0);
    expect((await request.get("/try/not-a-token/manifest.webmanifest")).status()).toBe(404);
    // The site's own manifest is unchanged.
    expect((await (await request.get("/manifest.webmanifest")).json()).start_url).toBe("/inventory");
  });

  test("opened from the home screen with no session, it signs in by itself", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, `/try/${TOKEN}?open=1`);
    await page.waitForURL("**/inventory");
    expect((await context.cookies()).some((c) => c.name === "e2e-anonymous")).toBe(true);
    await expect(page.locator("[data-tryout-banner]")).toContainText("Test copy for Tester 1.");
  });

  test("opened from the home screen already signed in, it goes straight in", async ({ page, context }) => {
    await context.addCookies([{ name: "e2e-anonymous", value: "1", domain: "localhost", path: "/" }]);
    const response = await page.goto(`${BASE}/try/${TOKEN}?open=1`);
    await page.waitForURL("**/inventory");
    expect(response?.ok()).toBe(true);
    await expect(page.locator("[data-tryout-banner]")).toBeVisible();
  });

  test("a wrong link from the home screen just says it isn't working", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, "/try/0000000000000000000000000000dead?open=1");
    await expect(page.locator("h1")).toHaveText("This link isn’t working");
  });
});

test.describe("on a computer", () => {
  test.use(DESKTOP);

  test("a wrong link says so, and offers nothing to open", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, "/try/not-a-real-token");
    await expect(page.locator("h1")).toHaveText("This link isn’t working");
    await expect(page.locator("[data-open-tryout]")).toHaveCount(0);
  });

  test("when anonymous sign-ins are off, the link says so instead of failing", async ({ page, context }) => {
    await context.addCookies([signedOut, { name: "e2e-no-anonymous", value: "1", domain: "localhost", path: "/" }]);
    await open(page, `/try/${TOKEN}`);
    await page.locator("[data-open-tryout] button").click();
    await page.waitForURL(/error=/);
    await expect(page.locator("main")).toContainText("Test links aren’t switched on yet");
  });

  test("someone already signed in is told what opening it does, and keeps their account", async ({ page, context }) => {
    await open(page, `/try/${TOKEN}`);
    await expect(page.locator("[data-tryout-signed-in]")).toContainText("signed in as stage.manager@example.com");
    await page.locator("[data-open-tryout] button").click();
    await page.waitForURL("**/inventory");
    expect((await context.cookies()).some((c) => c.name === "e2e-anonymous")).toBe(false);
    // A real account sees no tester banner.
    await expect(page.locator("[data-tryout-banner]")).toHaveCount(0);
  });

  test("a real account sees no tester banner, and still can't revisit log-in", async ({ page }) => {
    await open(page, "/inventory");
    await expect(page.locator("[data-tryout-banner]")).toHaveCount(0);
    await page.goto(`${BASE}/login`);
    expect(new URL(page.url()).pathname).toBe("/inventory");
  });
});
