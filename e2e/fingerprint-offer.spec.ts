import { test, expect, PHONE, DESKTOP, open } from "./helpers";

// The "Recognize photos on this device?" offer (src/components/fingerprint-catch-up.tsx).
// It appears after a photo is saved from a device that hasn't got the model.
// Nov 2026: it never shows on a page where items are added or edited, and it
// can be shrunk to a chip that stays shrunk for the visit.
//
// The fixture theater has photos and no fingerprints, and no device holds the
// model unless a test says so, so marking a photo as just saved is enough to
// earn the offer.

const offer = (page: import("@playwright/test").Page) => page.locator("[data-fingerprint-offer]");
const chip = (page: import("@playwright/test").Page) => page.locator("[data-fingerprint-offer-chip]");

test.beforeEach(async ({ page }) => {
  // What saving a photo from this device leaves behind (markFingerprintsDue).
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem("e2e:due-set")) {
        sessionStorage.setItem("fingerprints:due", "yes");
        sessionStorage.setItem("e2e:due-set", "yes");
      }
    } catch {}
  });
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the offer says Recognize, in American spelling, and can be shrunk to a chip and opened again", async ({ page }) => {
    await open(page, "/inventory");
    await expect(offer(page)).toBeVisible({ timeout: 10_000 });
    await expect(offer(page)).toContainText("Recognize photos on this device?");
    await expect(page.locator("body")).not.toContainText(/Recognis/);

    await offer(page).getByRole("button", { name: "Minimize" }).click();
    await expect(offer(page)).toHaveCount(0);
    await expect(chip(page)).toBeVisible();
    await expect(chip(page)).toHaveText(/^Recognize photos · \d+ waiting$/);

    // The chip is small and stays clear of the tab bar.
    const box = await chip(page).boundingBox();
    const tabBar = await page.locator('nav[aria-label="Main"].fixed').boundingBox();
    expect(box!.height).toBeLessThanOrEqual(48);
    expect(box!.y + box!.height).toBeLessThanOrEqual(tabBar!.y);
    // …and clear of the honey + button, which used to cover the offer's buttons.
    const plus = await page.locator("[data-quick-actions] button[data-hex-toggle]").boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(plus!.y);

    await chip(page).click();
    await expect(offer(page)).toBeVisible();
    const card = await offer(page).boundingBox();
    expect(card!.y + card!.height).toBeLessThanOrEqual(plus!.y);
    await offer(page).getByRole("button", { name: "Download and start" }).click({ trial: true });
    await offer(page).getByRole("button", { name: "Minimize" }).click();
    await expect(chip(page)).toBeVisible();

    await chip(page).click();
    await expect(offer(page)).toBeVisible();
    await expect(chip(page)).toHaveCount(0);
  });

  test("shrunk stays shrunk for the rest of the visit", async ({ page }) => {
    await open(page, "/inventory");
    await offer(page).getByRole("button", { name: "Minimize" }).click();
    await expect(chip(page)).toBeVisible();
    await page.getByRole("link", { name: "Productions" }).last().click();
    await page.waitForURL(/\/productions$/);
    await expect(chip(page)).toBeVisible();
    await expect(offer(page)).toHaveCount(0);
  });

  test("adding an item: no offer while the form is open, then it asks on the next page", async ({ page }) => {
    await open(page, "/items/new");
    // Longer than the catch-up's idle wait (4s at most).
    await page.waitForTimeout(5_000);
    await expect(offer(page)).toHaveCount(0);
    await expect(chip(page)).toHaveCount(0);
    // Still owed: leaving the form is what brings the question.
    expect(await page.evaluate(() => sessionStorage.getItem("fingerprints:due"))).toBe("yes");

    await page.getByRole("link", { name: "Inventory" }).last().click();
    await page.waitForURL(/\/inventory$/);
    await expect(offer(page)).toBeVisible({ timeout: 10_000 });
  });

  test("an offer already showing goes away on an edit page, and comes back after", async ({ page }) => {
    await open(page, "/inventory");
    await expect(offer(page)).toBeVisible({ timeout: 10_000 });
    // A client-side move, like following a link, so the offer isn't reset.
    await page.evaluate(() => {
      (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push("/items/it5/edit");
    });
    await page.waitForURL(/\/items\/it5\/edit$/);
    await expect(page.locator("main form[data-item-form]")).toBeVisible();
    await expect(offer(page)).toHaveCount(0);
    await page.goBack();
    await page.waitForURL(/\/inventory$/);
    await expect(offer(page)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("on a computer", () => {
  test.use(DESKTOP);

  for (const path of ["/items/new", "/items/it5/edit", "/items/import"]) {
    test(`nothing about recognizing photos shows on ${path}`, async ({ page }) => {
      await open(page, path);
      await page.waitForTimeout(5_000);
      await expect(offer(page)).toHaveCount(0);
      await expect(chip(page)).toHaveCount(0);
      await expect(page.getByText(/Recognizing \d+ new/)).toHaveCount(0);
    });
  }
});
