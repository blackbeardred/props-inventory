import { test, expect, PHONE, open } from "./helpers";

// The business card's QR code opens /card, which forwards to the landing
// page (src/app/card/route.ts), so printed cards can be pointed elsewhere.

test.describe("the business card's QR code", () => {
  test.use(PHONE);

  test("signed out: /card opens the landing page, not log in", async ({ page, context }) => {
    await context.addCookies([{ name: "e2e-signed-out", value: "1", domain: "localhost", path: "/" }]);
    await open(page, "/card");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.locator("[data-landing]")).toBeVisible();
  });

  test("the redirect is temporary and never cached", async ({ request }) => {
    const response = await request.get("/card", { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers()["location"], "http://localhost").pathname).toBe("/");
    expect(response.headers()["cache-control"]).toContain("no-store");
  });
});
