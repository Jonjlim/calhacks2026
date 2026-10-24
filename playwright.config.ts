import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. By default this starts its own `next dev` on a dedicated
 * port with Convex DISABLED (NEXT_PUBLIC_CONVEX_URL empty), so every run
 * exercises the app exactly as it ships today: UI on mock data.
 *
 *   npm run test:e2e                          start a private dev server and run everything
 *   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
 *                                             run against a server you already started
 *
 * Specs for flows that are not wired to the backend yet are `test.fixme`, which
 * Playwright reports as skipped; they are never counted as passes.
 */
const PORT = Number(process.env.E2E_PORT ?? 3210);
const external = process.env.E2E_BASE_URL;
const baseURL = external ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: [/mobile\.spec\.ts/, /world\.spec\.ts/] },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
    // Real (software-rendered) WebGL is ~1 fps in headless Chromium, so these run alone, serially, with
    // generous timeouts: `npm run test:e2e:webgl`. They are excluded from the default `npm run test:e2e`.
    { name: "webgl", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } }, testMatch: /world\.spec\.ts/, timeout: 150_000, fullyParallel: false },
  ],
  webServer: external
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        env: { NEXT_PUBLIC_CONVEX_URL: "" },
      },
});
