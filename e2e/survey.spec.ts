import { test, expect, PHONE, DESKTOP, open, noSidewaysScroll } from "./helpers";

// The research survey (/survey, migration 017): public, no account, one
// required question. The fixture's submit_survey runs in the browser:
// __surveySent records what was sent, and __surveyFail makes it refuse.

const signedOut = { name: "e2e-signed-out", value: "1", domain: "localhost", path: "/" };
const sent = (page: import("@playwright/test").Page) =>
  page.evaluate(() => (globalThis as unknown as { __surveySent?: unknown[] }).__surveySent ?? []);
const choose = (page: import("@playwright/test").Page, question: string, label: string) =>
  page.locator(`[data-question="${question}"]`).getByLabel(label, { exact: true }).check();

test.describe("on a phone, with no account", () => {
  test.use(PHONE);

  test("opens without signing in, and asks 17 questions", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, "/survey");
    expect(new URL(page.url()).pathname).toBe("/survey");
    await expect(page).toHaveTitle("Theater storage survey");
    await expect(page.locator("h1")).toHaveText("How does your theater keep track of what’s in storage?");
    await expect(page.locator("[data-question]")).toHaveCount(16);
    await expect(page.getByLabel(/Open to a 15-minute follow-up call/)).toBeVisible();
    // Neutral: the product isn't named in the questions.
    await expect(page.locator("[data-survey-form]")).not.toContainText("Propolis");
    await noSidewaysScroll(page);
  });

  test("the only required question is the role, and nothing is sent without it", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, "/survey");
    await choose(page, "pay", "Yes");
    await page.getByRole("button", { name: "Send my answers" }).click();
    await expect(page.locator("#role-missing")).toContainText("Choose your main role");
    expect(await sent(page)).toEqual([]);
    await choose(page, "role", "Director");
    await expect(page.locator("#role-missing")).toHaveCount(0);
  });

  test("answers are tidied, sent once, and thanked", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, "/survey");
    await choose(page, "role", "Other");
    await page.locator("#role_other").fill("  Dramaturg ");
    await choose(page, "company", "High school or college");
    await choose(page, "tracking", "Paper lists or binders");
    await choose(page, "tracking", "An inventory app or software");
    await page.locator("#tracking_detail").fill("Sortly");
    // "None of these" can't sit with anything else.
    await choose(page, "problems", "Couldn’t find something we knew we had");
    await choose(page, "problems", "None of these");
    await expect(page.locator('[data-question="problems"]').getByLabel("Couldn’t find something we knew we had")).not.toBeChecked();
    await page.locator('[data-scale-row="search"]').getByText("Very", { exact: true }).click();
    await page.locator('[data-scale-row="offline"]').getByText("Not important").click();
    await page.locator("#frustration").fill("Nobody knows where the swords are.");
    await page.locator("#email").fill(" Pat@Example.COM ");
    await noSidewaysScroll(page);
    await page.getByRole("button", { name: "Send my answers" }).click();

    await expect(page.locator("[data-survey-thanks]")).toContainText("Thank you! Your answers are in.");
    expect(await sent(page)).toEqual([
      {
        p_survey: "storage-2026",
        p_answers: {
          role: "other",
          role_other: "Dramaturg",
          company: "school",
          tracking: ["paper", "software"],
          tracking_detail: "Sortly",
          problems: ["none"],
          frustration: "Nobody knows where the swords are.",
          importance: { search: "very", offline: "not" },
        },
        p_email: "pat@example.com",
      },
    ]);
  });

  test("a bad email, or a refusal, says why and keeps the answers", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, "/survey");
    await choose(page, "role", "Stage manager");
    await page.locator("#frustration").fill("Finding things.");
    await page.locator("#email").fill("pat at example");
    await page.getByRole("button", { name: "Send my answers" }).click();
    await expect(page.locator("[data-survey-error]")).toContainText("That email address doesn’t look right");
    expect(await sent(page)).toEqual([]);

    await page.locator("#email").fill("");
    await page.evaluate(() => {
      (globalThis as unknown as { __surveyFail?: string }).__surveyFail = "The survey has had too many answers today. Please try again tomorrow.";
    });
    await page.getByRole("button", { name: "Send my answers" }).click();
    await expect(page.locator("[data-survey-error]")).toContainText("too many answers today");
    await expect(page.locator("#frustration")).toHaveValue("Finding things.");
    await expect(page.locator('[data-question="role"]').getByLabel("Stage manager", { exact: true })).toBeChecked();
  });
});

test.describe("on a computer", () => {
  test.use(DESKTOP);

  test("fits, and someone signed in can answer too", async ({ page }) => {
    await open(page, "/survey");
    expect(new URL(page.url()).pathname).toBe("/survey");
    await noSidewaysScroll(page);
    // Each importance row reads across: label, then the three levels.
    const row = page.locator('[data-scale-row="photos"]');
    const label = await row.locator("span").first().boundingBox();
    const level = await row.getByText("Very", { exact: true }).boundingBox();
    expect(Math.abs((label?.y ?? 0) + (label?.height ?? 0) / 2 - ((level?.y ?? 0) + (level?.height ?? 0) / 2))).toBeLessThan(12);
  });

  test("the privacy policy says how survey answers are kept", async ({ page, context }) => {
    await context.addCookies([signedOut]);
    await open(page, "/privacy");
    await expect(page.locator("main")).toContainText("Surveys");
    await expect(page.locator("main")).toContainText("a scrambled form of your network address is kept for about an hour");
  });
});
