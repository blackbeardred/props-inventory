import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests: the real app, built against the in-memory sample theatre
 * (E2E_FIXTURES=1, see next.config.ts and e2e/README.md), driven in Chromium.
 *
 * One worker, in order: the sample theatre is a single shared copy, put back
 * the way it started before every test (e2e/helpers.ts → POST /api/e2e/reset).
 *
 *   npm run test:e2e                 builds the fixture app, then runs
 *   npx playwright test e2e/swipes   one file
 *   npx playwright show-report       after a failure
 */
const PORT = 3100;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }], ["github"]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // For machines with a Chromium already installed somewhere Playwright
      // doesn't look (Claude's container); everyone else gets the default.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // CI builds in a step of its own, so a build failure reads as one.
    command: CI ? `npx next start -p ${PORT}` : `npx next build && npx next start -p ${PORT}`,
    env: { E2E_FIXTURES: "1" },
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: !CI,
    timeout: 300_000,
  },
});
