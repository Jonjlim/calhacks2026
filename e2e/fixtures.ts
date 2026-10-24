import { expect, test as base } from "@playwright/test";

/** Console noise that is not an app defect (dev tooling, deprecated-library notices, missing favicon). */
const IGNORED_CONSOLE = [/favicon/i, /\[HMR\]/i, /Fast Refresh/i, /THREE\.Clock/i, /PCFSoftShadowMap/i, /WebSocket connection to .*_next\/webpack-hmr/i, /Download the React DevTools/i];

type Fixtures = {
  /** Fails the test if the page throws an uncaught error or logs console.error during it. */
  guardErrors: void;
};

/**
 * `test` runs with WebGL disabled: the page falls back to its painted backdrop
 * (an intentional, supported path) so DOM flows are fast and deterministic, and the
 * cinematic intro never starts. Use `webglTest` for specs that need the real scene.
 */
const withErrorGuard = base.extend<Fixtures>({
  guardErrors: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
      page.on("console", (msg) => {
        if (msg.type() === "error" && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) problems.push(`console.error: ${msg.text()}`);
      });
      await use();
      expect(problems, "the page logged errors").toEqual([]);
    },
    { auto: true },
  ],
});

export const test = withErrorGuard.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (/webgl/i.test(type)) return null;
        return (original as (this: HTMLCanvasElement, type: string, ...rest: unknown[]) => unknown).call(this, type, ...rest);
      } as typeof original;
    });
    await use(page);
  },
});

/** Same error guard, real WebGL (software rendered in headless Chromium). */
export const webglTest = withErrorGuard;

export { expect };

/** The fixture invite code the mock backend accepts (lib/mocks/fixtures.ts). */
export const MOCK_TOKEN = "demo-invite-token";
