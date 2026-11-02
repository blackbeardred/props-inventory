import { test, expect, PHONE, open, noSidewaysScroll } from "./helpers";

// Theatre is the theatre's own settings; Your account is everything about
// you. They were one long page until Oct 2026.

test.use(PHONE);

test("Theatre: members, invite code and the shared tools, and nothing personal", async ({ page }) => {
  await open(page, "/theatre");
  await expect(page.locator("main h1")).toHaveText("Theatre");
  for (const id of ["members", "photos", "deleted"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await expect(page.getByText("163ECD01").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy" })).toHaveCount(1);
  await expect(page.locator('a[href="/items/fingerprints"]')).toHaveCount(1);
  await expect(page.locator('a[href="/items/lookalike"]')).toHaveCount(1);
  for (const id of ["you", "theatres", "email", "password", "device"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(0);
  }
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
  await expect(page.locator('main a[href="/account"]')).toHaveCount(1);
  await expect(page).toHaveTitle("Theatre · Propolis");
  await noSidewaysScroll(page);
});

test("Your account: name, theatres, sign-in, this device, and nothing about the theatre", async ({ page }) => {
  await open(page, "/account");
  expect(new URL(page.url()).pathname).toBe("/account");
  await expect(page.locator("main h1")).toHaveText("Your account");
  for (const id of ["you", "theatres", "email", "password", "device"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  await expect(page.getByLabel("Display name")).toBeVisible();
  await expect(page.getByLabel("Join another theatre with its invite code")).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(2);
  await expect(page.getByText(/Install the app|Installed on this device/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Switch account" })).toBeVisible();
  for (const id of ["members", "photos", "deleted"]) {
    await expect(page.locator(`#${id}`)).toHaveCount(0);
  }
  await expect(page.locator("[data-rename-theatre]")).toHaveCount(0);
  await expect(page.getByText("163ECD01")).toHaveCount(0);
  await expect(page.locator('main a[href="/theatre"]')).toHaveCount(1);
  await expect(page).toHaveTitle("Your account · Propolis");
  await noSidewaysScroll(page);
});

test("the avatar in the header goes to your account", async ({ page }) => {
  await open(page, "/inventory");
  await page.locator('header a[href="/account"]:visible').first().click();
  await page.waitForURL(/\/account/);
  await expect(page.locator("main h1")).toHaveText("Your account");
});

test("the fingerprint page counts what's outstanding", async ({ page }) => {
  await open(page, "/items/fingerprints");
  await expect(page.locator("main")).not.toContainText("Couldn't read the inventory");
  await expect(page.locator("main h1")).toBeVisible();
});

test("Switch account signs out and goes straight to log in", async ({ page }) => {
  await open(page, "/account");
  await page.getByRole("button", { name: "Switch account" }).click();
  await page.waitForURL(/\/login\?switched=1$/);
  await expect(page.locator("[data-switched-account]")).toContainText("You’re signed out");
  await expect(page.locator("main")).toContainText("Log in with the other account.");
  await expect(page.getByLabel("Email")).toHaveValue("");
  // Really signed out: the app sends you back to log in.
  await open(page, "/inventory");
  expect(new URL(page.url()).pathname).toBe("/login");
});

test("Log out signs out and goes to the front door", async ({ page }) => {
  await open(page, "/account");
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.locator("h1")).toContainText("Every prop");
  await open(page, "/inventory");
  expect(new URL(page.url()).pathname).toBe("/login");
});

test("Start a new theater: you own it, you're in it, and your other theater stays", async ({ page }) => {
  await open(page, "/account");
  const form = page.locator("[data-create-theatre]");
  await expect(form).toContainText("You’ll be its owner");
  await form.getByLabel("Start a new theater").fill("  Riverside   Players ");
  await form.getByRole("button", { name: "Create theater" }).click();
  await page.waitForURL(/\/theatre\?notice=theatre-created/);
  await expect(page.locator("main")).toContainText("Your new theater is ready");
  await expect(page.locator("#members")).toContainText("Riverside Players");
  await expect(page.locator("#members")).toContainText("Owner");
  // Both theaters, the new one current, from the switcher in the header.
  const switcher = page.locator("header details").first();
  await expect(switcher.locator("summary")).toContainText("Riverside Players");
  await switcher.locator("summary").click();
  await expect(switcher).toContainText("SPARC");
  await expect(switcher.getByRole("link", { name: "Join or start a theater" })).toHaveAttribute("href", "/account#theatres");
  await open(page, "/account");
  await expect(page.locator("#theatres li")).toHaveCount(2);
});
