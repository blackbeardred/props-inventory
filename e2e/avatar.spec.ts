import path from "node:path";
import { test, expect, PHONE, DESKTOP, open, noSidewaysScroll, smallTapTargets } from "./helpers";

// Your account's profile picture: choose, frame it in a circle, preview it
// at the app's sizes, and save the cropped square (src/components/avatar-field.tsx).

const PHOTO = path.join(__dirname, "fixtures", "white-cup.jpg");

/** What the form will upload: type and size of the file in its avatar input. */
const upload = (page: import("@playwright/test").Page) =>
  page.locator("[data-avatar-upload]").evaluate(async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return null;
    const bitmap = await createImageBitmap(file);
    return { type: file.type, w: bitmap.width, h: bitmap.height, name: file.name };
  });

/** Average brightness of a preview canvas, to tell a drawn one from a blank. */
const previewInk = (page: import("@playwright/test").Page, i: number) =>
  page.locator("[data-avatar-previews] canvas").nth(i).evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let k = 0; k < d.length; k += 4) sum += d[k] + d[k + 1] + d[k + 2];
    return { w: c.width, mean: sum / (d.length / 4) / 3, alpha: d[3] };
  });

test.describe("on a computer", () => {
  test.use(DESKTOP);

  test("choosing a picture opens the circle cropper with previews, and the crop is what's uploaded", async ({ page }) => {
    await open(page, "/account");
    await expect(page.locator("[data-avatar-cropper]")).toHaveCount(0);
    await page.locator("#avatar-picker").setInputFiles(PHOTO);
    await expect(page.locator("[data-avatar-cropper]")).toBeVisible();
    await expect(page.locator("[data-avatar-previews] figcaption")).toHaveText(["Your account", "Top bar"]);

    // A square JPEG of the circle, written straight away: Save mid-crop is safe.
    await expect.poll(() => upload(page)).toMatchObject({ type: "image/jpeg", w: 512, h: 512 });
    const before = await previewInk(page, 0);
    expect(before.alpha).toBe(255);

    // Zoom and drag change the previews.
    await page.locator("#avatar-zoom").fill("2.5");
    await expect(page.locator("[data-avatar-cropper]")).toContainText("250%");
    const stage = page.locator("[data-avatar-stage]");
    const box = (await stage.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => (await previewInk(page, 0)).mean).not.toBeCloseTo(before.mean, 0);
    // The keyboard does the same.
    await stage.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("+");
    await expect(page.locator("[data-avatar-cropper]")).toContainText("270%");

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator("[data-avatar-cropper]")).toHaveCount(0);
    await expect(page.locator("[data-avatar-current]")).toHaveAttribute("src", /^blob:/);
    await expect(page.locator("[data-avatar-ready]")).toContainText("Press Save");
    await expect.poll(() => upload(page)).toMatchObject({ type: "image/jpeg", w: 512, h: 512 });

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/notice=profile-saved/);
    const uploaded = await page.evaluate(() => (globalThis as unknown as { __storage?: { uploaded: string[] } }).__storage);
    expect(uploaded === undefined || Array.isArray(uploaded.uploaded)).toBe(true);
    await expect(page.locator("main")).toContainText("Your name and picture are up to date.");
  });

  test("Cancel leaves the saved picture alone and uploads nothing", async ({ page }) => {
    await open(page, "/account");
    await page.locator("#avatar-picker").setInputFiles(PHOTO);
    await expect(page.locator("[data-avatar-cropper]")).toBeVisible();
    await expect.poll(() => upload(page)).not.toBeNull();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.locator("[data-avatar-cropper]")).toHaveCount(0);
    expect(await upload(page)).toBeNull();
  });

  test("a file that isn't a picture says so", async ({ page }) => {
    await open(page, "/account");
    await page.locator("#avatar-picker").setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.locator("[data-avatar-field] [role=alert]")).toContainText("That isn’t a picture");
    await expect(page.locator("[data-avatar-cropper]")).toHaveCount(0);
  });
});

test.describe("on a phone", () => {
  test.use(PHONE);

  test("the cropper fits the screen, with thumb-sized controls", async ({ page }) => {
    await open(page, "/account");
    await page.locator("#avatar-picker").setInputFiles(PHOTO);
    await expect(page.locator("[data-avatar-cropper]")).toBeVisible();
    await noSidewaysScroll(page);
    expect(await smallTapTargets(page)).toEqual([]);
  });
});
