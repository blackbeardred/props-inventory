import { test, expect, PHONE, DESKTOP, open, noSidewaysScroll, smallTapTargets } from "./helpers";
import { readFileSync } from "node:fs";
import { parseXlsx } from "../src/lib/xlsx";

// Survey results (/survey-results, migration 021): only the survey's reader
// sees the responses. The fixture's survey_results answers like the real
// one: responses for survey=reader, a refusal otherwise, and "doesn't exist"
// for survey=pre021 (e2e/fixtures/db.ts).

test.describe("the reader, on a phone", () => {
  test.use({ ...PHONE, fixtureOptions: "survey=reader" });

  test("every response in words, newest first", async ({ page }) => {
    await open(page, "/survey-results");
    await expect(page).toHaveTitle("Survey results · Propolis");
    await expect(page.locator("h1")).toHaveText("Survey results");
    await expect(page.getByText("3 responses to the storage survey, newest first.")).toBeVisible();
    const cards = page.locator("[data-response]");
    await expect(cards).toHaveCount(3);
    await expect(cards.locator("h3")).toHaveText(["Pacific Repertory Theatre", "Santa Cruz Actors' Theatre", "Theater not given"]);

    const scat = page.locator("#r-resp-scat");
    await expect(scat).toContainText("Board president/executive director");
    await expect(scat).toContainText("Nov 10, 2026, 4:03 PM");
    await expect(scat.locator('[data-answer="find"] dd')).toHaveText("We ask someone who knows");
    await expect(scat.locator('[data-answer="problems"] li')).toHaveText([
      "Couldn’t find something we knew we had",
      "Something wasn’t put back after a show",
      "New crew or volunteers didn’t know where things go",
    ]);
    await expect(scat.locator('[data-answer="importance"]')).toContainText("Knowing the exact room, shelf and boxVery");
    await expect(scat.locator('[data-answer="anything_else"] blockquote')).toContainText("nobody on the Board has seen");
    // Stored values never show through.
    await expect(scat).not.toContainText("cant-find");
    await expect(scat).not.toContainText("under-200");

    const pacrep = page.locator("#r-resp-pacrep");
    await expect(pacrep.locator("[data-contact]")).toHaveText("Open to a call: (831) 555-0142");
    await expect(pacrep.locator("[data-contact] a")).toHaveAttribute("href", "tel:8315550142");
    await expect(pacrep.locator('[data-answer="tracking"] li')).toHaveText(["A spreadsheet (Excel or Google Sheets)", "Other: A whiteboard"]);

    const old = page.locator("#r-resp-old");
    await expect(old.locator("[data-contact] a")).toHaveAttribute("href", "mailto:early@example.com");
    await expect(old).toContainText("Answers to questions the survey no longer asks");
    await expect(old).toContainText("pay: maybe");

    await noSidewaysScroll(page);
    expect(await smallTapTargets(page)).toEqual([]);
  });

  test("the notification's link opens its response", async ({ page }) => {
    await open(page, "/survey-results#r-resp-scat");
    const card = page.locator("#r-resp-scat");
    await expect(card).toBeInViewport();
    // Marked with the honey ring, so it's clear which one it was.
    expect(await card.evaluate((el) => el.matches(":target"))).toBe(true);
  });

  test("totals and the price range", async ({ page }) => {
    await open(page, "/survey-results");
    await page.getByRole("link", { name: "Totals", exact: true }).click();
    const role = page.locator('[data-total="role"]');
    await expect(role).toContainText("3 answers");
    await expect(role.locator("li").filter({ has: page.getByText("Stage manager", { exact: true }) })).toContainText("1");
    await expect(role).toContainText("In their words: Board president/executive director");
    const problems = page.locator('[data-total="problems"]');
    await expect(problems).toContainText("2 answers · people could pick several");
    await expect(problems.locator("li").filter({ hasText: "Couldn’t find something we knew we had" })).toContainText("2");
    await expect(page.locator('[data-total="software_name"]')).toContainText("Sortly");

    const price = page.locator("[data-price-range]");
    await expect(price.locator("[data-price-summary]")).toHaveText("Acceptable: $15–30 a month. Most often called a bargain: $5–15.");
    await expect(price).toContainText("From 2 answers.");
    await expect(price.locator("[data-acceptable]")).toHaveCount(1);
    await noSidewaysScroll(page);
  });

  test("the spreadsheet download", async ({ page }) => {
    await open(page, "/survey-results");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("[data-survey-download]").click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^survey-responses-\d{4}-\d{2}-\d{2}\.xlsx$/);
    const bytes = readFileSync((await download.path())!);
    const { table: rows } = await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(rows).toHaveLength(4);
    expect(rows[0].slice(0, 3)).toEqual(["Received", "Theater", "Role"]);
    expect(rows[1][1]).toBe("Pacific Repertory Theatre");
    expect(rows[2][2]).toBe("Board president/executive director");
    expect(rows[1]).toContain("(831) 555-0142");
  });

  test("Your account links to it", async ({ page }) => {
    await open(page, "/account");
    await page.locator("[data-survey-results-link]").click();
    await expect(page).toHaveURL(/\/survey-results$/);
  });
});

