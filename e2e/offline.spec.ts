import { test, expect, PHONE } from "./helpers";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";

// The installable app: manifest and icons, the service worker, and a
// checklist that keeps working in a basement with no signal.
//
// This file runs its own copy of the fixture build on another port, because
// "offline" here means the server is really gone: Playwright's setOffline
// doesn't reliably reach a service worker's own fetches. It needs the
// production fixture build (.next-e2e), which `npm run test:e2e` makes.

const PORT = 3101;
const BASE = `http://localhost:${PORT}`;
let server: ChildProcess | null = null;

async function startServer() {
  const next = require.resolve("next/dist/bin/next");
  server = spawn(process.execPath, [next, "start", "-p", String(PORT)], {
    env: { ...process.env, E2E_FIXTURES: "1" },
    stdio: "ignore",
    detached: process.platform !== "win32",
  });
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(`${BASE}/manifest.webmanifest`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`the fixture build didn't start on ${PORT} — has it been built? (npm run test:e2e builds it)`);
}

function stopServer() {
  if (!server?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"]);
  } else {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }
  server = null;
}

async function waitUntilDown() {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${BASE}/manifest.webmanifest`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

test.use({ ...PHONE, consoleErrors: "ignore", serviceWorkers: "allow" });
test.beforeAll(startServer);
test.afterAll(stopServer);

test("installable, and the checklist works with no connection", async ({ page, context }) => {
  test.setTimeout(180_000);

  await test.step("manifest and icons", async () => {
    const manifest = await (await context.request.get(`${BASE}/manifest.webmanifest`)).json();
    expect([manifest.display, manifest.short_name, manifest.start_url]).toEqual(["standalone", "Props", "/inventory"]);
    for (const icon of manifest.icons) {
      const response = await context.request.get(BASE + icon.src);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()["content-type"], icon.src).toBe("image/png");
    }
  });

  await test.step("the service worker takes over the whole site", async () => {
    await page.goto(`${BASE}/inventory`, { waitUntil: "networkidle" });
    const worker = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return { scope: registration.scope, state: registration.active?.state };
    });
    expect([new URL(worker.scope).pathname, worker.state]).toEqual(["/", "activated"]);
    await page.reload({ waitUntil: "networkidle" });
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  });

  await test.step("a new worker drops our old caches but never the recognition model", async () => {
    await page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
      await (await caches.open("transformers-cache")).put("/model.onnx", new Response("model"));
      await (await caches.open("props-pages-v0")).put("/old", new Response("old"));
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(500);
    const keys = await page.evaluate(async () => await caches.keys());
    expect(keys).toContain("transformers-cache");
    expect(keys).not.toContain("props-pages-v0");
    await page.reload({ waitUntil: "networkidle" });
  });

  await test.step("pages opened here are kept", async () => {
    await page.goto(`${BASE}/productions/prod1/checklist`, { waitUntil: "networkidle" });
    await page.goto(`${BASE}/productions/prod1`, { waitUntil: "networkidle" });
    const kept = await page.evaluate(async () =>
      (await (await caches.open("props-pages-v1")).keys()).map((r) => new URL(r.url).pathname)
    );
    for (const path of ["/inventory", "/productions/prod1/checklist", "/productions/prod1"]) {
      expect(kept, path).toContain(path);
    }
  });

  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  const box = (name: string) => page.locator("main li", { hasText: name }).first().locator("input[type=checkbox]");

  await test.step("offline: the checklist opens from the kept copy and keeps ticks on the phone", async () => {
    await context.setOffline(true);
    stopServer();
    await waitUntilDown();
    await page.goto(`${BASE}/productions/prod1/checklist`, { waitUntil: "load" }).catch(() => {});
    await expect(page.locator("main h1")).toHaveText("Checklist");
    await expect(page.getByText(/No connection\. This is the copy/)).toBeVisible();
    await box("Fishing Net").check();
    await expect(box("Fishing Net")).toBeChecked();
    await expect(page.getByText(/1 tick is saved on this device/)).toBeVisible();
    const queue = await page.evaluate(() => JSON.parse(localStorage.getItem("checklist-queue:prod1") || "[]"));
    expect([queue.length, queue[0]?.rowId, queue[0]?.state, typeof queue[0]?.at]).toEqual([1, "pli1", "checked", "string"]);
    await box("Brass candlestick").check();
    await box("Fishing Net").uncheck();
    await box("Fishing Net").check();
    const queue2 = await page.evaluate(() => JSON.parse(localStorage.getItem("checklist-queue:prod1") || "[]"));
    expect(queue2.map((x: { rowId: string; state: string }) => `${x.rowId}:${x.state}`), "one entry per row, last change last").toEqual([
      "pli2:checked",
      "pli1:checked",
    ]);
  });

  await test.step("…and still shows them after a reload with no signal", async () => {
    await page.reload({ waitUntil: "load" }).catch(() => {});
    await expect(box("Fishing Net")).toBeChecked();
    await expect(page.getByText(/2 ticks are saved/)).toBeVisible();
  });

  await test.step("a page never opened here gets the offline page", async () => {
    await page.goto(`${BASE}/theatre`, { waitUntil: "load" }).catch(() => {});
    await expect(page.getByText("No signal here")).toBeVisible();
    await page.goto(`${BASE}/productions/prod1/checklist`, { waitUntil: "load" }).catch(() => {});
    await expect(page.locator("main h1")).toHaveText("Checklist");
  });

  await test.step("back online: the ticks are sent and the waiting notes go", async () => {
    await startServer();
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => posts.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("checklist-queue:prod1"))).toBeNull();
    await expect(page.getByText(/saved on this device/)).toHaveCount(0);
    await expect(page.getByText(/No connection\./)).toHaveCount(0);
  });

  await test.step("the sign-in page forgets every kept page (a shared phone)", async () => {
    await context.addCookies([{ name: "e2e-signed-out", value: "1", domain: "localhost", path: "/" }]);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const keys = await page.evaluate(async () => await caches.keys());
    expect(keys.filter((k) => k.startsWith("props-pages-"))).toEqual([]);
    expect(keys).toContain("props-static-v1");
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    expect(
      await page.evaluate(async () => (await (await caches.open("props-pages-v1")).keys()).length),
      "the login page itself is never kept"
    ).toBe(0);
  });
});
