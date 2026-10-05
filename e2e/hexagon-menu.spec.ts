import { test, expect, PHONE, DESKTOP, open } from "./helpers";
import path from "node:path";

// The thumb hexagon: a floating shortcut menu, phones only.

const PROP_TABLE = path.join(__dirname, "fixtures", "prop-table.jpg");

test.describe("phone", () => {
  test.use(PHONE);

  const hex = (page: import("@playwright/test").Page) => page.locator("[data-quick-actions] button[data-hex-toggle]");
  const place = (page: import("@playwright/test").Page) => page.locator("[data-quick-actions]").boundingBox();
  const menuItems = (page: import("@playwright/test").Page) =>
    page.$$eval("#quick-actions-menu [role=menuitem]", (els) =>
      els.map((e) => ({
        text: (e as HTMLElement).innerText.split("\n")[0].trim(),
        top: e.getBoundingClientRect().top,
        height: e.getBoundingClientRect().height,
      }))
    );

  test("thumb-sized, bottom left above the tab bar, honey and shut", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const box = (await hex(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(56);
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.x).toBeLessThan(40);
    expect(box.y + box.height).toBeLessThan(844 - 56);
    const onTop = await page.evaluate(() => {
      const r = document.querySelector("[data-quick-actions] button[data-hex-toggle]")!.getBoundingClientRect();
      return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest("[data-hex-toggle]");
    });
    expect(onTop, "nothing is drawn over it").toBe(true);
    expect(await hex(page).evaluate((e) => [e.className.includes("bg-honey"), getComputedStyle(e).rotate])).toEqual([true, "none"]);
  });

  test("opens like every hexagon: ink, turned 90°, choices above it nearest the thumb first", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const box = (await hex(page).boundingBox())!;
    await hex(page).click();
    await page.waitForTimeout(350);
    expect(await hex(page).evaluate((e) => [e.className.includes("bg-foreground"), getComputedStyle(e).rotate])).toEqual([true, "90deg"]);
    await expect(hex(page)).toHaveAttribute("aria-expanded", "true");
    const items = await menuItems(page);
    expect([...items].sort((a, b) => b.top - a.top).map((i) => i.text)).toEqual(["Add item", "Take picture", "Image search"]);
    expect(items.every((i) => i.top + i.height <= box.y)).toBe(true);
    expect(items.every((i) => i.height >= 48)).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.closest("#quick-actions-menu") !== null)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(hex(page)).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-hex-toggle"))).toBe(true);
    await hex(page).click();
    await page.mouse.click(300, 200);
    await expect(hex(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("flies out left while scrolling, back when it stops; a scroll closes it", async ({ page }) => {
    await open(page, "/inventory?view=list");
    const x0 = (await place(page))!.x;
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(80);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(150);
    expect((await place(page))!.x).toBeLessThan(-40);
    await page.waitForTimeout(700);
    expect(Math.round((await place(page))!.x)).toBe(Math.round(x0));
    await hex(page).click();
    await page.waitForTimeout(200);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(200);
    await expect(hex(page)).toHaveAttribute("aria-expanded", "false");
  });

  test("steps aside while a text field is being typed in", async ({ page }) => {
    await open(page, "/inventory");
    expect(await page.evaluate(() => document.activeElement?.tagName), "Inventory doesn't grab focus").toBe("BODY");
    expect((await place(page))!.x).toBeGreaterThan(0);
    await page.locator("main input[type=text]").focus();
    await page.waitForTimeout(400);
    expect((await place(page))!.x).toBeLessThan(-40);
    await page.locator("main input[type=text]").blur();
    await page.waitForTimeout(400);
    expect((await place(page))!.x).toBeGreaterThan(0);
  });

  test("shortcuts go where they say; the checklist one appears once a checklist's been opened", async ({ page }) => {
    await open(page, "/inventory");
    await hex(page).click();
    await page.getByRole("menuitem", { name: /Image search/ }).click();
    await page.waitForURL("**/items/lookalike");
    await hex(page).click();
    await page.getByRole("menuitem", { name: /Add item/ }).click();
    await page.waitForURL("**/items/new");
    await open(page, "/productions/prod1/checklist");
    await open(page, "/inventory");
    await hex(page).click();
    const back = page.getByRole("menuitem", { name: /Back to my checklist/ });
    await expect(back).toBeVisible();
    await expect(back).toContainText("Noises Off!");
    await back.click();
    await page.waitForURL("**/productions/prod1/checklist");
  });

  test("Take picture → a new prop: the add form opens with the photo in place, once", async ({ page }) => {
    await open(page, "/inventory");
    await hex(page).click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("menuitem", { name: /Take picture/ }).click(),
    ]);
    expect(await chooser.element().getAttribute("capture"), "camera or library, not camera only").toBeNull();
    await chooser.setFiles(PROP_TABLE);
    await expect(page.getByText("What is this?")).toBeVisible();
    const choices = (await menuItems(page)).map((i) => i.text).sort();
    expect(choices).toEqual(["Add as a new prop", "Add as a prop table"]);
    await page.getByRole("menuitem", { name: /Add as a new prop/ }).click();
    await page.waitForURL("**/items/new");
    await expect
      .poll(() => page.evaluate(() => (document.querySelector("input[type=file][name=photo]") as HTMLInputElement).files?.length))
      .toBe(1);
    expect(
      await page.evaluate(() => (document.querySelector("input[type=file][name=photo]") as HTMLInputElement).files![0].name)
    ).toBe("prop-table.jpg");
    await expect(page.locator('main img[src^="blob:"]').first()).toBeVisible();
    await page.reload({ waitUntil: "networkidle" });
    expect(
      await page.evaluate(() => (document.querySelector("input[type=file][name=photo]") as HTMLInputElement).files?.length)
    ).toBe(0);
  });

  test("Take picture → a prop table: pick the show, and its photo screen reads it straight away", async ({ page }) => {
    await open(page, "/inventory");
    await hex(page).click();
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("menuitem", { name: /Take picture/ }).click(),
    ]);
    await chooser.setFiles(PROP_TABLE);
    await page.getByRole("menuitem", { name: /Add as a prop table/ }).click();
    await expect(page.getByText("Which production?")).toBeVisible();
    await page.getByRole("menuitem", { name: /Noises Off!/ }).click();
    await page.waitForURL("**/productions/prod1/photo");
    await expect(page.locator('select[aria-label^="Which item"]').first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("desktop", () => {
  test.use(DESKTOP);

  test("not shown", async ({ page }) => {
    await open(page, "/inventory");
    await expect(page.locator("[data-quick-actions]")).toBeHidden();
  });
});
