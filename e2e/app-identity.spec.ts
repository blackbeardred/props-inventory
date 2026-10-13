import { test, expect, DESKTOP, open } from "./helpers";

// The installed app: saved as "Propolis", with the brand board's home-screen
// icon, and on a computer its own top strip in place of the browser's title
// bar (window-controls-overlay, src/components/title-strip.tsx).

test.use(DESKTOP);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer) {
  expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("the manifest names it Propolis and asks for the title bar", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("Propolis");
  expect(manifest.short_name).toBe("Propolis");
  expect(manifest.display).toBe("standalone");
  expect(manifest.display_override).toEqual(["window-controls-overlay"]);
  for (const icon of manifest.icons as { src: string; sizes: string }[]) {
    const response = await request.get(icon.src);
    expect(response.ok(), icon.src).toBe(true);
    const [w, h] = pngSize(await response.body());
    expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
  }
});

test("the home-screen icons are the green tile with the cream mark", async ({ request }) => {
  const apple = await request.get("/apple-icon.png");
  expect(apple.ok()).toBe(true);
  expect(pngSize(await apple.body())).toEqual([180, 180]);
  const svg = await (await request.get("/icon.svg")).text();
  expect(svg).toContain("#3F6B52");
  expect(svg).toContain("#FBF7EC");
  expect(svg).toContain("#C98A2C");
});

test("pages are titled for Propolis, and the iPhone name matches", async ({ page }) => {
  await open(page, "/inventory");
  await expect(page).toHaveTitle("Inventory · Propolis");
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Propolis");
  await expect(page.locator('meta[name="application-name"]')).toHaveAttribute("content", "Propolis");
});

test("the title strip only shows when the app has the title bar", async ({ page }) => {
  await open(page, "/inventory");
  const strip = page.locator("[data-title-strip]");
  await expect(strip).toBeHidden();

  // Chromium can't be put into the window-controls-overlay display mode from
  // a test (CDP doesn't emulate display-mode), so the rules inside that media
  // query are read out of the page's own stylesheets and applied directly.
  const rules = await page.evaluate(() => {
    const found: string[] = [];
    for (const sheet of document.styleSheets) {
      let list: CSSRuleList;
      try { list = sheet.cssRules; } catch { continue; }
      for (const rule of list) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes("window-controls-overlay")) {
          for (const inner of rule.cssRules) found.push(inner.cssText);
        }
      }
    }
    return found;
  });
  expect(rules.some((r) => r.startsWith(".title-strip"))).toBe(true);
  expect(rules.some((r) => r.startsWith("body"))).toBe(true);
  await page.addStyleTag({ content: rules.join("\n") });

  await expect(strip).toBeVisible();
  await expect(strip).toHaveText("Propolis");
  const geometry = await page.evaluate(() => {
    const el = document.querySelector("[data-title-strip]")!;
    const s = el.getBoundingClientRect();
    const header = document.querySelector("header")!.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      top: s.top,
      height: s.height,
      width: s.width,
      headerTop: header.top,
      region: style.getPropertyValue("app-region") || style.getPropertyValue("-webkit-app-region"),
      background: style.backgroundColor,
    };
  });
  expect(geometry.top).toBe(0);
  expect(geometry.height).toBeGreaterThan(20);
  expect(geometry.width).toBe(await page.evaluate(() => document.documentElement.clientWidth));
  // The page starts below it rather than under it.
  expect(geometry.headerTop).toBeGreaterThanOrEqual(geometry.height);
  expect(geometry.region).toBe("drag");
  // Ink, the same as the window buttons' own background (theme_color).
  expect(geometry.background).toBe("rgb(42, 34, 25)");
});
