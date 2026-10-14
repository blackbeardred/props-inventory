import { test, expect, DESKTOP, PHONE, open, noSidewaysScroll, smallTapTargets } from "./helpers";

// The front door and the privacy policy, both open to anyone signed out.

test.describe("signed out", () => {
  test.use({ ...DESKTOP, storageState: { cookies: [{ name: "e2e-signed-out", value: "1", domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }], origins: [] } });

  test("the landing page says what Propolis is, with no build log left on it", async ({ page }) => {
    await open(page, "/");
    await expect(page.locator("h1")).toContainText("Every prop");
    await expect(page.locator("main")).not.toContainText("Day 1");
    await expect(page.locator("main")).not.toContainText("scaffold");
    await expect(page.getByRole("link", { name: "Set up your theatre" })).toHaveAttribute("href", "/signup");
    await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
    await page.getByRole("link", { name: "Privacy" }).click();
    await page.waitForURL(/\/privacy$/);
    await expect(page.locator("h1")).toHaveText("Privacy policy");
    await expect(page.locator("main")).toContainText("Anthropic");
  });

  test("sign-up links to the privacy policy", async ({ page }) => {
    await open(page, "/signup");
    await expect(page.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy");
  });
});

test.describe("signed out, on a phone", () => {
  test.use({ ...PHONE, storageState: { cookies: [{ name: "e2e-signed-out", value: "1", domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" }], origins: [] } });

  test("both pages fit the screen and their links are thumb-sized", async ({ page }) => {
    for (const path of ["/", "/privacy"]) {
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
    await expect(page.getByRole("link", { name: "Set up your theatre" })).toHaveCount(0);
  });
});
