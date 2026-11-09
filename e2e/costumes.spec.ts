import { test, expect, DESKTOP, PHONE, open } from "./helpers";

// Costumes on pull lists (migration 019). With costumes=1 the sample theatre
// has a past show, Brigadoon (2024), whose list had a Margaret costume (long
// white dress, tartan shawl, clogs) and an oil lantern; and the corset is
// pulled for Oliver! right now. Noises Off! (prod1) is the show being built.

const LIST = "main [data-add-costume]";

async function addCostume(page: import("@playwright/test").Page, name: string) {
  const form = page.locator(LIST).locator("form").first();
  await form.getByPlaceholder("Character, e.g. Margaret").fill(name);
  await form.getByRole("button", { name: "Add costume" }).click();
}

test.describe("building a costume", () => {
  test.use({ ...DESKTOP, fixtureOptions: "costumes=1" });

  test("Add costume makes 'Margaret costume', opened and ready for pieces", async ({ page }) => {
    await open(page, "/productions/prod1");
    await addCostume(page, "Margaret");
    await page.waitForURL(/open=/);

    const costume = page.locator('[data-costume="Margaret costume"]');
    await expect(costume).toHaveAttribute("data-open", "true");
    await expect(costume.locator("[data-costume-summary]")).toHaveText("0 pieces yet");
    await expect(costume).toContainText("No pieces yet");
    // The list is in two parts now, and the props are under Props.
    await expect(page.locator('[data-section="costumes"] h3')).toHaveText("Costumes");
    await expect(page.locator('[data-section="props"] h3')).toHaveText("Props");
    await expect(page.locator('[data-section="props"]')).toContainText("Fishing Net");
  });

  test("a piece added with the search, then suggestions from the past show, with Add", async ({ page }) => {
    await open(page, "/productions/prod1");
    await addCostume(page, "Margaret costume");
    await page.waitForURL(/open=/);
    const costume = page.locator('[data-costume="Margaret costume"]');

    const add = costume.locator("[data-add-piece]");
    await add.getByRole("textbox").fill("Long white");
    // Enter pins the word, which also closes its suggestion box over the results.
    await add.getByRole("textbox").press("Enter");
    await add.getByRole("button", { name: /^Long white dress Costume Storage/ }).click();
    await expect(add.locator('input[name="itemId"]')).toHaveValue("it-dress");
    await add.getByRole("button", { name: "Add piece" }).click();
    await page.waitForURL(/open=/);

    await expect(costume.locator("[data-costume-summary]")).toHaveText("1 piece · 0 pulled");
    await expect(costume.locator("[data-pull-row]")).toContainText("Long white dress");

    // Brigadoon's Margaret wore the shawl and clogs with it; the lantern was
    // only on the same list.
    const suggestions = costume.locator("[data-suggestions]");
    await expect(suggestions).toContainText("Pulled with these before");
    await expect(suggestions.locator("li")).toHaveText([
      /Clogs\s*with Margaret costume, 1 show/,
      /Tartan shawl\s*with Margaret costume, 1 show/,
      /Oil Lantern\s*1 show/,
    ]);
    await suggestions.locator("li", { hasText: "Tartan shawl" }).getByRole("button", { name: "Add" }).click();
    await page.waitForURL(/open=/);
    await expect(costume.locator("[data-costume-summary]")).toHaveText("2 pieces · 0 pulled");
    // Once on the list, it's no longer suggested.
    await expect(costume.locator("[data-suggestions]")).not.toContainText("Tartan shawl");
  });

  test("reuse a costume from a past show copies its pieces", async ({ page }) => {
    await open(page, "/productions/prod1");
    const reuse = page.locator("[data-reuse-costume]");
    await expect(reuse.locator("option")).toHaveText(["Margaret costume · Brigadoon (2024)"]);
    await reuse.getByRole("button", { name: "Reuse it" }).click();
    await page.waitForURL(/open=/);
    const costume = page.locator('[data-costume="Margaret costume"]');
    await expect(costume.locator("[data-costume-summary]")).toHaveText("3 pieces · 0 pulled");
    await expect(costume.locator("[data-pull-row]")).toHaveCount(3);
  });

  test("the costume opens and closes with its hexagon, and counts what's pulled", async ({ page }) => {
    await open(page, "/productions/prod1");
    await page.locator("[data-reuse-costume]").getByRole("button", { name: "Reuse it" }).click();
    await page.waitForURL(/open=/);
    const costume = page.locator('[data-costume="Margaret costume"]');
    const toggle = costume.locator("[data-costume-toggle]");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    // Mark one piece pulled.
    await costume.locator("[data-pull-row]", { hasText: "Clogs" }).getByRole("button", { name: "Pulled" }).click();
    await expect(costume.locator("[data-costume-summary]")).toHaveText("3 pieces · 1 pulled");
    // Changing a piece doesn't shut the costume it's in.
    await expect(costume).toHaveAttribute("data-open", "true");
    await costume.locator("[data-pull-row]", { hasText: "Tartan shawl" }).getByRole("button", { name: "Remove" }).click();
    await page.waitForURL(/open=.*deleted=/);
    await expect(costume).toHaveAttribute("data-open", "true");
    await expect(costume.locator("[data-costume-summary]")).toHaveText("2 pieces · 1 pulled");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(costume.locator("[data-costume-summary]")).toHaveText("3 pieces · 1 pulled");

    // Shut: the panel is out of the way and out of reach.
    await page.goto("/productions/prod1");
    const shut = page.locator('[data-costume="Margaret costume"]');
    await expect(shut.locator("[data-costume-toggle]")).toHaveAttribute("aria-expanded", "false");
    await expect(shut.locator("[data-costume-panel]")).toHaveAttribute("inert", "");
    const height = await shut.locator("[data-costume-panel]").evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeLessThan(2);
    await shut.locator("[data-costume-toggle]").click();
    await expect(shut.locator("[data-costume-panel]")).not.toHaveAttribute("inert", "");
    await expect.poll(() => shut.locator("[data-costume-panel]").evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThan(100);
  });

  test("a costume piece on its own is nudged into a costume, and can be taken out again", async ({ page }) => {
    // The corset goes on the list loose, as a single item.
    await open(page, "/productions/prod1");
    await addCostume(page, "Margaret");
    await page.waitForURL(/open=/);
    const itemForm = page.locator("main form", { has: page.getByRole("button", { name: "Add item" }) });
    await itemForm.getByRole("textbox").fill("Corset");
    // Enter pins the word, which also closes its suggestion box over the results.
    await itemForm.getByRole("textbox").press("Enter");
    await itemForm.getByRole("button", { name: /^Corset Costume Storage/ }).click();
    await expect(itemForm.locator('input[name="itemId"]')).toHaveValue("it-corset");
    await itemForm.getByRole("button", { name: "Add item" }).click();
    await page.waitForURL(/\/productions\/prod1$/);

    const loose = page.locator('[data-section="costumes"] > ul > [data-pull-row]', { hasText: "Corset" });
    const nudge = loose.locator("[data-costume-nudge]");
    await expect(nudge).toContainText("Part of a costume?");
    await nudge.getByRole("button", { name: "Add to it" }).click();
    await page.waitForURL(/open=/);
    const costume = page.locator('[data-costume="Margaret costume"]');
    await expect(costume.locator("[data-pull-row]", { hasText: "Corset" })).toBeVisible();

    await costume.locator("[data-pull-row]", { hasText: "Corset" }).getByRole("button", { name: "Take out of Margaret costume" }).click();
    await page.waitForURL(/\/productions\/prod1$/);
    await expect(page.locator('[data-section="costumes"] > ul > [data-pull-row]', { hasText: "Corset" })).toBeVisible();
  });

  test("deleting a costume: keep its pieces, or take them too; both restore", async ({ page }) => {
    await open(page, "/productions/prod1");
    await page.locator("[data-reuse-costume]").getByRole("button", { name: "Reuse it" }).click();
    await page.waitForURL(/open=/);
    const costume = page.locator('[data-costume="Margaret costume"]');

    // The confirm opens, and a click elsewhere closes it.
    await costume.getByText("Delete costume").click();
    const confirm = costume.locator("[data-delete-costume]");
    await expect(confirm).toHaveAttribute("open", "");
    await page.locator("main h1").click();
    await expect(confirm).not.toHaveAttribute("open", "");

    await costume.getByText("Delete costume").click();
    await confirm.getByRole("button", { name: "Keep its pieces on the list" }).click();
    await page.waitForURL(/deleted=/);
    await expect(page.locator('[data-costume="Margaret costume"]')).toHaveCount(0);
    // The three pieces are still there, loose, under Costumes.
    await expect(page.locator('[data-section="costumes"] > ul > [data-pull-row]')).toHaveCount(3);

    // Undo puts the costume back together.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-costume="Margaret costume"] [data-costume-summary]')).toHaveText("3 pieces · 0 pulled");

    // This time, take the pieces too.
    await page.goto("/productions/prod1");
    const again = page.locator('[data-costume="Margaret costume"]');
    await again.locator("[data-costume-toggle]").click();
    await again.getByText("Delete costume").click();
    await again.locator("[data-delete-costume]").getByRole("button", { name: "Remove its pieces too" }).click();
    await page.waitForURL(/deleted=/);
    await expect(page.locator('[data-section="costumes"]')).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator('[data-costume="Margaret costume"] [data-costume-summary]')).toHaveText("3 pieces · 0 pulled");
  });

  test("the checklist says whose costume each piece is for", async ({ page }) => {
    await open(page, "/productions/prod1");
    await page.locator("[data-reuse-costume]").getByRole("button", { name: "Reuse it" }).click();
    await page.waitForURL(/open=/);
    await open(page, "/productions/prod1/checklist");
    await expect(page.locator("main").getByText("Margaret · ").first()).toBeVisible();
    await expect(page.locator("main")).toContainText("Margaret · Tartan shawl");
  });

  test("renaming a costume keeps 'costume' on the end", async ({ page }) => {
    await open(page, "/productions/prod1");
    await addCostume(page, "Margaret");
    await page.waitForURL(/open=/);
    const form = page.locator('[data-costume="Margaret costume"] [data-rename-costume]');
    await form.getByLabel("Costume name").fill("Fiona");
    await form.getByRole("button", { name: "Rename" }).click();
    await expect(page.locator('[data-costume="Fiona costume"]')).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ ...PHONE, fixtureOptions: "costumes=1" });

  test("a costume's row is thumb-sized and its delete confirm fits on screen", async ({ page }) => {
    await open(page, "/productions/prod1");
    await page.locator("[data-reuse-costume]").getByRole("button", { name: "Reuse it" }).click();
    await page.waitForURL(/open=/);
    const toggle = page.locator('[data-costume="Margaret costume"]').locator("[data-costume-toggle]");
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const costume = page.locator('[data-costume="Margaret costume"]');
    await costume.getByText("Delete costume").scrollIntoViewIfNeeded();
    await costume.getByText("Delete costume").click();
    const box = await costume.locator("[data-delete-costume] > div").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  });
});

test.describe("a list with only props", () => {
  test.use(DESKTOP);

  test("with no past costumes there is nothing to reuse, and Add costume is still offered", async ({ page }) => {
    await open(page, "/productions/prod1");
    await expect(page.locator("[data-add-costume]")).toBeVisible();
    await expect(page.locator("[data-reuse-costume]")).toHaveCount(0);
    // No costumes and only props: no section headings at all, as before.
    await expect(page.locator('[data-section="costumes"]')).toHaveCount(0);
    await expect(page.locator('[data-section="props"] h3')).toHaveCount(0);
  });
});