test.describe("the reader, on a desktop", () => {
  test.use({ ...DESKTOP, fixtureOptions: "survey=reader" });

  test("responses beside the totals", async ({ page }) => {
    await open(page, "/survey-results");
    const responses = await page.locator("#responses").boundingBox();
    const totals = await page.locator("#price").boundingBox();
    expect(responses && totals && totals.x > responses.x + responses.width - 1).toBe(true);
    await noSidewaysScroll(page);
  });
});

test.describe("no responses yet", () => {
  test.use({ ...PHONE, fixtureOptions: "survey=empty" });

  test("says so, with nothing to download", async ({ page }) => {
    await open(page, "/survey-results");
    await expect(page.getByText("Nobody has answered the storage survey yet.")).toBeVisible();
    await expect(page.locator("[data-survey-download]")).toHaveCount(0);
  });
});

test.describe("anyone else", () => {
  test.use(PHONE);

  test("sees no responses, and the line to make themselves the reader", async ({ page }) => {
    await open(page, "/survey-results");
    await expect(page.locator("[data-survey-results-locked]")).toContainText("This page is private");
    await expect(page.locator("[data-response]")).toHaveCount(0);
    await expect(page.locator("[data-reader-sql]")).toContainText("values ('survey_reader', 'u1')");
    await noSidewaysScroll(page);
  });

  test("the download sends them back to the page", async ({ page }) => {
    await open(page, "/survey-results/download");
    await expect(page).toHaveURL(/\/survey-results$/);
    await expect(page.locator("[data-survey-results-locked]")).toBeVisible();
  });

  test("Your account has no link", async ({ page }) => {
    await open(page, "/account");
    await expect(page.locator("h1")).toHaveText("Your account");
    await expect(page.locator("[data-survey-results-link]")).toHaveCount(0);
  });

  test("signed out: sent to log in, then back here", async ({ page, context }) => {
    await context.addCookies([{ name: "e2e-signed-out", value: "1", domain: "localhost", path: "/" }]);
    await open(page, "/survey-results");
    expect(new URL(page.url()).pathname).toBe("/login");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/survey-results");
  });
});

test.describe("before migration 021", () => {
  test.use({ ...PHONE, fixtureOptions: "survey=pre021" });

  test("says what to run", async ({ page }) => {
    await open(page, "/survey-results");
    await expect(page.locator("[data-survey-results-locked]")).toContainText("Run migration 021");
    await expect(page.locator("[data-reader-sql]")).toHaveCount(0);
  });

  test("Your account still opens, with no link", async ({ page }) => {
    await open(page, "/account");
    await expect(page.locator("h1")).toHaveText("Your account");
    await expect(page.locator("[data-survey-results-link]")).toHaveCount(0);
  });
});
