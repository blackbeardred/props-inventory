import { test, expect, DESKTOP, PHONE, open } from "./helpers";
import { HANDOVER_TOKEN } from "./fixtures/db";

// School theaters (migration 018): one account, the teacher's. The database
// enforces it (supabase/tests/school_test.sh); these check what people see.

const signedOut = { name: "e2e-signed-out", value: "1", domain: "localhost", path: "/" };
const anonymous = { name: "e2e-anonymous", value: "1", domain: "localhost", path: "/" };

test.describe("starting a school", () => {
  test.use(DESKTOP);

  test("Start a new theater can make it a school, which then has nothing about adding people", async ({ page }) => {
    await open(page, "/account");
    const form = page.locator("[data-create-theatre]");
    await form.getByLabel("Start a new theater").fill("Hillside High Drama");
    await form.getByText("This is a school").click();
    await form.getByRole("button", { name: "Create theater" }).click();
    await page.waitForURL(/\/theatre\?notice=school-created/);

    await expect(page.getByText("Your school theater is ready")).toBeVisible();
    const main = page.locator("main");
    await expect(main.locator("[data-school-note]")).toContainText("One account: yours");
    await expect(main.locator("[data-invite-code]")).toHaveCount(0);
    await expect(main.getByRole("button", { name: /Promote|Demote|Remove/ })).toHaveCount(0);
    await expect(main.getByRole("button", { name: "Generate new code" })).toHaveCount(0);
    // Nothing on show says "invite". (The closed "Turn off school mode" box
    // mentions one, about what turning it off would mean.)
    const shown = await main.evaluate((el) => {
      const copy = el.cloneNode(true) as HTMLElement;
      copy.querySelectorAll("details:not([open]) > :not(summary)").forEach((n) => n.remove());
      return copy.textContent ?? "";
    });
    expect(shown).not.toMatch(/invite/i);
    expect(shown).toContain("Turn off school mode");
    await expect(main.locator("#handover")).toBeVisible();

    // Your account marks it, and offers no Leave for it.
    await open(page, "/account");
    const row = page.locator("li", { hasText: "Hillside High Drama" });
    await expect(row.getByText("School", { exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Leave" })).toHaveCount(0);
    await expect(row.locator("[data-school-leave-note]")).toBeVisible();
    // An ordinary theater still has its Leave.
    await expect(page.locator("li", { hasText: "SPARC" }).getByRole("button", { name: "Leave" })).toBeVisible();
  });

  test("left unticked, a new theater is ordinary, with an invite code", async ({ page }) => {
    await open(page, "/account");
    const form = page.locator("[data-create-theatre]");
    await form.getByLabel("Start a new theater").fill("Community Players");
    await form.getByRole("button", { name: "Create theater" }).click();
    await page.waitForURL(/\/theatre\?notice=theatre-created/);
    await expect(page.locator("main [data-invite-code]")).toBeVisible();
    await expect(page.locator("main [data-school-note]")).toHaveCount(0);
  });
});

test.describe("switching an existing theater", () => {
  test.use(DESKTOP);

  test("alone in it: confirm, and it becomes a school; the confirm closes on a click elsewhere", async ({ page }) => {
    await open(page, "/theatre");
    const section = page.locator("#school");
    await section.getByText("Make this a school").click();
    const confirm = section.locator("[data-school-confirm]");
    await expect(confirm).toHaveAttribute("open", "");
    await expect(confirm).toContainText("The invite code stops working");

    // A click anywhere else closes it, and nothing changes.
    await page.locator("main h1").click();
    await expect(confirm).not.toHaveAttribute("open", "");
    await expect(page.locator("main [data-invite-code]")).toBeVisible();

    await section.getByText("Make this a school").click();
    await confirm.getByRole("button", { name: "Make it a school" }).click();
    await page.waitForURL(/notice=school-on/);
    await expect(page.getByText("This is now a school theater")).toBeVisible();
    await expect(page.locator("main [data-invite-code]")).toHaveCount(0);
    await expect(page.locator("main [data-school-note]")).toBeVisible();
  });

  test("turning school mode off brings back the invite code, empty until made", async ({ page }) => {
    await page.request.post("/api/e2e/reset?school=1");
    await open(page, "/theatre");
    const section = page.locator("#school");
    await section.getByText("Turn off school mode").click();
    await expect(section.locator("[data-school-confirm]")).toContainText("If you invite students");
    await section.getByRole("button", { name: "Turn it off" }).click();
    await page.waitForURL(/notice=school-off/);
    const invite = page.locator("main [data-invite-code]");
    await expect(invite).toContainText("Not set");
    await invite.getByRole("button", { name: "Generate new code" }).click();
    await expect(page.locator("main [data-invite-code]")).toContainText("NEWCODE1");
  });
});

test.describe("with someone else in the theater", () => {
  test.use({ ...DESKTOP, fixtureOptions: "crew=1" });

  test("it says who to remove first, and won't switch", async ({ page }) => {
    await open(page, "/theatre");
    const blocked = page.locator("#school [data-school-blocked]");
    await expect(blocked).toContainText("remove everyone else first: Pat.");
    await expect(blocked.getByRole("button", { name: "Make this a school" })).toBeDisabled();
    await expect(page.locator("#school [data-school-confirm]")).toHaveCount(0);
  });
});

test.describe("handing over", () => {
  test.use({ ...DESKTOP, fixtureOptions: "school=1" });

  test("the teacher makes a one-time link, sees it once, and can cancel it", async ({ page }) => {
    await open(page, "/theatre");
    const panel = page.locator("[data-handover]");
    await panel.getByText("Make a handover link").click();
    await expect(panel.locator("[data-handover-confirm]")).toContainText("you lose access straight away");
    await panel.getByRole("button", { name: "Make the link" }).click();

    const box = panel.locator("[data-handover-link]");
    await expect(box).toBeVisible();
    await expect(box).toContainText(/\/handover\/[0-9a-f]{32}/);
    await expect(box).toContainText(/Works once, until \w{3}, \w{3} \d{1,2}\./);
    await expect(box.getByRole("button", { name: "Copy link" })).toBeVisible();
    // The confirm box closed itself once the link was made.
    await expect(panel.locator("[data-handover-confirm]")).not.toHaveAttribute("open", "");

    const link = (await box.textContent())!.match(/\/handover\/[0-9a-f]{32}/)![0];
    await panel.getByRole("button", { name: "Cancel any link" }).click();
    await page.waitForURL(/notice=handover-cancelled/);
    await open(page, link);
    await expect(page.getByRole("heading", { name: "This handover link isn’t working" })).toBeVisible();
  });
});

test.describe("the handover page", () => {
  test.use({ ...DESKTOP, fixtureOptions: "handover=1" });

  test("signed out, it says what's being handed over and offers sign-up and log-in that come back", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, `/handover/${HANDOVER_TOKEN}`);
    await expect(page.getByRole("heading", { name: "Take over Hillside High Drama" })).toBeVisible();
    await expect(page.locator("main")).toContainText("Ms Ortiz is handing this school theater to you");
    const back = encodeURIComponent(`/handover/${HANDOVER_TOKEN}`);
    await expect(page.getByRole("link", { name: "Create an account" })).toHaveAttribute("href", `/signup?next=${back}`);
    await expect(page.getByRole("link", { name: "Log in" })).toHaveAttribute("href", `/login?next=${back}`);

    // The sign-up page carries the way back, and says so.
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page.getByText("Then you’ll go straight back to take over the school theater.")).toBeVisible();
    await expect(page.locator('input[name="next"]')).toHaveValue(`/handover/${HANDOVER_TOKEN}`);
  });

  test("signed in, the new teacher takes it over and the old teacher is gone", async ({ page }) => {
    await open(page, `/handover/${HANDOVER_TOKEN}`);
    const form = page.locator("[data-handover-accept]");
    await expect(form.getByLabel("Your name")).toHaveValue("testname");
    await form.getByRole("button", { name: "Take it over" }).click();
    await page.waitForURL(/\/theatre\?notice=handover-accepted/);
    await expect(page.getByText("You’re the teacher now")).toBeVisible();
    await expect(page.locator("main")).toContainText("Hillside High Drama");
    await expect(page.locator("main [data-school-note]")).toBeVisible();

    // Used up.
    await open(page, `/handover/${HANDOVER_TOKEN}`);
    await expect(page.getByRole("heading", { name: "This handover link isn’t working" })).toBeVisible();
  });

  test("a test-copy user is told to sign up with an email first", async ({ page, context }) => {
    await context.addCookies([anonymous]);
    await open(page, `/handover/${HANDOVER_TOKEN}`);
    await expect(page.locator("[data-handover-anonymous]")).toContainText("sign up with your own email first");
    await expect(page.locator("[data-handover-accept]")).toHaveCount(0);
  });

  test("a made-up link says it isn't working", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, "/handover/0000000000000000000000000000000a");
    await expect(page.getByRole("heading", { name: "This handover link isn’t working" })).toBeVisible();
  });
});

test.describe("test copies", () => {
  test.use(DESKTOP);

  test("a test copy has no school setting", async ({ page, context }) => {
    await context.addCookies([anonymous]);
    await open(page, "/theatre");
    await expect(page.locator("#school")).toHaveCount(0);
    await expect(page.locator("#handover")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use({ ...PHONE, fixtureOptions: "school=1" });

  test("the handover confirm fits on screen", async ({ page }) => {
    await open(page, "/theatre");
    await page.locator("[data-handover]").getByText("Make a handover link").click();
    const box = await page.locator("[data-handover-confirm] > div").boundingBox();
    const width = page.viewportSize()!.width;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  });
});

test.describe("logging in", () => {
  test.use(DESKTOP);

  test("a way back to another site is ignored", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, "/login?next=//evil.example/steal");
    await expect(page.locator('input[name="next"]')).toHaveValue("/inventory");
  });
});
